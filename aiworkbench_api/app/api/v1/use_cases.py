"""
Use case management endpoints.
"""
import io
import re
import uuid
import zipfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import AliasChoices, BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.use_case_assessments import router as use_case_assessment_router
from app.core.ai_category_options import AI_CATEGORY_OPTIONS, normalize_ai_category
from app.core.analysis_options import (
    ANALYSIS_BUSINESS_OWNER_ROLES,
    ANALYSIS_TECHNICAL_OWNER_ROLES,
    BUSINESS_ANALYSIS_FIELDS,
    CURRENT_EFFORT_OPTIONS,
    DATA_PRIVACY_SECURITY_OPTIONS,
    DEPLOYMENT_MODEL_OPTIONS,
    EFFICIENCY_IMPACT_OPTIONS,
    FREQUENCY_OF_TASK_OPTIONS,
    HOST_SYSTEM_CAPABILITY_OPTIONS,
    OPERATIONAL_COMPLIANCE_RISK_OPTIONS,
    PROCESS_IMPACT_OPTIONS,
    QUALITY_COMPLIANCE_IMPACT_OPTIONS,
    TECHNICAL_ANALYSIS_FIELDS,
    TOOL_COMPLEXITY_OPTIONS,
    USER_GROUP_SIZE_OPTIONS,
    USER_URGENCY_OPTIONS,
    derive_technical_feasibility,
    missing_required_analysis_fields,
)
from app.core.authorization import (
    DOMAIN_ACCESS_DENIED_DETAIL,
    check_permission,
    get_user_role_name,
    get_user_with_permissions,
    is_admin,
    is_domain_governor,
    is_domain_owner,
    require_permission,
)
from app.core.config import settings
from app.services.document_preview_service import (
    render_office_document_preview,
    sanitize_html_for_preview,
)
from app.services.notification_service import use_case_stakeholder_ids
from app.core.workflow import (
    FORWARD_NEXT_NON_ADMIN,
    STATUS_TO_WORKFLOW_PERMISSION,
    WORKFLOW_NEXT,
)
from app.utils.notification_emails import (
    notify_admins_new_use_case,
    notify_analysis_assignment,
    notify_analysis_completed,
    notify_analysis_rejection,
    notify_analysis_send_back,
    notify_assessment_assignment,
    notify_assessment_completed,
    notify_comment_added,
    notify_estimate_assignment,
    notify_estimate_completed,
    notify_risk_assigned,
    notify_roi_assignment,
    notify_roi_completed,
    notify_roi_previous_owner,
    notify_stage_previous_owner,
    notify_use_case_decision,
    notify_use_case_deleted,
    notify_use_case_moved,
)
from app.core.estimate_options import (
    CURRENCY_OPTIONS,
    ESTIMATE_LINE_KEYS,
    ESTIMATE_LINE_LABELS,
    ESTIMATE_LINE_TYPES,
    VENDOR_ASSESSMENT_QUESTIONS,
    empty_estimate_payload,
    is_vendor_build,
    normalize_estimate_data,
    validate_estimate_data,
)
from app.core.roi_options import (
    ASSESSMENT_OWNER_ROLES,
    ROI_OWNER_ROLES,
    ROI_SAVING_CATEGORIES,
    empty_roi_payload,
    normalize_roi_data,
    roi_is_complete,
    validate_roi_data,
)
from app.core.data_requirement_options import (
    DATA_CLASSIFICATION_OPTIONS,
    DATA_USAGE_OPTIONS,
    DATASET_TYPE_OPTIONS,
)
from app.core.database import get_db
from app.core.document_type_lookup import (
    DEFAULT_DOCUMENT_SOURCE,
    is_technical_analysis_source,
    list_document_types,
    normalize_document_source,
    resolve_document_type_name,
)
from app.core.field_limits import (
    BALANCING_STRATEGY_MAX_LENGTH,
    DATA_OWNER_MAX_LENGTH,
    EXPECTED_BENEFITS_MAX_LENGTH,
    HUMAN_IN_LOOP_STRATEGY_MAX_LENGTH,
    INTENDED_USE_MAX_LENGTH,
    MITIGATION_STRATEGY_MAX_LENGTH,
    PROTECTED_ATTRIBUTES_MAX_LENGTH,
    RISK_DESCRIPTION_MAX_LENGTH,
    SOLUTION_DESIGN_OVERVIEW_MAX_LENGTH,
    USE_CASE_DESCRIPTION_MAX_LENGTH,
)
from app.core.impacted_stakeholder_utils import normalize_impacted_stakeholders
from app.core.logging_config import logger
from app.core.risk_level_options import normalize_risk_level
from app.core.target_audience_options import normalize_target_audience_types
from app.middleware.auth_middleware import get_current_user_id
from app.models import (
    AuditLog,
    Domain,
    DomainAccess,
    Role,
    SystemConfig,
    UseCase,
    UseCaseComment,
    UseCaseData,
    UseCaseDocument,
    UseCaseLink,
    UseCaseRiskReview,
    UseCaseTag,
    User,
)
from app.services.usecase_documentation_quality_service import usecase_documentation_quality_service

router = APIRouter()
router.include_router(use_case_assessment_router)


def _resolve_ai_category(ai_category: str | None) -> str | None:
    """Validate and normalize an AI category code, including legacy values."""
    normalized = normalize_ai_category(ai_category)
    if ai_category and normalized is None:
        allowed_labels = ", ".join(AI_CATEGORY_OPTIONS.values())
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid AI category. Must be one of: {allowed_labels}",
        )
    return normalized


# Request models
class ReferenceLinkInput(BaseModel):
    url: str
    label: str | None = None


TargetAudienceTypeValue = Literal[
    "Internal users",
    "Customers",
    "Partners",
    "Public",
]


class UseCaseCreate(BaseModel):
    domain_id: str
    use_case_name: str
    use_case_title: str = Field(..., min_length=1, max_length=100)
    use_case_description: str = Field(..., min_length=1, max_length=USE_CASE_DESCRIPTION_MAX_LENGTH)
    intended_use: str | None = Field(default=None, max_length=INTENDED_USE_MAX_LENGTH)
    expected_benefits: str = Field(..., min_length=1, max_length=EXPECTED_BENEFITS_MAX_LENGTH)
    department: str = Field(..., min_length=1, max_length=30)
    ai_category: str | None = None  # 'P', 'G', 'A', or 'S'
    feasibility: str | None = None
    intended_audience: str | None = None  # Target users/audience
    target_audience_type: list[TargetAudienceTypeValue] | None = None
    impacted_stakeholders: list[str] | None = None
    tags: list[str] | None = []  # List of tag names
    reference_links: list[ReferenceLinkInput] | None = Field(
        default_factory=list,
        validation_alias=AliasChoices(
            "reference_links",
            "referenceLinks",
            "website_links",
            "websiteLinks",
            "live_demo_links",
            "liveDemoLinks",
        ),
    )
    # Status is always set to "New" on creation (server-side)
    status: str = "New"

    @field_validator("use_case_title", "department", "use_case_description", "expected_benefits")
    @classmethod
    def require_non_blank(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("This field is required.")
        return normalized

    @field_validator("target_audience_type", mode="before")
    @classmethod
    def validate_target_audience_type_create(cls, value):
        return normalize_target_audience_types(value)

    @field_validator("impacted_stakeholders", mode="before")
    @classmethod
    def validate_impacted_stakeholders_create(cls, value):
        return normalize_impacted_stakeholders(value)


class UseCaseMoveRequest(BaseModel):
    target_domain_id: str


class UseCaseUpdate(BaseModel):
    use_case_name: str | None = None
    use_case_title: str | None = None
    use_case_description: str | None = Field(default=None, max_length=USE_CASE_DESCRIPTION_MAX_LENGTH)
    intended_use: str | None = Field(default=None, max_length=INTENDED_USE_MAX_LENGTH)
    expected_benefits: str | None = Field(default=None, max_length=EXPECTED_BENEFITS_MAX_LENGTH)
    department: str | None = None
    ai_category: str | None = None  # 'P', 'G', 'A', or 'S'
    feasibility: str | None = None
    intended_audience: str | None = None
    target_audience_type: list[TargetAudienceTypeValue] | None = None
    impacted_stakeholders: list[str] | None = None
    technical_owner: str | None = None  # User ID
    business_owner: str | None = None  # User ID
    solution_design_overview: str | None = Field(default=None, max_length=SOLUTION_DESIGN_OVERVIEW_MAX_LENGTH)
    human_in_loop_strategy: str | None = Field(default=None, max_length=HUMAN_IN_LOOP_STRATEGY_MAX_LENGTH)
    bias_assessment_performed: bool | None = None
    protected_attributes: str | None = Field(default=None, max_length=PROTECTED_ATTRIBUTES_MAX_LENGTH)
    balancing_strategy: str | None = Field(default=None, max_length=BALANCING_STRATEGY_MAX_LENGTH)
    # Business analysis scoring
    frequency_of_task: str | None = None
    current_effort: str | None = None
    user_group_size: str | None = None
    efficiency_impact: str | None = None
    quality_compliance_impact: str | None = None
    user_urgency: str | None = None
    process_impact: str | None = None
    operational_compliance_risk: str | None = None
    # Technical analysis scoring
    tool_complexity: str | None = None
    host_system_capability: str | None = None
    data_privacy_security: str | None = None
    deployment_model: str | None = None
    tags: list[str] | None = None
    reference_links: list[ReferenceLinkInput] | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "reference_links",
            "referenceLinks",
            "website_links",
            "websiteLinks",
            "live_demo_links",
            "liveDemoLinks",
        ),
    )
    status: str | None = None
    rejection_reason: str | None = None  # Required when transitioning to Rejected

    @field_validator("target_audience_type", mode="before")
    @classmethod
    def validate_target_audience_type_update(cls, value):
        return normalize_target_audience_types(value)

    @field_validator("impacted_stakeholders", mode="before")
    @classmethod
    def validate_impacted_stakeholders_update(cls, value):
        return normalize_impacted_stakeholders(value)


class AnalysisAssignRequest(BaseModel):
    technical_owner: str
    business_owner: str
    due_date: str  # ISO date YYYY-MM-DD or datetime


class AnalysisTrackRequest(BaseModel):
    track: Literal["technical", "business"]


class AnalysisRejectRequest(BaseModel):
    track: Literal["technical", "business"]
    note: str = Field(..., min_length=1, max_length=2000)


class AnalysisSendBackRequest(BaseModel):
    track: Literal["technical", "business"]
    note: str = Field(..., min_length=1, max_length=2000)


class EstimateAssignRequest(BaseModel):
    estimate_owner: str
    due_date: str


class EstimateSaveRequest(BaseModel):
    estimate_data: dict


class RoiAssignRequest(BaseModel):
    roi_owner: str
    due_date: str


class RoiSaveRequest(BaseModel):
    roi_data: dict


class AssessmentAssignRequest(BaseModel):
    assessment_owner: str
    due_date: str


class DemoVideoItem(BaseModel):
    """Demo video discovered under DEMO_VIDEOS_ROOT."""
    path: str  # Relative path from DEMO_VIDEOS_ROOT (POSIX-style, e.g. "folder/demo.mp4")
    name: str  # File name only
    size_bytes: int | None = None


class DemoVideoMapRequest(BaseModel):
    """Request body for mapping an existing demo video to a use case."""
    demo_path: str


DOCUMENT_TYPE_RULES = {
    "PDF": {
        "extensions": {".pdf"},
        "mime_types": {"application/pdf"},
        "fallback_upload_mime_types": set(),
    },
    "DOC": {
        "extensions": {".doc", ".docx"},
        "mime_types": {
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        "fallback_upload_mime_types": {"application/zip", "application/x-zip-compressed"},
    },
    "XLS": {
        "extensions": {".xls", ".xlsx"},
        "mime_types": {
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        "fallback_upload_mime_types": {"application/zip", "application/x-zip-compressed"},
    },
    "PPT": {
        "extensions": {".ppt", ".pptx"},
        "mime_types": {
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
        "fallback_upload_mime_types": {"application/zip", "application/x-zip-compressed"},
    },
    "HTML": {
        "extensions": {".html", ".htm"},
        "mime_types": {"text/html", "application/xhtml+xml"},
        "fallback_upload_mime_types": {"text/plain"},
    },
    "IMAGE": {
        "extensions": {".png", ".jpg", ".jpeg", ".webp", ".gif"},
        "mime_types": {"image/png", "image/jpeg", "image/webp", "image/gif"},
        "fallback_upload_mime_types": set(),
    },
    "ARCHIVE": {
        "extensions": {".zip", ".rar", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz", ".tbz2", ".tar.xz", ".txz"},
        "mime_types": {
            "application/zip",
            "application/x-zip",
            "application/x-zip-compressed",
            "application/vnd.rar",
            "application/x-rar",
            "application/x-rar-compressed",
            "application/x-tar",
            "application/x-gtar",
            "application/gzip",
            "application/x-gzip",
            "application/x-tgz",
            "application/x-bzip2",
            "application/x-xz",
        },
        "fallback_upload_mime_types": {
            "application/x-compressed",
            "application/x-compressed-tar",
            "application/x-gtar-compressed",
            "application/x-bzip-compressed-tar",
            "application/x-xz-compressed-tar",
        },
    },
}

GENERIC_UPLOAD_MIME_TYPES = {
    "",
    "application/octet-stream",
    "binary/octet-stream",
}

INFOGRAPHIC_FILE_PATTERN = re.compile(r"^INFOGRAPHIC__([A-Z]+)__", re.IGNORECASE)
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
RAR4_MAGIC = b"Rar!\x1a\x07\x00"
RAR5_MAGIC = b"Rar!\x1a\x07\x01\x00"
XZ_MAGIC = b"\xfd7zXZ\x00"
ZIP_MAGIC_PREFIXES = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
ARCHIVE_CONTENT_TYPES_BY_EXTENSION = {
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".tar": "application/x-tar",
    ".tar.gz": "application/gzip",
    ".tgz": "application/gzip",
    ".tar.bz2": "application/x-bzip2",
    ".tbz": "application/x-bzip2",
    ".tbz2": "application/x-bzip2",
    ".tar.xz": "application/x-xz",
    ".txz": "application/x-xz",
}
MULTIPART_ARCHIVE_EXTENSIONS = {
    extension
    for extension in DOCUMENT_TYPE_RULES["ARCHIVE"]["extensions"]
    if extension.count(".") > 1
}
MAX_LIVE_DEMO_LINKS_PER_USE_CASE = 1
MAX_INFOGRAPHIC_FILES_PER_USE_CASE = 1
ALLOWED_INFOGRAPHIC_DOCUMENT_TYPES = {"PDF", "HTML", "IMAGE"}
ALLOWED_DOCUMENT_TYPE_LABELS = (
    "PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, HTML, HTM, PNG, JPG, JPEG, WEBP, GIF, "
    "ZIP, RAR, TAR, TAR.GZ, TGZ, TAR.BZ2, TBZ, TBZ2, TAR.XZ, TXZ"
)
HTML_PREVIEW_CSP = (
    "default-src 'none'; "
    "img-src data: https: http: blob:; "
    "style-src 'unsafe-inline' https: http:; "
    "font-src data: https: http:; "
    "media-src data: https: http:; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'none'; "
    "frame-ancestors 'self'; "
    "script-src 'none'; "
    "connect-src 'none'"
)


class EligibleOwnerResponse(BaseModel):
    """User eligible for technical or business owner dropdown."""
    user_id: str
    user_name: str
    user_email: str
    role_name: str | None = None


def _get_users_by_role_names(db: Session, role_names: list[str]):
    """Return active users whose role is in role_names."""
    roles = db.query(Role).filter(Role.role_name.in_(role_names)).all()
    role_ids = [r.role_id for r in roles]
    users = db.query(User).filter(User.role_id.in_(role_ids)).order_by(User.user_name).all()
    return [u for u in users if getattr(u, "is_active", True)]


def _domain_member_ids(db: Session, domain_id: str) -> set[str]:
    ids: set[str] = set()
    domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if domain and domain.owner_id:
        ids.add(domain.owner_id)
    rows = db.query(DomainAccess.user_id).filter(DomainAccess.domain_id == domain_id).all()
    ids.update(row[0] for row in rows if row[0])
    return ids


def _user_can_open_domain(db: Session, user_id: str, domain_id: str) -> bool:
    """Same rule as GET /use-cases/{id}: portal_admin, domain owner, or domain_access row."""
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        return False
    if is_admin(db, user):
        return True
    return user_id in _domain_member_ids(db, domain_id)


def _filter_owners_for_domain(db: Session, users: list, domain_id: str | None) -> list:
    """Keep users who can open use cases in this domain (owner, domain_access, or portal_admin)."""
    if not domain_id:
        return []
    allowed = _domain_member_ids(db, domain_id)
    filtered = []
    for user in users:
        if user.user_id in allowed:
            filtered.append(user)
            continue
        role = user.role.role_name if user.role else ""
        if role == "portal_admin":
            filtered.append(user)
    return filtered


def _require_assignee_domain_access(db: Session, user_id: str, domain_id: str, label: str) -> None:
    if not _user_can_open_domain(db, user_id, domain_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{label} does not have this domain assigned. "
                "Grant domain access first, then assign."
            ),
        )


def _require_at_least_one_risk(db: Session, use_case_id: str, action: str) -> None:
    """Block a workflow advance until the Risks tab has at least one entry (open is allowed)."""
    count = (
        db.query(UseCaseRiskReview)
        .filter(UseCaseRiskReview.use_case_id == use_case_id)
        .count()
    )
    if count < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{action} requires at least one risk on the Risks tab. "
                "The assigned technical owner or business owner can add it "
                "(domain owner or portal admin can add it as backup). "
                "The risk may remain open until Approve."
            ),
        )


def _eligible_technical_owners(db: Session, domain_id: str | None) -> list:
    return _filter_owners_for_domain(db, _get_users_by_role_names(db, ANALYSIS_TECHNICAL_OWNER_ROLES), domain_id)


def _eligible_business_owners(db: Session, domain_id: str | None) -> list:
    return _filter_owners_for_domain(db, _get_users_by_role_names(db, ANALYSIS_BUSINESS_OWNER_ROLES), domain_id)


def _eligible_roi_owners(db: Session, domain_id: str | None) -> list:
    return _filter_owners_for_domain(db, _get_users_by_role_names(db, ROI_OWNER_ROLES), domain_id)


def _eligible_assessment_owners(db: Session, domain_id: str | None) -> list:
    return _filter_owners_for_domain(db, _get_users_by_role_names(db, ASSESSMENT_OWNER_ROLES), domain_id)


def _to_eligible_owner_responses(users) -> list[EligibleOwnerResponse]:
    return [
        EligibleOwnerResponse(
            user_id=u.user_id,
            user_name=u.user_name,
            user_email=u.user_email,
            role_name=u.role.role_name if u.role else None,
        )
        for u in users
    ]


def _resolve_user_display(db: Session, user_id: str | None) -> dict:
    """Resolve a user id to display fields for read-only use case views."""
    if not user_id:
        return {"user_name": None, "user_email": None, "role_name": None}
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        return {"user_name": None, "user_email": None, "role_name": None}
    return {
        "user_name": user.user_name,
        "user_email": user.user_email,
        "role_name": user.role.role_name if user.role else None,
    }


def _iso(dt) -> str | None:
    if not dt:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return str(dt)


def _analysis_payload(use_case: UseCase, db: Session) -> dict:
    """Serialize analysis assignment and scoring fields for API responses."""
    assigner = None
    if getattr(use_case, "analysis_assigned_by", None):
        assigner = _resolve_user_display(db, use_case.analysis_assigned_by)
    return {
        "analysis_assigned_by": getattr(use_case, "analysis_assigned_by", None),
        "analysis_assigned_by_name": assigner["user_name"] if assigner else None,
        "analysis_assigned_dt": _iso(getattr(use_case, "analysis_assigned_dt", None)),
        "analysis_due_date": _iso(getattr(use_case, "analysis_due_date", None)),
        "tech_analysis_completed_dt": _iso(getattr(use_case, "tech_analysis_completed_dt", None)),
        "business_analysis_completed_dt": _iso(getattr(use_case, "business_analysis_completed_dt", None)),
        "tech_analysis_rejected_dt": _iso(getattr(use_case, "tech_analysis_rejected_dt", None)),
        "tech_analysis_rejection_note": getattr(use_case, "tech_analysis_rejection_note", None),
        "business_analysis_rejected_dt": _iso(getattr(use_case, "business_analysis_rejected_dt", None)),
        "business_analysis_rejection_note": getattr(use_case, "business_analysis_rejection_note", None),
        "frequency_of_task": getattr(use_case, "frequency_of_task", None),
        "current_effort": getattr(use_case, "current_effort", None),
        "user_group_size": getattr(use_case, "user_group_size", None),
        "efficiency_impact": getattr(use_case, "efficiency_impact", None),
        "quality_compliance_impact": getattr(use_case, "quality_compliance_impact", None),
        "user_urgency": getattr(use_case, "user_urgency", None),
        "process_impact": getattr(use_case, "process_impact", None),
        "operational_compliance_risk": getattr(use_case, "operational_compliance_risk", None),
        "tool_complexity": getattr(use_case, "tool_complexity", None),
        "host_system_capability": getattr(use_case, "host_system_capability", None),
        "data_privacy_security": getattr(use_case, "data_privacy_security", None),
        "deployment_model": getattr(use_case, "deployment_model", None),
        "estimate_owner": getattr(use_case, "estimate_owner", None),
        "estimate_owner_name": (
            _resolve_user_display(db, use_case.estimate_owner)["user_name"]
            if getattr(use_case, "estimate_owner", None)
            else None
        ),
        "estimate_assigned_by": getattr(use_case, "estimate_assigned_by", None),
        "estimate_assigned_by_name": (
            _resolve_user_display(db, use_case.estimate_assigned_by)["user_name"]
            if getattr(use_case, "estimate_assigned_by", None)
            else None
        ),
        "estimate_assigned_dt": _iso(getattr(use_case, "estimate_assigned_dt", None)),
        "estimate_due_date": _iso(getattr(use_case, "estimate_due_date", None)),
        "estimate_completed_dt": _iso(getattr(use_case, "estimate_completed_dt", None)),
        "estimate_data": getattr(use_case, "estimate_data", None),
        "roi_owner": getattr(use_case, "roi_owner", None),
        "roi_owner_name": (
            _resolve_user_display(db, use_case.roi_owner)["user_name"]
            if getattr(use_case, "roi_owner", None)
            else None
        ),
        "roi_owner_email": (
            _resolve_user_display(db, use_case.roi_owner)["user_email"]
            if getattr(use_case, "roi_owner", None)
            else None
        ),
        "roi_owner_role": (
            _resolve_user_display(db, use_case.roi_owner)["role_name"]
            if getattr(use_case, "roi_owner", None)
            else None
        ),
        "roi_assigned_by": getattr(use_case, "roi_assigned_by", None),
        "roi_assigned_by_name": (
            _resolve_user_display(db, use_case.roi_assigned_by)["user_name"]
            if getattr(use_case, "roi_assigned_by", None)
            else None
        ),
        "roi_assigned_dt": _iso(getattr(use_case, "roi_assigned_dt", None)),
        "roi_due_date": _iso(getattr(use_case, "roi_due_date", None)),
        "roi_completed_dt": _iso(getattr(use_case, "roi_completed_dt", None)),
        "roi_data": getattr(use_case, "roi_data", None),
        "assessment_owner": getattr(use_case, "assessment_owner", None),
        "assessment_owner_name": (
            _resolve_user_display(db, use_case.assessment_owner)["user_name"]
            if getattr(use_case, "assessment_owner", None)
            else None
        ),
        "assessment_assigned_by": getattr(use_case, "assessment_assigned_by", None),
        "assessment_assigned_by_name": (
            _resolve_user_display(db, use_case.assessment_assigned_by)["user_name"]
            if getattr(use_case, "assessment_assigned_by", None)
            else None
        ),
        "assessment_assigned_dt": _iso(getattr(use_case, "assessment_assigned_dt", None)),
        "assessment_due_date": _iso(getattr(use_case, "assessment_due_date", None)),
        "assessment_completed_dt": _iso(getattr(use_case, "assessment_completed_dt", None)),
    }


def _parse_due_date(value: str, *, allow_past: bool = False):
    from datetime import datetime as dt_cls, date as date_cls

    raw = (value or "").strip()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="due_date is required")
    try:
        if len(raw) == 10:
            parsed = dt_cls.strptime(raw, "%Y-%m-%d")
        else:
            parsed = dt_cls.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="due_date must be YYYY-MM-DD or an ISO datetime",
        ) from exc
    if not allow_past and parsed.date() < date_cls.today():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Due date cannot be in the past.")
    return parsed


def _user_has_role(db: Session, user_id: str, role_names: list[str]) -> bool:
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user or not user.role_id:
        return False
    role = db.query(Role).filter(Role.role_id == user.role_id).first()
    return bool(role and role.role_name in role_names)


def _is_workflow_governor(db: Session, user: User, domain_id: str) -> bool:
    """portal_admin, domain owner, or scoped ai_leader/domain_owner with domain access."""
    return is_domain_governor(db, user, domain_id)


def _require_workflow_governor(db: Session, user: User, domain_id: str, action_label: str) -> None:
    """403 with role vs domain-access messaging for assign/governance actions."""
    if _is_workflow_governor(db, user, domain_id):
        return
    if get_user_role_name(db, user) == "ai_leader" and not _user_can_open_domain(db, user.user_id, domain_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Only portal_admin, domain owner, or ai_leader can {action_label}.",
    )


def _can_assign_analysis(db: Session, user: User, domain_id: str) -> bool:
    """Only portal_admin, domain owner of this domain, or ai_leader may assign/reassign Analysis.

    tech_architect / business_reviewer may hold case_assign + workflow_analysis for their
    own track work, but must not reassign analysis owners.
    """
    return _is_workflow_governor(db, user, domain_id)


def _can_review_use_case(db: Session, user: User, domain_id: str) -> bool:
    """Send-back from Review is a governance action (not for Analysis track assignees)."""
    return _is_workflow_governor(db, user, domain_id)


def _can_assign_estimate(db: Session, user: User, domain_id: str) -> bool:
    """Only governors may move Review→Estimate / reassign Estimate."""
    return _is_workflow_governor(db, user, domain_id)


def _can_assign_roi(db: Session, user: User, domain_id: str) -> bool:
    """Only governors may assign/reassign ROI."""
    return _is_workflow_governor(db, user, domain_id)


def _can_assign_ai_assessment(db: Session, user: User, domain_id: str) -> bool:
    """Only governors may assign/reassign AI Assessment."""
    return _is_workflow_governor(db, user, domain_id)


def _portal_currency(db: Session) -> str:
    cfg = db.query(SystemConfig).first()
    raw = None
    if cfg and isinstance(cfg.config_data, dict):
        raw = cfg.config_data.get("currency")
    currency = (str(raw).strip().upper() if raw else "USD") or "USD"
    return currency if currency in CURRENCY_OPTIONS else "USD"


CONTENT_LOCKED_STATUSES = frozenset(
    {"Review", "Estimate", "ROI", "AI Assessment", "Approved", "Rejected"}
)
DATA_REQUIREMENT_EDITABLE_STATUSES = frozenset({"New", "Analysis"})
RISK_REVIEW_EDITABLE_STATUSES = frozenset(
    {"Analysis", "Review", "Estimate", "ROI", "AI Assessment"}
)

# Fields locked once past Analysis (Review+) unless portal_admin; estimate uses dedicated endpoints.
LOCKED_CONTENT_FIELDS = frozenset(
    {
        "use_case_name",
        "use_case_title",
        "use_case_description",
        "intended_use",
        "expected_benefits",
        "department",
        "ai_category",
        "feasibility",
        "intended_audience",
        "target_audience_type",
        "impacted_stakeholders",
        "technical_owner",
        "business_owner",
        "solution_design_overview",
        "human_in_loop_strategy",
        "bias_assessment_performed",
        "protected_attributes",
        "balancing_strategy",
        "frequency_of_task",
        "current_effort",
        "user_group_size",
        "efficiency_impact",
        "quality_compliance_impact",
        "user_urgency",
        "process_impact",
        "operational_compliance_risk",
        "tool_complexity",
        "host_system_capability",
        "data_privacy_security",
        "tags",
        "reference_links",
    }
)


def _require_editable_stage(use_case: UseCase, allowed_statuses: frozenset[str], detail: str) -> None:
    if use_case.status not in allowed_statuses:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _can_access_documentation_quality(db: Session, user: User) -> bool:
    """Return whether a user can view or run use case documentation quality scoring."""
    return check_permission(db, user, "domain_owner", allow_admin=True)


def _has_assessment_participation_permission(db: Session, user: User) -> bool:
    return (
        check_permission(db, user, "initiate_assessment", allow_admin=True)
        or check_permission(db, user, "contribute_assessment", allow_admin=True)
    )


def _should_include_documentation_quality_summary(db: Session, user: User) -> bool:
    """Include doc quality summary when needed for analysis UI or assessment eligibility."""
    return (
        _can_access_documentation_quality(db, user)
        or _has_assessment_participation_permission(db, user)
    )


@router.get("/eligible-technical-owners", response_model=list[EligibleOwnerResponse])
async def get_eligible_technical_owners(
    request: Request,
    db: Session = Depends(get_db),
    domain_id: str | None = Query(None),
):
    """tech_architect users who can open use cases in this domain."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    if not is_user_admin and not check_permission(db, user, "case_edit", allow_admin=False) and not check_permission(db, user, "case_assign", allow_admin=False):
        require_permission(db, user, "case_edit", allow_admin=True, error_message="You do not have permission to view eligible technical owners")
    return _to_eligible_owner_responses(_eligible_technical_owners(db, domain_id))


@router.get("/eligible-business-owners", response_model=list[EligibleOwnerResponse])
async def get_eligible_business_owners(
    request: Request,
    db: Session = Depends(get_db),
    domain_id: str | None = Query(None),
):
    """business_reviewer users who can open use cases in this domain."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    if not is_user_admin and not check_permission(db, user, "case_edit", allow_admin=False) and not check_permission(db, user, "case_assign", allow_admin=False):
        require_permission(db, user, "case_edit", allow_admin=True, error_message="You do not have permission to view eligible business owners")
    return _to_eligible_owner_responses(_eligible_business_owners(db, domain_id))


@router.get("/eligible-roi-owners", response_model=list[EligibleOwnerResponse])
async def get_eligible_roi_owners(
    request: Request,
    db: Session = Depends(get_db),
    domain_id: str | None = Query(None),
):
    """Users eligible to own ROI worksheets for a domain."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    if not is_user_admin and not check_permission(db, user, "case_assign", allow_admin=False):
        require_permission(db, user, "case_view", allow_admin=True)
    return _to_eligible_owner_responses(_eligible_roi_owners(db, domain_id))


@router.get("/eligible-assessment-owners", response_model=list[EligibleOwnerResponse])
async def get_eligible_assessment_owners(
    request: Request,
    db: Session = Depends(get_db),
    domain_id: str | None = Query(None),
):
    """Governance-team users eligible to own AI Assessment in this domain."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    if not is_user_admin and not check_permission(db, user, "case_assign", allow_admin=False):
        require_permission(db, user, "case_view", allow_admin=True)
    return _to_eligible_owner_responses(_eligible_assessment_owners(db, domain_id))


@router.get("/analysis/field-options", response_model=dict)
async def get_analysis_field_options(request: Request, db: Session = Depends(get_db)):
    """Return option lists for Analysis scoring fields."""
    get_current_user_id(request)
    return {
        "frequency_of_task": FREQUENCY_OF_TASK_OPTIONS,
        "current_effort": CURRENT_EFFORT_OPTIONS,
        "user_group_size": USER_GROUP_SIZE_OPTIONS,
        "efficiency_impact": EFFICIENCY_IMPACT_OPTIONS,
        "quality_compliance_impact": QUALITY_COMPLIANCE_IMPACT_OPTIONS,
        "user_urgency": USER_URGENCY_OPTIONS,
        "process_impact": PROCESS_IMPACT_OPTIONS,
        "operational_compliance_risk": OPERATIONAL_COMPLIANCE_RISK_OPTIONS,
        "tool_complexity": TOOL_COMPLEXITY_OPTIONS,
        "host_system_capability": HOST_SYSTEM_CAPABILITY_OPTIONS,
        "data_privacy_security": DATA_PRIVACY_SECURITY_OPTIONS,
        "deployment_model": DEPLOYMENT_MODEL_OPTIONS,
    }


@router.get("/document-types", response_model=list[dict])
async def get_use_case_document_types(request: Request, db: Session = Depends(get_db)):
    """Lookup values for the document type selector on References, Resource management, and Technical Analysis."""
    get_current_user_id(request)
    types = list_document_types(db)
    return [
        {
            "doc_type_id": item.doc_type_id,
            "name": item.name,
            "description": item.description,
        }
        for item in types
    ]


@router.get("/estimate/field-options", response_model=dict)
async def get_estimate_field_options(
    request: Request,
    db: Session = Depends(get_db),
):
    """Return estimate line types and portal default currency."""
    get_current_user_id(request)
    return {
        "currency_options": CURRENCY_OPTIONS,
        "default_currency": _portal_currency(db),
        "line_types": ESTIMATE_LINE_TYPES,
        "line_labels": ESTIMATE_LINE_LABELS,
        "line_keys": ESTIMATE_LINE_KEYS,
        "vendor_assessment_questions": VENDOR_ASSESSMENT_QUESTIONS,
    }


@router.get("/roi/field-options", response_model=dict)
async def get_roi_field_options(request: Request, db: Session = Depends(get_db)):
    """Return ROI saving categories and portal default currency."""
    get_current_user_id(request)
    return {
        "currency_options": CURRENCY_OPTIONS,
        "default_currency": _portal_currency(db),
        "saving_categories": ROI_SAVING_CATEGORIES,
    }


@router.get("/domain/{domain_id}")
async def get_use_cases_by_domain(
    domain_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get use cases for a domain. Requires case_view permission and domain access."""
    user_id = get_current_user_id(request)
    logger.info(f"Fetching use cases for domain: {domain_id}, user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "case_view",
        allow_admin=True,
        error_message="You do not have permission to view use cases"
    )

    # Get domain to check owner
    domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )

    # Check domain access (unless admin or owner)
    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            logger.warning(f"Use case access denied: domain: {domain_id}, user: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=DOMAIN_ACCESS_DENIED_DETAIL
            )

    use_cases = db.query(UseCase).filter(
        UseCase.domain_id == domain_id
    ).order_by(UseCase.created_dt.desc()).all()

    # Build response with tags and average_rating per use case (from comments)
    use_case_ids = [uc.use_case_id for uc in use_cases]
    rating_rows = (
        db.query(
            UseCaseComment.use_case_id,
            func.avg(UseCaseComment.rating).label("avg_rating"),
        )
        .filter(
            UseCaseComment.use_case_id.in_(use_case_ids),
            UseCaseComment.rating.isnot(None),
        )
        .group_by(UseCaseComment.use_case_id)
        .all()
    )
    rating_map = {row.use_case_id: round(float(row.avg_rating), 1) for row in rating_rows}

    # Resolve created_by -> user_name for "Initiated by" label
    creator_ids = [uc.created_by for uc in use_cases if uc.created_by]
    creator_map = {}
    if creator_ids:
        creators = db.query(User).filter(User.user_id.in_(creator_ids)).all()
        creator_map = {u.user_id: u.user_name for u in creators}

    documentation_quality_summary_map = {}
    if _should_include_documentation_quality_summary(db, user) and use_case_ids:
        documentation_quality_summary_map = (
            usecase_documentation_quality_service.get_documentation_quality_summary_map(
                db=db,
                use_cases=use_cases,
            )
        )

    result = []
    for uc in use_cases:
        tags = db.query(UseCaseTag).filter(UseCaseTag.use_case_id == uc.use_case_id).all()
        tag_names = [t.tag_name for t in tags]
        documentation_quality_summary = documentation_quality_summary_map.get(uc.use_case_id)
        item = {
            "use_case_id": uc.use_case_id,
            "domain_id": uc.domain_id,
            "use_case_name": uc.use_case_name,
            "use_case_title": uc.use_case_title,
            "use_case_description": uc.use_case_description,
            "intended_use": uc.intended_use,
            "expected_benefits": uc.expected_benefits,
            "department": uc.department,
            "ai_category": uc.ai_category,
            "feasibility": uc.feasibility,
            "status": uc.status,
            "intended_audience": uc.intended_audience,
            "target_audience_type": uc.target_audience_type,
            "impacted_stakeholders": uc.impacted_stakeholders,
            "rejection_reason": getattr(uc, "rejection_reason", None),
            "created_by": uc.created_by,
            "created_by_name": creator_map.get(uc.created_by) if uc.created_by else None,
            "created_dt": uc.created_dt.isoformat() if uc.created_dt else None,
            "modified_by": uc.modified_by,
            "modified_dt": uc.modified_dt.isoformat() if uc.modified_dt else None,
            "tags": tag_names,
            "average_rating": rating_map.get(uc.use_case_id),
            "has_demo": bool(getattr(uc, "demo_video_path", None)),
            "documentation_quality_summary": (
                documentation_quality_summary.model_dump(mode="json")
                if documentation_quality_summary
                else None
            ),
        }
        result.append(item)

    logger.debug(f"Found {len(use_cases)} use cases for domain: {domain_id}")
    return result


@router.get("/{use_case_id}")
async def get_use_case(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get a single use case by ID. Requires case_view permission and domain access."""
    user_id = get_current_user_id(request)
    logger.info(f"Fetching use case: {use_case_id}, user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "case_view",
        allow_admin=True,
        error_message="You do not have permission to view use cases"
    )

    # Get use case
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Use case not found"
        )

    # Get domain to check access
    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )

    # Check domain access (unless admin or owner)
    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            logger.warning(f"Use case access denied: use_case: {use_case_id}, domain: {use_case.domain_id}, user: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=DOMAIN_ACCESS_DENIED_DETAIL
            )

    logger.debug(f"Found use case: {use_case_id}")

    # Load tags
    tags = db.query(UseCaseTag).filter(UseCaseTag.use_case_id == use_case_id).all()
    tag_names = [tag.tag_name for tag in tags]

    # Load reference links and documents, then apply per-resource visibility rules.
    links = db.query(UseCaseLink).filter(UseCaseLink.use_case_id == use_case_id).order_by(UseCaseLink.link_id).all()
    docs = db.query(UseCaseDocument).filter(UseCaseDocument.use_case_id == use_case_id).order_by(UseCaseDocument.uploaded_dt.desc()).all()
    resource_payload = _build_use_case_resource_payload(db, user, links, docs)

    # Average rating from comments (1-5)
    avg_rating_row = (
        db.query(func.avg(UseCaseComment.rating))
        .filter(
            UseCaseComment.use_case_id == use_case_id,
            UseCaseComment.rating.isnot(None),
        )
        .scalar()
    )
    average_rating = round(float(avg_rating_row), 1) if avg_rating_row is not None else None

    # Resolve created_by -> user_name for "Initiated by" label
    created_by_name = None
    if use_case.created_by:
        creator = db.query(User).filter(User.user_id == use_case.created_by).first()
        created_by_name = creator.user_name if creator else None

    technical_owner_display = _resolve_user_display(db, use_case.technical_owner)
    business_owner_display = _resolve_user_display(db, use_case.business_owner)

    documentation_quality_summary = None
    if _should_include_documentation_quality_summary(db, user):
        documentation_quality_summary = (
            usecase_documentation_quality_service.get_documentation_quality_summary(
                db=db,
                use_case=use_case,
            )
        )

    # Convert to dict and add tags, average_rating, has_demo
    use_case_dict = {
        "use_case_id": use_case.use_case_id,
        "domain_id": use_case.domain_id,
        "use_case_name": use_case.use_case_name,
        "use_case_title": use_case.use_case_title,
        "use_case_description": use_case.use_case_description,
        "intended_use": use_case.intended_use,
        "expected_benefits": use_case.expected_benefits,
        "department": use_case.department,
        "ai_category": use_case.ai_category,
        "feasibility": use_case.feasibility,
        "status": use_case.status,
        "intended_audience": use_case.intended_audience,
        "target_audience_type": use_case.target_audience_type,
        "impacted_stakeholders": use_case.impacted_stakeholders,
        "technical_owner": use_case.technical_owner,
        "technical_owner_name": technical_owner_display["user_name"],
        "technical_owner_email": technical_owner_display["user_email"],
        "technical_owner_role_name": technical_owner_display["role_name"],
        "business_owner": use_case.business_owner,
        "business_owner_name": business_owner_display["user_name"],
        "business_owner_email": business_owner_display["user_email"],
        "solution_design_overview": use_case.solution_design_overview,
        "human_in_loop_strategy": use_case.human_in_loop_strategy,
        "bias_assessment_performed": bool(getattr(use_case, "bias_assessment_performed", False)),
        "protected_attributes": use_case.protected_attributes,
        "balancing_strategy": use_case.balancing_strategy,
        "rejection_reason": getattr(use_case, "rejection_reason", None),
        "created_by": use_case.created_by,
        "created_by_name": created_by_name,
        "created_dt": use_case.created_dt.isoformat() if use_case.created_dt else None,
        "modified_by": use_case.modified_by,
        "modified_dt": use_case.modified_dt.isoformat() if use_case.modified_dt else None,
        "tags": tag_names,
        "average_rating": average_rating,
        "has_demo": bool(getattr(use_case, "demo_video_path", None)),
        "documentation_quality_summary": (
            documentation_quality_summary.model_dump(mode="json")
            if documentation_quality_summary
            else None
        ),
        **_analysis_payload(use_case, db),
        **resource_payload,
    }

    return use_case_dict


class UseCaseAuditLogResponse(BaseModel):
    """Audit log entry for a use case (no audit_access required; scoped to use case)."""
    audit_id: str
    audit_date: str
    type: str
    action: str
    user_id: str | None
    details: dict | None
    user_name: str | None = None


def _require_use_case_access(db: Session, user_id: str, use_case_id: str):
    """Require case_view and domain access for this use case. Returns (user, use_case)."""
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "case_view",
        allow_admin=True,
        error_message="You do not have permission to view this use case"
    )
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this use case")
    return user, use_case


@router.get("/{use_case_id}/audit-logs", response_model=list[UseCaseAuditLogResponse])
async def get_use_case_audit_logs(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get audit logs for this use case only. Requires case_view and domain access (no audit_access)."""
    user_id = get_current_user_id(request)
    _require_use_case_access(db, user_id, use_case_id)
    # Fetch use_case type logs and filter by use_case_id in details (portable across DBs)
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.type == "use_case")
        .order_by(AuditLog.audit_date.desc())
        .limit(2000)
        .all()
    )
    result_logs = [log for log in logs if log.details and log.details.get("use_case_id") == use_case_id]
    result = []
    for log in result_logs:
        user_name = None
        if log.user_id:
            u = db.query(User).filter(User.user_id == log.user_id).first()
            if u:
                user_name = u.user_name
        result.append(UseCaseAuditLogResponse(
            audit_id=log.audit_id,
            audit_date=log.audit_date.isoformat(),
            type=log.type,
            action=log.action,
            user_id=log.user_id,
            details=log.details,
            user_name=user_name
        ))
    return result


def _sanitize_filename(name: str) -> str:
    """Keep only safe characters for a stored filename."""
    if not name or not name.strip():
        return "document"
    name = name.strip()
    name = re.sub(r'[^\w\s\-\.]', '', name)
    name = re.sub(r'\s+', '_', name)
    return name[:200] or "document"


def _normalize_content_type(value: str | None) -> str:
    """Normalize a MIME type string for comparisons."""
    return (value or "").split(";", 1)[0].strip().lower()


def _category_for_extension(extension: str) -> str | None:
    """Map a file extension to the supported document category."""
    extension = (extension or "").lower()
    for category, rules in DOCUMENT_TYPE_RULES.items():
        if extension in rules["extensions"]:
            return category
    return None


def _document_extension_for_file_name(file_name: str) -> str:
    """Return the supported upload extension, including multipart archive suffixes."""
    file_name_lower = (file_name or "").lower()
    for extension in sorted(MULTIPART_ARCHIVE_EXTENSIONS, key=len, reverse=True):
        if file_name_lower.endswith(extension):
            return extension
    return Path(file_name).suffix.lower()


def _extract_infographic_category(file_name: str) -> str | None:
    """Return the infographic category encoded in INFOGRAPHIC__TYPE__Name.ext."""
    if not file_name:
        return None
    if not file_name.upper().startswith("INFOGRAPHIC__"):
        return None
    match = INFOGRAPHIC_FILE_PATTERN.match(file_name)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid infographic filename format",
        )
    category = match.group(1).upper()
    if category not in ALLOWED_INFOGRAPHIC_DOCUMENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Infographics support only PDF, HTML, and image files",
        )
    return category


def _is_infographic_file_name(file_name: str | None) -> bool:
    return bool(file_name and file_name.upper().startswith("INFOGRAPHIC__"))


def _normalize_reference_links(reference_links: list[object] | None) -> list[dict]:
    normalized_links: list[dict] = []
    for link_input in reference_links or []:
        if not link_input:
            continue
        if isinstance(link_input, dict):
            url = (link_input.get("url") or "").strip()
            label = (link_input.get("label") or "").strip() or None
        else:
            url = (getattr(link_input, "url", "") or "").strip()
            label = (getattr(link_input, "label", "") or "").strip() or None
        if url:
            normalized_links.append({"url": url, "label": label})
    return normalized_links


def _validate_live_demo_link_limit(reference_links: list[object] | None) -> list[dict]:
    normalized_links = _normalize_reference_links(reference_links)
    if len(normalized_links) > MAX_LIVE_DEMO_LINKS_PER_USE_CASE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only one live demo link is allowed per use case",
        )
    return normalized_links


def _replace_use_case_reference_links(
    db: Session,
    use_case_id: str,
    user_id: str,
    reference_links: list[object] | None,
) -> list[dict]:
    normalized_reference_links = _validate_live_demo_link_limit(reference_links)
    db.query(UseCaseLink).filter(UseCaseLink.use_case_id == use_case_id).delete()
    for link_input in normalized_reference_links:
        db.add(
            UseCaseLink(
                use_case_id=use_case_id,
                url=link_input["url"],
                label=link_input["label"],
                created_by=user_id,
            )
        )
    return normalized_reference_links


def _get_use_case_resource_view_flags(db: Session, user: User) -> dict[str, bool]:
    return {
        "can_view_demo": check_permission(db, user, "view_demo", allow_admin=True),
        "can_view_live_demo": check_permission(db, user, "view_live_demo", allow_admin=True),
        "can_view_document": check_permission(db, user, "view_document", allow_admin=True),
        "can_view_infographic": check_permission(db, user, "view_infographic", allow_admin=True),
    }


def _serialize_visible_reference_links(
    links: list[UseCaseLink],
    *,
    can_view_live_demo: bool,
) -> list[dict]:
    if not can_view_live_demo:
        return []
    return [{"link_id": link.link_id, "url": link.url, "label": link.label} for link in links]


def _serialize_document(doc: UseCaseDocument) -> dict:
    return {
        "document_id": doc.document_id,
        "file_name": doc.file_name,
        "size_bytes": doc.size_bytes,
        "uploaded_dt": doc.uploaded_dt.isoformat() if doc.uploaded_dt else None,
        "document_type": getattr(doc, "document_type", None),
        "source": getattr(doc, "source", None) or DEFAULT_DOCUMENT_SOURCE,
    }


def _serialize_visible_documents(
    docs: list[UseCaseDocument],
    *,
    can_view_document: bool,
    can_view_infographic: bool,
) -> list[dict]:
    visible_documents: list[dict] = []
    for doc in docs:
        is_infographic = _is_infographic_file_name(doc.file_name)
        if is_infographic and not can_view_infographic:
            continue
        if not is_infographic and not can_view_document:
            continue
        visible_documents.append(_serialize_document(doc))
    return visible_documents


def _build_use_case_resource_payload(
    db: Session,
    user: User,
    links: list[UseCaseLink],
    docs: list[UseCaseDocument],
) -> dict:
    flags = _get_use_case_resource_view_flags(db, user)
    return {
        **flags,
        "reference_links": _serialize_visible_reference_links(
            links,
            can_view_live_demo=flags["can_view_live_demo"],
        ),
        "documents": _serialize_visible_documents(
            docs,
            can_view_document=flags["can_view_document"],
            can_view_infographic=flags["can_view_infographic"],
        ),
    }


def _require_use_case_document_view_permission(db: Session, user: User, doc: UseCaseDocument) -> None:
    is_infographic = _is_infographic_file_name(doc.file_name)
    permission_name = "view_infographic" if is_infographic else "view_document"
    error_message = (
        "You do not have permission to view infographics"
        if is_infographic
        else "You do not have permission to view documents"
    )
    require_permission(
        db,
        user,
        permission_name,
        allow_admin=True,
        error_message=error_message,
    )


def _get_use_case_resource_file_counts(db: Session, use_case_id: str) -> dict[str, int]:
    docs = db.query(UseCaseDocument).filter(UseCaseDocument.use_case_id == use_case_id).all()
    resource_docs = [doc for doc in docs if not is_technical_analysis_source(getattr(doc, "source", None))]
    infographic_count = sum(1 for doc in resource_docs if _is_infographic_file_name(doc.file_name))
    total_count = len(resource_docs)
    return {
        "total_count": total_count,
        "document_count": total_count - infographic_count,
        "infographic_count": infographic_count,
    }


def _validate_use_case_resource_file_upload_limit(db: Session, use_case_id: str, files: list[UploadFile]) -> None:
    uploaded_file_names: list[str] = []
    infographic_file_names: list[str] = []
    document_file_names: list[str] = []
    for upload in files:
        if not upload.filename:
            continue
        uploaded_file_names.append(upload.filename)
        if _extract_infographic_category(upload.filename):
            infographic_file_names.append(upload.filename)
        else:
            document_file_names.append(upload.filename)

    if not uploaded_file_names:
        return

    if infographic_file_names and document_file_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload either document file(s) or one infographic file in a single request, not both.",
        )

    existing_counts = _get_use_case_resource_file_counts(db, use_case_id)
    if infographic_file_names:
        if len(infographic_file_names) > MAX_INFOGRAPHIC_FILES_PER_USE_CASE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only one infographic file can be uploaded per use case.",
            )

        if existing_counts["infographic_count"] >= MAX_INFOGRAPHIC_FILES_PER_USE_CASE:
            detail = "Only one infographic file is allowed per use case. Delete the existing infographic file first."
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=detail,
            )
        return


def _looks_like_html_content(content: bytes) -> bool:
    """Best-effort HTML detection for uploaded .html/.htm files."""
    if not content:
        return False
    sample = content[:4096]
    if b"\x00" in sample:
        return False
    decoded = None
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            decoded = sample.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if decoded is None:
        return False
    snippet = decoded.strip().lower()
    if "<" not in snippet or ">" not in snippet:
        return False
    html_markers = (
        "<!doctype html",
        "<html",
        "<head",
        "<body",
        "<div",
        "<p",
        "<span",
        "<img",
        "<table",
        "<section",
        "<article",
    )
    return any(marker in snippet for marker in html_markers)


def _detect_document_type(extension: str, content: bytes) -> tuple[str | None, str | None]:
    """Detect the supported document category and canonical MIME type from content."""
    extension = (extension or "").lower()
    if not content:
        return None, None

    if extension == ".pdf" and content.startswith(b"%PDF-"):
        return "PDF", "application/pdf"

    if extension == ".png" and content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "IMAGE", "image/png"
    if extension in {".jpg", ".jpeg"} and content.startswith(b"\xff\xd8\xff"):
        return "IMAGE", "image/jpeg"
    if extension == ".gif" and content[:6] in {b"GIF87a", b"GIF89a"}:
        return "IMAGE", "image/gif"
    if extension == ".webp" and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "IMAGE", "image/webp"

    if extension == ".doc" and content.startswith(OLE_MAGIC):
        return "DOC", "application/msword"
    if extension == ".ppt" and content.startswith(OLE_MAGIC):
        return "PPT", "application/vnd.ms-powerpoint"
    if extension == ".xls" and content.startswith(OLE_MAGIC):
        return "XLS", "application/vnd.ms-excel"

    if extension in {".docx", ".pptx", ".xlsx"}:
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                names = archive.namelist()
        except zipfile.BadZipFile:
            return None, None

        if extension == ".docx" and any(name.startswith("word/") for name in names):
            return "DOC", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if extension == ".pptx" and any(name.startswith("ppt/") for name in names):
            return "PPT", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        if extension == ".xlsx" and any(name.startswith("xl/") for name in names):
            return "XLS", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        return None, None

    if extension in {".html", ".htm"} and _looks_like_html_content(content):
        return "HTML", "text/html"

    if extension == ".zip" and content.startswith(ZIP_MAGIC_PREFIXES):
        return "ARCHIVE", ARCHIVE_CONTENT_TYPES_BY_EXTENSION[extension]
    if extension == ".rar" and (content.startswith(RAR4_MAGIC) or content.startswith(RAR5_MAGIC)):
        return "ARCHIVE", ARCHIVE_CONTENT_TYPES_BY_EXTENSION[extension]
    if extension == ".tar" and len(content) > 262 and content[257:262] == b"ustar":
        return "ARCHIVE", ARCHIVE_CONTENT_TYPES_BY_EXTENSION[extension]
    if extension in {".tar.gz", ".tgz"} and content.startswith(b"\x1f\x8b"):
        return "ARCHIVE", ARCHIVE_CONTENT_TYPES_BY_EXTENSION[extension]
    if extension in {".tar.bz2", ".tbz", ".tbz2"} and content.startswith(b"BZh"):
        return "ARCHIVE", ARCHIVE_CONTENT_TYPES_BY_EXTENSION[extension]
    if extension in {".tar.xz", ".txz"} and content.startswith(XZ_MAGIC):
        return "ARCHIVE", ARCHIVE_CONTENT_TYPES_BY_EXTENSION[extension]

    return None, None

def _validate_use_case_document_file(
    file_name: str,
    upload_content_type: str | None,
    content: bytes,
) -> tuple[str, str]:
    """Validate uploaded or stored document content against supported types."""
    if not file_name or not file_name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File name is required",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    extension = _document_extension_for_file_name(file_name)
    expected_category = _category_for_extension(extension)
    if not expected_category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Allowed types: {ALLOWED_DOCUMENT_TYPE_LABELS}",
        )

    actual_category, detected_content_type = _detect_document_type(extension, content)
    if actual_category != expected_category or not detected_content_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file content does not match its extension",
        )

    normalized_upload_type = _normalize_content_type(upload_content_type)
    rules = DOCUMENT_TYPE_RULES[expected_category]
    if (
        normalized_upload_type
        and normalized_upload_type not in GENERIC_UPLOAD_MIME_TYPES
        and normalized_upload_type not in rules["mime_types"]
        and normalized_upload_type not in rules["fallback_upload_mime_types"]
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file MIME type does not match the actual file type",
        )

    infographic_category = _extract_infographic_category(file_name)
    if infographic_category and infographic_category != actual_category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Infographic filename type does not match the uploaded file",
        )

    return actual_category, detected_content_type


def _get_use_case_document_or_404(db: Session, use_case_id: str, document_id: int) -> UseCaseDocument:
    """Fetch a use case document or raise 404."""
    doc = db.query(UseCaseDocument).filter(
        UseCaseDocument.use_case_id == use_case_id,
        UseCaseDocument.document_id == document_id
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


def _resolve_use_case_document_file_path(doc: UseCaseDocument) -> Path:
    """Resolve a stored document path safely under FILE_STORAGE_ROOT."""
    docs_root = settings.get_use_case_docs_root()
    docs_root_resolved = docs_root.resolve()
    candidate = Path((doc.stored_path or "").replace("\\", "/"))
    full_path = (docs_root_resolved / candidate).resolve()

    try:
        full_path.relative_to(docs_root_resolved)
    except ValueError:
        logger.warning(f"Document path escapes FILE_STORAGE_ROOT: {full_path}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document path",
        )

    if not full_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on disk")
    return full_path


def _require_use_case_edit(db: Session, user_id: str, use_case_id: str):
    """
    Require edit rights for this use case (documents, etc.).

    Allowed when the user has domain access and any of:
    - portal_admin
    - case_edit
    - creator while status is New
    - Analysis technical/business owner while status is Analysis

    Returns (user, use_case).
    """
    user, use_case = _require_use_case_access(db, user_id, use_case_id)
    _, _, is_user_admin = get_user_with_permissions(db, user_id)
    if is_user_admin:
        return user, use_case

    if use_case.status in ("Approved", "Rejected"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to edit this use case",
        )

    has_case_edit = check_permission(
        db, user, "case_edit", allow_admin=True, domain_id=use_case.domain_id
    )
    is_initiator_in_new = (
        use_case.created_by == user_id and use_case.status == "New"
    )
    is_analysis_assignee = (
        use_case.status == "Analysis"
        and (
            use_case.technical_owner == user_id
            or use_case.business_owner == user_id
        )
    )
    if has_case_edit or is_initiator_in_new or is_analysis_assignee:
        return user, use_case

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to edit this use case",
    )


@router.get("/demo/videos", response_model=list[DemoVideoItem])
async def list_demo_videos(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    List available demo videos under DEMO_VIDEOS_ROOT.
    Requires map_demo permission (Admin bypass enabled).
    """
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "map_demo",
        allow_admin=True,
        error_message="You do not have permission to view demo videos for mapping",
    )

    root = settings.get_demo_videos_root()
    if not root.exists() or not root.is_dir():
        logger.info(f"Demo videos root does not exist or is not a directory: {root}")
        return []

    items: list[DemoVideoItem] = []
    try:
        # Walk all files and filter by extension in a case-insensitive way
        for p in sorted(root.rglob("*")):
            if not p.is_file():
                continue
            if p.suffix.lower() != ".mp4":
                continue
            try:
                rel_path = p.relative_to(root).as_posix()
            except ValueError:
                # Skip files outside the root (defensive)
                continue
            size = None
            try:
                size = p.stat().st_size
            except Exception:
                size = None
            items.append(DemoVideoItem(path=rel_path, name=p.name, size_bytes=size))
    except Exception as e:
        logger.error(f"Error while listing demo videos under {root}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list demo videos",
        )
    return items


@router.get("/{use_case_id}/documents", response_model=list[dict])
async def list_use_case_documents(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """List visible reference documents for a use case. Requires case_view and domain access."""
    user_id = get_current_user_id(request)
    user, _ = _require_use_case_access(db, user_id, use_case_id)
    docs = db.query(UseCaseDocument).filter(UseCaseDocument.use_case_id == use_case_id).order_by(UseCaseDocument.uploaded_dt.desc()).all()
    return _build_use_case_resource_payload(db, user, [], docs)["documents"]


@router.post("/{use_case_id}/documents", response_model=list[dict])
async def upload_use_case_documents(
    use_case_id: str,
    request: Request,
    files: list[UploadFile] = File(...),
    document_type: str | None = Form(None),
    source: str | None = Form(None),
    db: Session = Depends(get_db)
):
    """Upload document file(s) or one infographic file for a use case.

    Requires domain access plus case_edit, creator-in-New, or Analysis assignee.
    Regular documents (References and Resource management, source=reference) and
    Technical Analysis supporting files require a document type from the lookup.
    Infographic uploads do not use the document-type lookup.
    """
    user_id = get_current_user_id(request)
    _require_use_case_edit(db, user_id, use_case_id)
    resolved_source = normalize_document_source(source)
    if resolved_source != "technical_analysis":
        _validate_use_case_resource_file_upload_limit(db, use_case_id, files)
    requested_type = (document_type or "").strip()
    resolved_type = resolve_document_type_name(db, requested_type)
    if requested_type and not resolved_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown document type. Add it in Settings > Document Types first.",
        )
    docs_root = settings.get_use_case_docs_root()
    use_case_dir = docs_root / use_case_id
    use_case_dir.mkdir(parents=True, exist_ok=True)
    prepared_uploads = []
    for uf in files:
        if not uf.filename:
            continue
        try:
            content = await uf.read()
            _, normalized_content_type = _validate_use_case_document_file(
                uf.filename,
                uf.content_type,
                content,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to validate document {uf.filename}: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to validate uploaded file",
            )
        is_infographic = _is_infographic_file_name(uf.filename)
        if not is_infographic and not resolved_type:
            detail = (
                "Select a document type before uploading technical supporting files"
                if resolved_source == "technical_analysis"
                else "Select a document type before uploading documents"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=detail,
            )
        safe_name = _sanitize_filename(uf.filename)
        unique_name = f"{uuid.uuid4().hex}_{safe_name}"
        stored_path = f"{use_case_id}/{unique_name}"
        file_path = use_case_dir / unique_name
        prepared_uploads.append(
            {
                "file_name": uf.filename,
                "content": content,
                "normalized_content_type": normalized_content_type,
                "stored_path": stored_path,
                "file_path": file_path,
                "document_type": None if is_infographic else resolved_type,
                "source": resolved_source,
            }
        )

    uploaded_docs: list[UseCaseDocument] = []
    written_files: list[Path] = []
    try:
        for item in prepared_uploads:
            item["file_path"].write_bytes(item["content"])
            written_files.append(item["file_path"])
            doc = UseCaseDocument(
                use_case_id=use_case_id,
                file_name=item["file_name"],
                stored_path=item["stored_path"],
                content_type=item["normalized_content_type"],
                size_bytes=len(item["content"]),
                document_type=item.get("document_type"),
                source=item.get("source") or DEFAULT_DOCUMENT_SOURCE,
                uploaded_by=user_id
            )
            db.add(doc)
            uploaded_docs.append(doc)
        db.commit()
    except Exception as e:
        db.rollback()
        for file_path in written_files:
            if file_path.is_file():
                try:
                    file_path.unlink()
                except Exception as cleanup_error:
                    logger.warning(f"Could not clean up file {file_path}: {cleanup_error}")
        logger.error(f"Failed to save document batch for use_case_id={use_case_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save file")

    uploaded = []
    for doc in uploaded_docs:
        try:
            db.refresh(doc)
        except Exception as exc:
            logger.debug("Could not refresh uploaded document %s: %s", doc.document_id, exc)
        uploaded.append(_serialize_document(doc))
    return uploaded


@router.get("/{use_case_id}/documents/{document_id}")
async def download_use_case_document(
    use_case_id: str,
    document_id: int,
    request: Request,
    db: Session = Depends(get_db)
):
    """Download a visible reference document. Requires case_view/domain access and resource view permission."""
    user_id = get_current_user_id(request)
    user, _ = _require_use_case_access(db, user_id, use_case_id)
    doc = _get_use_case_document_or_404(db, use_case_id, document_id)
    _require_use_case_document_view_permission(db, user, doc)
    file_path = _resolve_use_case_document_file_path(doc)
    return FileResponse(path=str(file_path), filename=doc.file_name, media_type=doc.content_type or "application/octet-stream")


@router.get("/{use_case_id}/documents/{document_id}/preview")
async def preview_use_case_document(
    use_case_id: str,
    document_id: int,
    request: Request,
    db: Session = Depends(get_db)
):
    """Preview a visible reference document inside the application when a safe preview is available."""
    user_id = get_current_user_id(request)
    user, _ = _require_use_case_access(db, user_id, use_case_id)
    doc = _get_use_case_document_or_404(db, use_case_id, document_id)
    _require_use_case_document_view_permission(db, user, doc)
    file_path = _resolve_use_case_document_file_path(doc)
    content = file_path.read_bytes()

    try:
        category, normalized_content_type = _validate_use_case_document_file(
            doc.file_name,
            doc.content_type,
            content,
        )
    except HTTPException as exc:
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "preview_available": False,
                "file_name": doc.file_name,
                "message": exc.detail,
                "download_url": str(
                    request.url_for(
                        "download_use_case_document",
                        use_case_id=use_case_id,
                        document_id=document_id,
                    )
                ),
            },
        )

    safe_name = _sanitize_filename(doc.file_name)
    if category in {"PDF", "IMAGE"}:
        return FileResponse(
            path=str(file_path),
            media_type=normalized_content_type,
            headers={
                "Content-Disposition": f'inline; filename="{safe_name}"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    preview_headers = {
        "Content-Disposition": f'inline; filename="{safe_name}"',
        "Content-Security-Policy": HTML_PREVIEW_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    }

    if category == "HTML":
        return HTMLResponse(
            content=sanitize_html_for_preview(content),
            headers=preview_headers,
        )

    if category in {"DOC", "PPT", "XLS"}:
        try:
            preview = render_office_document_preview(category, doc.file_name, content)
        except Exception as exc:
            logger.warning(
                "Failed to convert %s preview for document_id=%s: %s",
                category,
                document_id,
                exc,
            )
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "preview_available": False,
                    "file_name": doc.file_name,
                    "file_type": category,
                    "message": (
                        "This file could not be converted for in-app preview. "
                        "Download the original file to view it."
                    ),
                    "download_url": str(
                        request.url_for(
                            "download_use_case_document",
                            use_case_id=use_case_id,
                            document_id=document_id,
                        )
                    ),
                },
            )
        if preview.media_type.startswith("application/pdf"):
            preview_name = safe_name
            if not preview_name.lower().endswith(".pdf"):
                preview_name = f"{Path(safe_name).stem}.pdf"
            return Response(
                content=preview.content,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'inline; filename="{preview_name}"',
                    "X-Content-Type-Options": "nosniff",
                    "Cache-Control": "no-store",
                },
            )
        return HTMLResponse(content=preview.content, headers=preview_headers)

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "preview_available": False,
            "file_name": doc.file_name,
            "file_type": category,
            "message": "Internal preview conversion is not available for this file type",
            "download_url": str(
                request.url_for(
                    "download_use_case_document",
                    use_case_id=use_case_id,
                    document_id=document_id,
                )
            ),
        },
    )


@router.delete("/{use_case_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_use_case_document(
    use_case_id: str,
    document_id: int,
    request: Request,
    db: Session = Depends(get_db)
):
    """Delete a reference document.

    Requires domain access plus case_edit, creator-in-New, or Analysis assignee.
    """
    user_id = get_current_user_id(request)
    _require_use_case_edit(db, user_id, use_case_id)
    doc = db.query(UseCaseDocument).filter(
        UseCaseDocument.use_case_id == use_case_id,
        UseCaseDocument.document_id == document_id
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    docs_root = settings.get_use_case_docs_root()
    file_path = docs_root / doc.stored_path
    if file_path.is_file():
        try:
            file_path.unlink()
        except Exception as e:
            logger.warning(f"Could not delete file {file_path}: {e}")
    db.delete(doc)
    db.commit()

@router.post("/{use_case_id}/demo", response_model=dict)
async def upload_use_case_demo(
    use_case_id: str,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Upload or replace a demo video (.mp4) for a use case.
    Requires map_demo permission and domain access (Admin bypass enabled).
    File is stored under DEMO_VIDEOS_ROOT in a per-use-case folder.
    """
    user_id = get_current_user_id(request)
    user, use_case = _require_use_case_access(db, user_id, use_case_id)
    require_permission(
        db,
        user,
        "map_demo",
        allow_admin=True,
        error_message="You do not have permission to upload demo videos",
    )

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided",
        )

    filename = file.filename.strip()
    if not filename.lower().endswith(".mp4"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .mp4 demo videos are supported",
        )

    root = settings.get_demo_videos_root()
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.error(f"Failed to ensure demo videos root directory {root}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Demo videos storage is not configured correctly",
        )

    safe_name = _sanitize_filename(filename)
    target_dir = root / use_case_id
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.error(f"Failed to create demo folder {target_dir}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create demo folder",
        )

    dest_path = target_dir / safe_name
    try:
        content = await file.read()
        dest_path.write_bytes(content)
    except Exception as e:
        logger.error(f"Failed to write demo video for use_case_id={use_case_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save demo video",
        )

    rel_path = f"{use_case_id}/{safe_name}"
    use_case.demo_video_path = rel_path
    use_case.modified_by = user_id
    db.commit()

    return {"use_case_id": use_case.use_case_id, "has_demo": True}


@router.post("/{use_case_id}/demo/map", response_model=dict)
async def map_use_case_demo(
    use_case_id: str,
    body: DemoVideoMapRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Map an existing demo video (by relative path under DEMO_VIDEOS_ROOT) to a use case.
    Requires map_demo permission and domain access (Admin bypass enabled).
    """
    user_id = get_current_user_id(request)
    user, use_case = _require_use_case_access(db, user_id, use_case_id)
    require_permission(
        db,
        user,
        "map_demo",
        allow_admin=True,
        error_message="You do not have permission to map demo videos",
    )

    demo_path_raw = (body.demo_path or "").strip()
    if not demo_path_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="demo_path is required",
        )

    # Normalize to POSIX-style
    demo_path_norm = demo_path_raw.replace("\\", "/")
    candidate = Path(demo_path_norm)

    # Basic path traversal protection
    if ".." in candidate.parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid demo_path",
        )

    root = settings.get_demo_videos_root()
    root_resolved = root.resolve()
    full_path = (root_resolved / candidate).resolve()

    try:
        full_path.relative_to(root_resolved)
    except ValueError:
        # Escapes root
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid demo_path",
        )

    if not full_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Demo video not found",
        )

    use_case.demo_video_path = candidate.as_posix()
    use_case.modified_by = user_id
    db.commit()

    return {"use_case_id": use_case.use_case_id, "has_demo": True}


@router.delete("/{use_case_id}/demo", response_model=dict)
async def delink_use_case_demo(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Delink the mapped demo video from a use case without deleting the physical file.
    Requires case_view/domain access and Admin role.
    """
    user_id = get_current_user_id(request)
    user, use_case = _require_use_case_access(db, user_id, use_case_id)
    if not is_admin(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can delink demo videos",
        )

    current_demo_path = getattr(use_case, "demo_video_path", None)
    if not current_demo_path:
        return {
            "use_case_id": use_case.use_case_id,
            "has_demo": False,
            "demo_video_path": None,
            "message": "No demo video was mapped, nothing to delink",
        }

    use_case.demo_video_path = None
    use_case.modified_by = user_id

    audit_log = AuditLog(
        type="use_case",
        action="demo_delink",
        user_id=user_id,
        details={
            "use_case_id": use_case.use_case_id,
            "use_case_name": use_case.use_case_name,
            "domain_id": use_case.domain_id,
            "delinked_demo_video_path": current_demo_path,
            "message": f"Demo video delinked by admin user {user_id}",
        }
    )
    db.add(audit_log)
    db.commit()

    return {
        "use_case_id": use_case.use_case_id,
        "has_demo": False,
        "demo_video_path": None,
        "message": "Demo video delinked successfully",
    }


@router.get("/{use_case_id}/demo")
async def get_use_case_demo(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Stream the mapped demo video for a use case.
    Requires view_demo permission and domain access (Admin bypass enabled).
    """
    user_id = get_current_user_id(request)
    user, use_case = _require_use_case_access(db, user_id, use_case_id)
    require_permission(
        db,
        user,
        "view_demo",
        allow_admin=True,
        error_message="You do not have permission to view demo videos",
    )

    rel_path = getattr(use_case, "demo_video_path", None)
    if not rel_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No demo video mapped for this use case",
        )

    root = settings.get_demo_videos_root()
    root_resolved = root.resolve()
    candidate = Path(rel_path.replace("\\", "/"))
    full_path = (root_resolved / candidate).resolve()

    try:
        full_path.relative_to(root_resolved)
    except ValueError:
        logger.warning(
            f"Demo video path for use_case_id={use_case_id} escapes DEMO_VIDEOS_ROOT: {full_path}"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid demo video path",
        )

    if not full_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Demo video not found",
        )

    file_size = full_path.stat().st_size

    # Support HTTP Range requests so the client can seek within the video
    range_header = request.headers.get("range")
    if not range_header:
        # Fallback: full-file response but still advertise range support
        return FileResponse(
            path=str(full_path),
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes"},
        )

    range_match = re.match(r"bytes=(\d+)-(\d*)", range_header.strip())
    if not range_match:
        # Malformed Range header
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Invalid Range header",
        )

    start = int(range_match.group(1))
    end_str = range_match.group(2)
    end = file_size - 1 if not end_str else min(int(end_str), file_size - 1)

    if start >= file_size or start > end:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Requested range not satisfiable",
        )

    chunk_size = 1024 * 1024

    def iter_file(start_pos: int, end_pos: int):
        with open(full_path, "rb") as f:
            f.seek(start_pos)
            bytes_remaining = end_pos - start_pos + 1
            while bytes_remaining > 0:
                read_size = min(chunk_size, bytes_remaining)
                data = f.read(read_size)
                if not data:
                    break
                bytes_remaining -= len(data)
                yield data

    content_length = end - start + 1
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
    }

    return StreamingResponse(
        iter_file(start, end),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type="video/mp4",
        headers=headers,
    )

@router.post("/", response_model=dict)
async def create_use_case(
    use_case_data: UseCaseCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Create a new use case. Requires case_create permission and domain access."""
    user_id = get_current_user_id(request)
    logger.info(f"Creating use case: {use_case_data.use_case_name} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "case_create",
        allow_admin=True,
        error_message="You do not have permission to create use cases"
    )

    # Get domain to check access
    domain = db.query(Domain).filter(Domain.domain_id == use_case_data.domain_id).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )

    # Check domain access (unless admin or owner)
    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case_data.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            logger.warning(f"Use case creation denied: domain: {use_case_data.domain_id}, user: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=DOMAIN_ACCESS_DENIED_DETAIL
            )

    normalized_ai_category = _resolve_ai_category(use_case_data.ai_category)

    normalized_reference_links = _validate_live_demo_link_limit(use_case_data.reference_links)

    # Check duplicate use case name within the same domain
    existing_name = db.query(UseCase).filter(
        UseCase.domain_id == use_case_data.domain_id,
        UseCase.use_case_name == use_case_data.use_case_name.strip()
    ).first()
    if existing_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A use case with this name already exists in this domain"
        )

    # Create use case
    # Status is forced to "New" on initial creation regardless of client input
    new_use_case = UseCase(
        domain_id=use_case_data.domain_id,
        use_case_name=use_case_data.use_case_name,
        use_case_title=use_case_data.use_case_title,
        use_case_description=use_case_data.use_case_description,
        intended_use=use_case_data.intended_use,
        expected_benefits=use_case_data.expected_benefits,
        department=use_case_data.department,
        ai_category=normalized_ai_category,
        feasibility=use_case_data.feasibility,
        intended_audience=use_case_data.intended_audience,
        target_audience_type=use_case_data.target_audience_type,
        impacted_stakeholders=use_case_data.impacted_stakeholders,
        status="New",
        created_by=user_id,
        modified_by=user_id
    )
    db.add(new_use_case)
    db.commit()
    db.refresh(new_use_case)

    # Add tags if provided
    if use_case_data.tags:
        for tag_name in use_case_data.tags:
            if tag_name and tag_name.strip():
                tag = UseCaseTag(
                    use_case_id=new_use_case.use_case_id,
                    tag_name=tag_name.strip(),
                    created_by=user_id
                )
                db.add(tag)
        db.commit()

    # Add reference links if provided
    if normalized_reference_links:
        for link_input in normalized_reference_links:
            link = UseCaseLink(
                use_case_id=new_use_case.use_case_id,
                url=link_input["url"],
                label=link_input["label"],
                created_by=user_id
            )
            db.add(link)
        db.commit()

    # Create audit log
    audit_log = AuditLog(
        type="use_case",
        action="create",
        user_id=user_id,
        details={"use_case_id": new_use_case.use_case_id, "use_case_name": new_use_case.use_case_name, "domain_id": use_case_data.domain_id}
    )
    db.add(audit_log)
    db.commit()

    logger.info(f"Use case created successfully: {new_use_case.use_case_id}")
    notify_admins_new_use_case(db, new_use_case, domain, user, background_tasks=background_tasks)
    return {
        "use_case_id": new_use_case.use_case_id,
        "domain_id": new_use_case.domain_id,
        "use_case_name": new_use_case.use_case_name,
        "use_case_title": new_use_case.use_case_title,
        "use_case_description": new_use_case.use_case_description,
        "intended_use": new_use_case.intended_use,
        "expected_benefits": new_use_case.expected_benefits,
        "department": new_use_case.department,
        "ai_category": new_use_case.ai_category,
        "feasibility": new_use_case.feasibility,
        "status": new_use_case.status,
        "created_by": new_use_case.created_by,
        "created_dt": new_use_case.created_dt.isoformat(),
        "modified_by": new_use_case.modified_by,
        "modified_dt": new_use_case.modified_dt.isoformat()
    }


@router.put("/{use_case_id}", response_model=dict)
async def update_use_case(
    use_case_id: str,
    use_case_data: UseCaseUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Update a use case. Requires case_edit, or initiator edit while status is New."""
    user_id = get_current_user_id(request)
    logger.info(f"Updating use case: {use_case_id} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Lock the workflow row so concurrent transitions cannot bypass stage invariants.
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Use case not found"
        )

    # Get domain to check access
    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )

    # Check domain access (unless admin or owner)
    is_owner = domain.owner_id == user_id or is_domain_owner(db, user, use_case.domain_id)
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            logger.warning(f"Use case update denied: domain: {use_case.domain_id}, user: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=DOMAIN_ACCESS_DENIED_DETAIL
            )

    current_status = use_case.status
    new_status = use_case_data.status
    is_status_change = new_status is not None and new_status != current_status
    is_initiator_in_new = (
        use_case.created_by == user_id
        and current_status == "New"
        and not is_status_change
    )
    is_analysis_assignee = (
        current_status == "Analysis"
        and (
            use_case.technical_owner == user_id
            or use_case.business_owner == user_id
        )
    )
    has_case_edit = check_permission(
        db, user, "case_edit", allow_admin=True, domain_id=use_case.domain_id
    )

    # Permission: case_edit, portal_admin, initiator-in-New, or Analysis track assignee
    if not is_user_admin and not has_case_edit and not is_initiator_in_new and not is_analysis_assignee:
        # Allow status-only transitions if user has the required workflow/action perms
        update_fields = use_case_data.model_dump(exclude_unset=True)
        non_status_keys = {
            k for k in update_fields.keys()
            if k not in ("status", "rejection_reason")
        }
        if not is_status_change or non_status_keys:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to edit use cases"
            )

    # Owner assignment requires case_assign only when owner values actually change
    def _normalize_owner_id(value: object | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    provided_fields = use_case_data.model_dump(exclude_unset=True)
    needs_owner_assign = False
    if "technical_owner" in provided_fields:
        if _normalize_owner_id(provided_fields.get("technical_owner")) != _normalize_owner_id(use_case.technical_owner):
            needs_owner_assign = True
    if "business_owner" in provided_fields:
        if _normalize_owner_id(provided_fields.get("business_owner")) != _normalize_owner_id(use_case.business_owner):
            needs_owner_assign = True
    if needs_owner_assign and not is_user_admin:
        require_permission(
            db, user, "case_assign",
            allow_admin=True,
            domain_id=use_case.domain_id,
            error_message="You do not have permission to assign owners (requires case_assign)"
        )
    if "technical_owner" in provided_fields:
        next_tech = _normalize_owner_id(provided_fields.get("technical_owner"))
        if next_tech and next_tech != _normalize_owner_id(use_case.technical_owner):
            if not _user_has_role(db, next_tech, ANALYSIS_TECHNICAL_OWNER_ROLES):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Technical owner must be a tech_architect user.",
                )
            _require_assignee_domain_access(db, next_tech, use_case.domain_id, "Technical owner")
    if "business_owner" in provided_fields:
        next_biz = _normalize_owner_id(provided_fields.get("business_owner"))
        if next_biz and next_biz != _normalize_owner_id(use_case.business_owner):
            if not _user_has_role(db, next_biz, ANALYSIS_BUSINESS_OWNER_ROLES):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Business owner must be a business_reviewer user.",
                )
            _require_assignee_domain_access(db, next_biz, use_case.domain_id, "Business owner")

    VALID_STATUSES_NON_ADMIN = set(FORWARD_NEXT_NON_ADMIN.keys())

    # Approved and Rejected are terminal, read-only states for every role.
    if current_status in ("Approved", "Rejected"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Use case is approved/rejected and is read-only.",
        )

    # Initiator may only edit content while New; block content edits after leaving New without case_edit
    if (
        not is_user_admin
        and not has_case_edit
        and use_case.created_by == user_id
        and current_status != "New"
        and not is_status_change
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Initiator can only edit the use case while it is in New status."
        )

    # When transitioning to Rejected, rejection_reason is required
    if is_status_change and new_status == "Rejected" and not (use_case_data.rejection_reason or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rejection reason is required when moving use case to Rejected"
        )

    # When transitioning to Approved, at least one risk must exist and all must be closed
    if is_status_change and new_status == "Approved":
        if current_status != "AI Assessment":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use cases can only be Approved from AI Assessment status.",
            )
        if not getattr(use_case, "assessment_completed_dt", None):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Complete the AI Assessment assignment before approving the use case.",
            )
        _require_at_least_one_risk(db, use_case_id, "Approving")
        open_risks = db.query(UseCaseRiskReview).filter(
            UseCaseRiskReview.use_case_id == use_case_id,
            UseCaseRiskReview.status == "open"
        ).count()
        if open_risks > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"All risks must be closed before approving. {open_risks} risk(s) are still open."
            )

    # Analysis → Review requires both technical and business analysis completed
    if is_status_change and new_status == "Review" and current_status == "Analysis":
        if not getattr(use_case, "tech_analysis_completed_dt", None) or not getattr(
            use_case, "business_analysis_completed_dt", None
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Both Technical and Business analysis must be marked completed before moving to Review.",
            )
        _require_at_least_one_risk(db, use_case_id, "Moving to Review")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Review is entered automatically when both analysis tracks are completed.",
        )

    # Review → Estimate must use estimate assign endpoint
    if is_status_change and new_status == "Estimate" and current_status == "Review":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use POST /use-cases/{id}/estimate/assign to move to Estimate with an owner and due date.",
        )

    # Estimate → ROI is automatic on estimate complete
    if is_status_change and new_status == "ROI" and current_status == "Estimate":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ROI is entered automatically when the Estimate assignment is completed.",
        )

    # ROI → AI Assessment is automatic on ROI complete
    if is_status_change and new_status == "AI Assessment" and current_status == "ROI":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI Assessment is entered automatically when the ROI assignment is completed.",
        )

    # New → Analysis must use the assignment endpoint for every role.
    if is_status_change and new_status == "Analysis" and current_status == "New":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use POST /use-cases/{id}/analysis/assign to move to Analysis with owners and due date.",
        )

    if is_status_change and is_user_admin:
        allowed_next = WORKFLOW_NEXT.get(current_status, [])
        if new_status not in allowed_next:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot change status from {current_status} to {new_status}. Allowed next: {allowed_next or 'none (terminal state)'}",
            )

    # Non-portal_admin: only allow forward workflow transitions and require permissions.
    if is_status_change and not is_user_admin:
        allowed_next = FORWARD_NEXT_NON_ADMIN.get(current_status, [])
        if new_status not in VALID_STATUSES_NON_ADMIN or new_status not in allowed_next:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot change status from {current_status} to {new_status}. Allowed next: {allowed_next or 'none (terminal state)'}"
            )

        # Require workflow state permission to enter the target status
        workflow_perm = STATUS_TO_WORKFLOW_PERMISSION.get(new_status)
        if workflow_perm:
            require_permission(
                db, user, workflow_perm,
                allow_admin=True,
                domain_id=use_case.domain_id,
                error_message=f"You do not have permission to move use cases to {new_status} (requires {workflow_perm})",
            )

        if new_status == "Approved":
            require_permission(
                db, user, "case_approve",
                allow_admin=True,
                domain_id=use_case.domain_id,
                error_message="You do not have permission to approve use cases (requires case_approve)",
            )
        if new_status == "Rejected":
            require_permission(
                db, user, "case_reject",
                allow_admin=True,
                domain_id=use_case.domain_id,
                error_message="You do not have permission to reject use cases (requires case_reject)",
            )

    # Check duplicate use case name within the same domain when name is being changed
    if use_case_data.use_case_name is not None and use_case_data.use_case_name.strip() != use_case.use_case_name:
        existing_name = db.query(UseCase).filter(
            UseCase.domain_id == use_case.domain_id,
            UseCase.use_case_name == use_case_data.use_case_name.strip(),
            UseCase.use_case_id != use_case_id
        ).first()
        if existing_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A use case with this name already exists in this domain"
            )

    # Update use case fields
    update_data = use_case_data.model_dump(exclude_unset=True)
    if "ai_category" in update_data:
        update_data["ai_category"] = _resolve_ai_category(update_data.get("ai_category"))

    # Lock base + analysis content from Review onward (estimate uses dedicated endpoints)
    if current_status in CONTENT_LOCKED_STATUSES and not is_user_admin:
        locked_touched = {k for k in update_data.keys() if k in LOCKED_CONTENT_FIELDS}
        if locked_touched:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Base and analysis information are locked in Review/Estimate and later stages. "
                    "From Review, send a track back for more information, or use Estimate endpoints for costs."
                ),
            )

    # Analysis-phase field ownership: tech/business owners may only edit their track fields
    if current_status == "Analysis" and not is_user_admin and not is_owner:
        is_tech = use_case.technical_owner == user_id
        is_biz = use_case.business_owner == user_id
        content_keys = {
            k for k in update_data.keys()
            if k not in ("status", "rejection_reason")
        }
        # Assignees cannot change owner assignments
        if ("technical_owner" in content_keys or "business_owner" in content_keys) and (is_tech or is_biz):
            if not _can_assign_analysis(db, user, use_case.domain_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Technical and Business owners cannot change assignments. Reject the assignment to request reassignment.",
                )
        allowed_fields: set[str] = set()
        if is_tech:
            allowed_fields |= TECHNICAL_ANALYSIS_FIELDS
        if is_biz:
            allowed_fields |= BUSINESS_ANALYSIS_FIELDS
        if is_tech or is_biz:
            allowed_fields.add("tags")
        if has_case_edit and _can_assign_analysis(db, user, use_case.domain_id):
            allowed_fields = content_keys  # assigners / admins / domain owners with edit
        elif is_tech or is_biz:
            blocked = content_keys - allowed_fields
            if blocked:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"You cannot edit these fields for your analysis track: {sorted(blocked)}",
                )
    # Completed analysis tracks are frozen for every role, including admin and domain owner.
    if getattr(use_case, "tech_analysis_completed_dt", None):
        for field in TECHNICAL_ANALYSIS_FIELDS:
            update_data.pop(field, None)
    if getattr(use_case, "business_analysis_completed_dt", None):
        for field in BUSINESS_ANALYSIS_FIELDS:
            update_data.pop(field, None)

    # Derive technical feasibility from tool complexity + host capability when either changes
    tool_c = update_data.get("tool_complexity", getattr(use_case, "tool_complexity", None))
    host_c = update_data.get("host_system_capability", getattr(use_case, "host_system_capability", None))
    if "tool_complexity" in update_data or "host_system_capability" in update_data:
        derived = derive_technical_feasibility(tool_c, host_c)
        if derived:
            update_data["feasibility"] = derived

    # Remove tags and reference_links from update_data as we'll handle them separately
    tags_to_update = update_data.pop('tags', None)
    reference_links_to_update = update_data.pop('reference_links', None)
    rejection_reason_val = update_data.pop('rejection_reason', None)

    # Apply status and rejection_reason
    if new_status is not None:
        use_case.status = new_status
    if use_case.status == "Rejected" and rejection_reason_val is not None:
        use_case.rejection_reason = (rejection_reason_val or "").strip() or None
    elif use_case.status != "Rejected":
        use_case.rejection_reason = None

    # Update other basic fields (skip status, already applied)
    nullable_json_fields = {"target_audience_type", "impacted_stakeholders"}
    boolean_fields = {"bias_assessment_performed"}
    nullable_text_fields = {
        "human_in_loop_strategy",
        "protected_attributes",
        "balancing_strategy",
        "solution_design_overview",
        "intended_use",
        "intended_audience",
        "frequency_of_task",
        "current_effort",
        "user_group_size",
        "efficiency_impact",
        "quality_compliance_impact",
        "user_urgency",
        "process_impact",
        "operational_compliance_risk",
        "tool_complexity",
        "host_system_capability",
        "data_privacy_security",
        "deployment_model",
    }
    for field, value in update_data.items():
        if field == "status":
            continue
        if (
            value is not None
            or field in nullable_json_fields
            or field in boolean_fields
            or field in nullable_text_fields
        ):
            if field in boolean_fields and value is not None:
                setattr(use_case, field, bool(value))
            elif field in nullable_text_fields and value is not None:
                setattr(use_case, field, (value or "").strip() or None)
            else:
                setattr(use_case, field, value)

    use_case.modified_by = user_id

    # Update tags if provided
    if tags_to_update is not None:
        # Delete existing tags
        db.query(UseCaseTag).filter(UseCaseTag.use_case_id == use_case_id).delete()
        # Add new tags
        if tags_to_update:
            for tag_name in tags_to_update:
                if tag_name and tag_name.strip():
                    tag = UseCaseTag(
                        use_case_id=use_case_id,
                        tag_name=tag_name.strip(),
                        created_by=user_id
                    )
                    db.add(tag)

    # Update reference links if provided
    if reference_links_to_update is not None:
        _replace_use_case_reference_links(
            db=db,
            use_case_id=use_case_id,
            user_id=user_id,
            reference_links=reference_links_to_update,
        )

    db.commit()
    db.refresh(use_case)

    # Load tags, reference_links, documents for response
    tags = db.query(UseCaseTag).filter(UseCaseTag.use_case_id == use_case_id).all()
    tag_names = [tag.tag_name for tag in tags]
    links = db.query(UseCaseLink).filter(UseCaseLink.use_case_id == use_case_id).order_by(UseCaseLink.link_id).all()
    docs = db.query(UseCaseDocument).filter(UseCaseDocument.use_case_id == use_case_id).order_by(UseCaseDocument.uploaded_dt.desc()).all()
    resource_payload = _build_use_case_resource_payload(db, user, links, docs)

    # Create audit log
    audit_action = "update"
    audit_details = {
        "use_case_id": use_case_id,
        "use_case_name": use_case.use_case_name,
        "domain_id": use_case.domain_id,
    }
    if is_status_change:
        audit_details["from_status"] = current_status
        audit_details["to_status"] = new_status
        if new_status == "Approved":
            audit_action = "approve"
        elif new_status == "Rejected":
            audit_action = "reject"
            audit_details["rejection_reason"] = (use_case.rejection_reason or "").strip() or None
        else:
            audit_action = "status_change"
    audit_log = AuditLog(
        type="use_case",
        action=audit_action,
        user_id=user_id,
        details=audit_details,
    )
    db.add(audit_log)
    db.commit()

    logger.info(f"Use case updated successfully: {use_case_id}")
    if is_status_change and new_status in ("Approved", "Rejected"):
        notify_use_case_decision(
            db,
            use_case,
            actor=user,
            new_status=new_status,
            from_status=current_status,
            rejection_reason=getattr(use_case, "rejection_reason", None),
            background_tasks=background_tasks,
        )
    technical_owner_display = _resolve_user_display(db, use_case.technical_owner)
    business_owner_display = _resolve_user_display(db, use_case.business_owner)
    return {
        "use_case_id": use_case.use_case_id,
        "domain_id": use_case.domain_id,
        "use_case_name": use_case.use_case_name,
        "use_case_title": use_case.use_case_title,
        "use_case_description": use_case.use_case_description,
        "intended_use": use_case.intended_use,
        "expected_benefits": use_case.expected_benefits,
        "department": use_case.department,
        "ai_category": use_case.ai_category,
        "feasibility": use_case.feasibility,
        "status": use_case.status,
        "intended_audience": use_case.intended_audience,
        "target_audience_type": use_case.target_audience_type,
        "impacted_stakeholders": use_case.impacted_stakeholders,
        "technical_owner": use_case.technical_owner,
        "technical_owner_name": technical_owner_display["user_name"],
        "technical_owner_email": technical_owner_display["user_email"],
        "technical_owner_role_name": technical_owner_display["role_name"],
        "business_owner": use_case.business_owner,
        "business_owner_name": business_owner_display["user_name"],
        "business_owner_email": business_owner_display["user_email"],
        "solution_design_overview": use_case.solution_design_overview,
        "human_in_loop_strategy": use_case.human_in_loop_strategy,
        "bias_assessment_performed": bool(getattr(use_case, "bias_assessment_performed", False)),
        "protected_attributes": use_case.protected_attributes,
        "balancing_strategy": use_case.balancing_strategy,
        "rejection_reason": getattr(use_case, "rejection_reason", None),
        "tags": tag_names,
        "created_by": use_case.created_by,
        "created_dt": use_case.created_dt.isoformat() if use_case.created_dt else None,
        "modified_by": use_case.modified_by,
        "modified_dt": use_case.modified_dt.isoformat() if use_case.modified_dt else None,
        **resource_payload,
    }


@router.put("/{use_case_id}/move")
async def move_use_case(
    use_case_id: str,
    body: UseCaseMoveRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Move a use case to another domain. Requires case_edit and access to both source and target domains."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "case_edit",
        allow_admin=True,
        error_message="You do not have permission to edit use cases",
    )
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if body.target_domain_id == use_case.domain_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use case is already in this domain",
        )
    source_domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    target_domain = db.query(Domain).filter(Domain.domain_id == body.target_domain_id).first()
    if not source_domain or not target_domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    if not is_user_admin:
        src_ok = source_domain.owner_id == user_id or db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id, DomainAccess.user_id == user_id
        ).first()
        tgt_ok = target_domain.owner_id == user_id or db.query(DomainAccess).filter(
            DomainAccess.domain_id == body.target_domain_id, DomainAccess.user_id == user_id
        ).first()
        if not src_ok:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to source domain")
        if not tgt_ok:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to target domain")
    use_case.domain_id = body.target_domain_id
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)
    audit_log = AuditLog(
        type="use_case",
        action="move",
        user_id=user_id,
        details={
            "use_case_id": use_case_id,
            "use_case_name": use_case.use_case_name,
            "from_domain_id": source_domain.domain_id,
            "to_domain_id": body.target_domain_id,
        },
    )
    db.add(audit_log)
    db.commit()
    logger.info(f"Use case {use_case_id} moved to domain {body.target_domain_id}")
    notify_use_case_moved(
        db,
        use_case,
        actor=user,
        source_domain=source_domain,
        target_domain=target_domain,
    )
    return {
        "use_case_id": use_case.use_case_id,
        "domain_id": use_case.domain_id,
        "message": "Use case moved to the selected domain.",
    }


@router.delete("/{use_case_id}")
async def delete_use_case(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Delete a use case. Requires case_delete permission or domain ownership, and domain access."""
    user_id = get_current_user_id(request)
    logger.info(f"Deleting use case: {use_case_id} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Get use case and domain first (needed to allow domain owner to delete without case_delete)
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Use case not found"
        )
    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )

    # Allow if user has case_delete, or is admin, or is the domain owner
    require_permission(
        db, user, "case_delete",
        resource_owner_id=domain.owner_id,
        allow_admin=True,
        error_message="You do not have permission to delete use cases"
    )

    # Check domain access (unless admin or owner)
    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            logger.warning(f"Use case deletion denied: domain: {use_case.domain_id}, user: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=DOMAIN_ACCESS_DENIED_DETAIL
            )

    # Check for dependent records
    data_count = db.query(UseCaseData).filter(UseCaseData.use_case_id == use_case_id).count()
    risk_review_count = db.query(UseCaseRiskReview).filter(UseCaseRiskReview.use_case_id == use_case_id).count()
    comment_count = db.query(UseCaseComment).filter(UseCaseComment.use_case_id == use_case_id).count()

    if data_count > 0 or risk_review_count > 0 or comment_count > 0:
        dependencies = []
        if data_count > 0:
            dependencies.append(f"{data_count} data requirement(s)")
        if risk_review_count > 0:
            dependencies.append(f"{risk_review_count} risk review(s)")
        if comment_count > 0:
            dependencies.append(f"{comment_count} comment(s)")

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete use case. It has {', '.join(dependencies)}. Please remove these dependencies first."
        )

    use_case_name = use_case.use_case_name
    use_case_title = use_case.use_case_title or use_case.use_case_name
    domain_id = use_case.domain_id
    delete_recipients = use_case_stakeholder_ids(db, use_case)

    # Delete tags first (CASCADE should handle this, but explicit is better)
    db.query(UseCaseTag).filter(UseCaseTag.use_case_id == use_case_id).delete()

    # Delete use case (related data will be deleted via CASCADE)
    db.delete(use_case)

    # Create audit log
    audit_log = AuditLog(
        type="use_case",
        action="delete",
        user_id=user_id,
        details={"use_case_id": use_case_id, "use_case_name": use_case_name, "domain_id": domain_id}
    )
    db.add(audit_log)
    db.commit()

    notify_use_case_deleted(
        db,
        actor=user,
        use_case_id=use_case_id,
        use_case_title=use_case_title,
        domain_id=domain_id,
        recipient_user_ids=delete_recipients,
    )

    logger.info(f"Use case deleted successfully: {use_case_id}")
    return {"message": "Use case deleted successfully"}


# Use Case Data Requirements endpoints
DataClassificationValue = Literal[
    "Public", "Internal-Use", "Confidential", "Restricted", "Highly-Restricted"
]
DataUsageValue = Literal["Training", "Testing", "Production"]
DatasetTypeValue = Literal["Synthetic", "Real"]


class UseCaseDataCreate(BaseModel):
    data_req: str | None = None
    data_source: str | None = None
    volume: str | None = None
    data_classification: DataClassificationValue | None = None
    data_owner: str | None = Field(default=None, max_length=DATA_OWNER_MAX_LENGTH)
    data_usage: list[DataUsageValue] | None = None
    is_pii_phi_involved: bool | None = False
    dataset_type: DatasetTypeValue | None = None
    data_lineage_available: bool | None = False
    data_quality_assessed: bool | None = False
    data_freshness_confirmed: bool | None = False

    @field_validator("data_classification", mode="before")
    @classmethod
    def normalize_data_classification(cls, value):
        if value in (None, ""):
            return None
        if value not in DATA_CLASSIFICATION_OPTIONS:
            raise ValueError(
                f"data_classification must be one of: {', '.join(DATA_CLASSIFICATION_OPTIONS)}"
            )
        return value

    @field_validator("data_usage", mode="before")
    @classmethod
    def normalize_data_usage(cls, value):
        if value in (None, ""):
            return None
        if not isinstance(value, list):
            raise ValueError("data_usage must be a list of usage values.")
        normalized: list[str] = []
        for item in value:
            if item in (None, ""):
                continue
            if item not in DATA_USAGE_OPTIONS:
                raise ValueError(
                    f"Each data_usage value must be one of: {', '.join(DATA_USAGE_OPTIONS)}"
                )
            if item not in normalized:
                normalized.append(item)
        return normalized or None

    @field_validator("dataset_type", mode="before")
    @classmethod
    def normalize_dataset_type(cls, value):
        if value in (None, ""):
            return None
        if value not in DATASET_TYPE_OPTIONS:
            raise ValueError(
                f"dataset_type must be one of: {', '.join(DATASET_TYPE_OPTIONS)}"
            )
        return value

    @field_validator("data_owner", mode="before")
    @classmethod
    def normalize_data_owner(cls, value):
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class UseCaseDataUpdate(UseCaseDataCreate):
    """Update payload for an existing data requirement."""


@router.get("/{use_case_id}/data")
async def get_use_case_data(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get data requirements for a use case. Requires case_view permission and domain access."""
    user_id = get_current_user_id(request)

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission
    require_permission(
        db, user, "case_view",
        allow_admin=True,
        error_message="You do not have permission to view use cases"
    )

    # Verify use case exists and user has access
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")

    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")

    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)

    data_reqs = db.query(UseCaseData).filter(UseCaseData.use_case_id == use_case_id).all()
    return data_reqs


@router.post("/{use_case_id}/data")
async def create_use_case_data(
    use_case_id: str,
    data: UseCaseDataCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Create a data requirement for a use case. Requires case_edit permission and domain access."""
    user_id = get_current_user_id(request)

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission
    require_permission(
        db, user, "case_edit",
        allow_admin=True,
        error_message="You do not have permission to edit use cases"
    )

    # Verify use case exists and user has access
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    _require_editable_stage(
        use_case,
        DATA_REQUIREMENT_EDITABLE_STATUSES,
        "Data requirements can only be changed while the use case is in New or Analysis status.",
    )

    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")

    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)

    new_data = UseCaseData(
        use_case_id=use_case_id,
        data_req=data.data_req,
        data_source=data.data_source,
        volume=data.volume,
        data_classification=data.data_classification,
        data_owner=data.data_owner,
        data_usage=data.data_usage,
        is_pii_phi_involved=bool(data.is_pii_phi_involved),
        dataset_type=data.dataset_type,
        data_lineage_available=bool(data.data_lineage_available),
        data_quality_assessed=bool(data.data_quality_assessed),
        data_freshness_confirmed=bool(data.data_freshness_confirmed),
        created_by=user_id,
        modified_by=user_id
    )
    db.add(new_data)
    db.commit()
    db.refresh(new_data)

    return new_data


@router.put("/{use_case_id}/data/{data_req_id}")
async def update_use_case_data(
    use_case_id: str,
    data_req_id: int,
    data: UseCaseDataUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Update a data requirement for a use case. Requires case_edit permission and domain access."""
    user_id = get_current_user_id(request)

    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    require_permission(
        db, user, "case_edit",
        allow_admin=True,
        error_message="You do not have permission to edit use cases"
    )

    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    _require_editable_stage(
        use_case,
        DATA_REQUIREMENT_EDITABLE_STATUSES,
        "Data requirements can only be changed while the use case is in New or Analysis status.",
    )

    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")

    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)

    data_req = db.query(UseCaseData).filter(
        UseCaseData.data_req_id == data_req_id,
        UseCaseData.use_case_id == use_case_id
    ).first()

    if not data_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data requirement not found")

    if not (data.data_req or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Data requirement name is required"
        )

    data_req.data_req = data.data_req.strip()
    data_req.data_source = data.data_source
    data_req.volume = data.volume
    data_req.data_classification = data.data_classification
    data_req.data_owner = data.data_owner
    data_req.data_usage = data.data_usage
    data_req.is_pii_phi_involved = bool(data.is_pii_phi_involved)
    data_req.dataset_type = data.dataset_type
    data_req.data_lineage_available = bool(data.data_lineage_available)
    data_req.data_quality_assessed = bool(data.data_quality_assessed)
    data_req.data_freshness_confirmed = bool(data.data_freshness_confirmed)
    data_req.modified_by = user_id

    db.commit()
    db.refresh(data_req)

    return data_req


@router.delete("/{use_case_id}/data/{data_req_id}")
async def delete_use_case_data(
    use_case_id: str,
    data_req_id: int,
    request: Request,
    db: Session = Depends(get_db)
):
    """Delete a data requirement. Requires case_edit permission and domain access."""
    user_id = get_current_user_id(request)

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission
    require_permission(
        db, user, "case_edit",
        allow_admin=True,
        error_message="You do not have permission to edit use cases"
    )

    # Verify use case exists and user has access
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    _require_editable_stage(
        use_case,
        DATA_REQUIREMENT_EDITABLE_STATUSES,
        "Data requirements can only be changed while the use case is in New or Analysis status.",
    )

    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")

    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)

    data_req = db.query(UseCaseData).filter(
        UseCaseData.data_req_id == data_req_id,
        UseCaseData.use_case_id == use_case_id
    ).first()

    if not data_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data requirement not found")

    db.delete(data_req)
    db.commit()

    return {"message": "Data requirement deleted successfully"}


# Use Case Risk Reviews endpoints (merged risks + reviews)
class UseCaseRiskReviewCreate(BaseModel):
    risk_title: str | None = None
    risk_description: str | None = Field(default=None, max_length=RISK_DESCRIPTION_MAX_LENGTH)
    risk_category: str | None = None  # Operational, Business, Technical
    risk_likelihood: str | None = None  # low, medium, high, critical
    risk_impact: str | None = None  # low, medium, high, critical
    assigned_to: str | None = None
    mitigation_strategy: str | None = Field(default=None, max_length=MITIGATION_STRATEGY_MAX_LENGTH)
    closure_comment: str | None = None
    status: str = "open"

    @field_validator("risk_likelihood", "risk_impact", mode="before")
    @classmethod
    def validate_risk_level(cls, value):
        if value in (None, ""):
            return None
        normalized = normalize_risk_level(value)
        if normalized is None:
            raise ValueError("Risk level must be one of: low, medium, high, critical")
        return normalized


class UseCaseRiskReviewUpdate(BaseModel):
    assigned_to: str | None = None
    mitigation_strategy: str | None = Field(default=None, max_length=MITIGATION_STRATEGY_MAX_LENGTH)
    closure_comment: str | None = None
    status: str | None = None


def _check_use_case_access(db: Session, user_id: str, use_case_id: str, require_edit: bool = False):
    """Verify use case exists and user has domain access. Requires case_view or case_edit. Returns (use_case, domain)."""
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)
    perm = "case_edit" if require_edit else "case_view"
    require_permission(db, user, perm, allow_admin=True, error_message=f"You do not have permission to {perm.replace('_', ' ')}")
    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    return use_case, domain


def _check_use_case_permission(db: Session, user_id: str, permission: str, error_message: str = None):
    """Require user to have the given permission (e.g. case_comment, case_review)."""
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, permission,
        allow_admin=True,
        error_message=error_message or f"You do not have permission to perform this action (requires {permission})"
    )


@router.post("/{use_case_id}/analysis/assign", response_model=dict)
async def assign_analysis(
    use_case_id: str,
    payload: AnalysisAssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Move New→Analysis (or reassign in Analysis) with tech/business owners and due date."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")

    _require_workflow_governor(db, user, use_case.domain_id, "assign Analysis")

    if use_case.status not in ("New", "Analysis"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Analysis assignment is only allowed from New or Analysis status.",
        )

    if not _user_has_role(db, payload.technical_owner, ANALYSIS_TECHNICAL_OWNER_ROLES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Technical owner must be a tech_architect user.",
        )
    if not _user_has_role(db, payload.business_owner, ANALYSIS_BUSINESS_OWNER_ROLES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Business owner must be a business_reviewer user.",
        )
    _require_assignee_domain_access(db, payload.technical_owner, use_case.domain_id, "Technical owner")
    _require_assignee_domain_access(db, payload.business_owner, use_case.domain_id, "Business owner")

    due_date = _parse_due_date(payload.due_date)
    now = dt_cls.utcnow()
    was_analysis = use_case.status == "Analysis"
    prev_tech = use_case.technical_owner
    prev_biz = use_case.business_owner

    def _oid(value: object | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    tech_changed = _oid(prev_tech) != _oid(payload.technical_owner)
    biz_changed = _oid(prev_biz) != _oid(payload.business_owner)

    use_case.technical_owner = payload.technical_owner
    use_case.business_owner = payload.business_owner
    use_case.analysis_due_date = due_date
    use_case.analysis_assigned_by = user_id
    use_case.analysis_assigned_dt = now

    if was_analysis:
        # Partial reassign: only reset the track whose owner actually changed/was filled.
        if tech_changed or not prev_tech:
            use_case.tech_analysis_completed_dt = None
            use_case.tech_analysis_rejected_dt = None
            use_case.tech_analysis_rejection_note = None
        if biz_changed or not prev_biz:
            use_case.business_analysis_completed_dt = None
            use_case.business_analysis_rejected_dt = None
            use_case.business_analysis_rejection_note = None
    else:
        use_case.tech_analysis_completed_dt = None
        use_case.business_analysis_completed_dt = None
        use_case.tech_analysis_rejected_dt = None
        use_case.tech_analysis_rejection_note = None
        use_case.business_analysis_rejected_dt = None
        use_case.business_analysis_rejection_note = None

    use_case.status = "Analysis"
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    tech_user = db.query(User).filter(User.user_id == payload.technical_owner).first()
    biz_user = db.query(User).filter(User.user_id == payload.business_owner).first()
    notify_analysis_assignment(
        db,
        use_case,
        technical_owner=tech_user,
        business_owner=biz_user,
        assigner=user,
        due_date=due_date,
        background_tasks=background_tasks,
        include_technical=not was_analysis or tech_changed,
        include_business=not was_analysis or biz_changed,
    )
    if was_analysis and tech_changed and prev_tech:
        prev_tech_user = db.query(User).filter(User.user_id == prev_tech).first()
        notify_stage_previous_owner(
            db,
            use_case,
            previous_owner=prev_tech_user,
            new_owner=tech_user,
            assigner=user,
            stage_label="Technical Analysis",
            notification_type="analysis_reassigned",
            section="tech_analysis",
            background_tasks=background_tasks,
        )
    if was_analysis and biz_changed and prev_biz:
        prev_biz_user = db.query(User).filter(User.user_id == prev_biz).first()
        notify_stage_previous_owner(
            db,
            use_case,
            previous_owner=prev_biz_user,
            new_owner=biz_user,
            assigner=user,
            stage_label="Business Analysis",
            notification_type="analysis_reassigned",
            section="business_analysis",
            background_tasks=background_tasks,
        )

    audit_log = AuditLog(
        type="use_case",
        action="analysis_assign",
        user_id=user_id,
        details={
            "use_case_id": use_case_id,
            "technical_owner": payload.technical_owner,
            "business_owner": payload.business_owner,
            "due_date": due_date.isoformat(),
        },
    )
    db.add(audit_log)
    db.commit()

    return {
        "use_case_id": use_case.use_case_id,
        "status": use_case.status,
        **_analysis_payload(use_case, db),
        "technical_owner": use_case.technical_owner,
        "business_owner": use_case.business_owner,
        "message": "Analysis assigned successfully",
    }


@router.post("/{use_case_id}/analysis/complete", response_model=dict)
async def complete_analysis_track(
    use_case_id: str,
    payload: AnalysisTrackRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Mark technical or business analysis as completed (captures date)."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if not _user_can_open_domain(db, user_id, use_case.domain_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    if use_case.status != "Analysis":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use case is not in Analysis status.")
    assigned_owner = (
        use_case.technical_owner if payload.track == "technical" else use_case.business_owner
    )
    if not assigned_owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assign a {payload.track} owner before completing this analysis track.",
        )
    if not is_user_admin and assigned_owner != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only the assigned {payload.track.title()} Owner can complete {payload.track} analysis.",
        )

    now = dt_cls.utcnow()
    track = payload.track
    missing = missing_required_analysis_fields(track, use_case)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot complete {track} analysis. Fill required fields: {', '.join(missing)}.",
        )
    other_track_done = bool(
        use_case.business_analysis_completed_dt if track == "technical" else use_case.tech_analysis_completed_dt
    )
    if other_track_done:
        _require_at_least_one_risk(db, use_case_id, "Moving to Review")
    if track == "technical":
        if use_case.tech_analysis_completed_dt:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Technical analysis already completed.")
        use_case.tech_analysis_completed_dt = now
        use_case.tech_analysis_rejected_dt = None
        use_case.tech_analysis_rejection_note = None
        label = "Technical"
    else:
        if use_case.business_analysis_completed_dt:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Business analysis already completed.")
        use_case.business_analysis_completed_dt = now
        use_case.business_analysis_rejected_dt = None
        use_case.business_analysis_rejection_note = None
        label = "Business"

    use_case.modified_by = user_id
    advanced_to_review = False
    if use_case.tech_analysis_completed_dt and use_case.business_analysis_completed_dt:
        use_case.status = "Review"
        advanced_to_review = True
    db.commit()
    db.refresh(use_case)

    assigner = db.query(User).filter(User.user_id == use_case.analysis_assigned_by).first() if use_case.analysis_assigned_by else None
    notify_analysis_completed(
        db,
        use_case,
        track=label,
        completer=user,
        assigner=assigner,
        background_tasks=background_tasks,
        advanced_to_review=advanced_to_review,
    )

    audit_log = AuditLog(
        type="use_case",
        action="analysis_complete",
        user_id=user_id,
        details={
            "use_case_id": use_case_id,
            "track": track,
            "advanced_to_review": advanced_to_review,
        },
    )
    db.add(audit_log)
    db.commit()

    return {
        "use_case_id": use_case_id,
        "track": track,
        "status": use_case.status,
        "advanced_to_review": advanced_to_review,
        **_analysis_payload(use_case, db),
    }


@router.post("/{use_case_id}/analysis/send-back", response_model=dict)
async def send_back_analysis_track(
    use_case_id: str,
    payload: AnalysisSendBackRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """From Review, send a track back to Analysis for more information."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if use_case.status != "Review":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Send-back is only allowed from Review status.")
    _require_workflow_governor(db, user, use_case.domain_id, "send analysis back from Review")

    note = payload.note.strip()
    if not note:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Send-back note is required.")

    track = payload.track
    if track == "technical":
        if not use_case.technical_owner:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No Technical Owner assigned to send back.")
        use_case.tech_analysis_completed_dt = None
        owner = db.query(User).filter(User.user_id == use_case.technical_owner).first()
        label = "Technical"
    else:
        if not use_case.business_owner:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No Business Owner assigned to send back.")
        use_case.business_analysis_completed_dt = None
        owner = db.query(User).filter(User.user_id == use_case.business_owner).first()
        label = "Business"

    use_case.status = "Analysis"
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    notify_analysis_send_back(
        db,
        use_case,
        track=label,
        reviewer=user,
        owner=owner,
        note=note,
        background_tasks=background_tasks,
    )

    audit_log = AuditLog(
        type="use_case",
        action="analysis_send_back",
        user_id=user_id,
        details={"use_case_id": use_case_id, "track": track, "note": note},
    )
    db.add(audit_log)
    db.commit()

    return {
        "use_case_id": use_case_id,
        "track": track,
        "status": use_case.status,
        **_analysis_payload(use_case, db),
        "message": f"{label} analysis sent back; use case returned to Analysis.",
    }


@router.post("/{use_case_id}/analysis/reject", response_model=dict)
async def reject_analysis_assignment(
    use_case_id: str,
    payload: AnalysisRejectRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Reject Analysis assignment with note; clears owner so assigner can reassign."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if use_case.status != "Analysis":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use case is not in Analysis status.")

    note = payload.note.strip()
    if not note:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rejection note is required.")

    now = dt_cls.utcnow()
    track = payload.track
    if track == "technical":
        if not is_user_admin and use_case.technical_owner != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned Technical Owner can reject this assignment.")
        use_case.tech_analysis_rejected_dt = now
        use_case.tech_analysis_rejection_note = note
        use_case.tech_analysis_completed_dt = None
        use_case.technical_owner = None
        label = "Technical"
    else:
        if not is_user_admin and use_case.business_owner != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned Business Owner can reject this assignment.")
        use_case.business_analysis_rejected_dt = now
        use_case.business_analysis_rejection_note = note
        use_case.business_analysis_completed_dt = None
        use_case.business_owner = None
        label = "Business"

    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    assigner = db.query(User).filter(User.user_id == use_case.analysis_assigned_by).first() if use_case.analysis_assigned_by else None
    try:
        notify_analysis_rejection(
            db, use_case, track=label, rejector=user, assigner=assigner, note=note, background_tasks=background_tasks
        )
    except Exception:
        from app.core.logging_config import logger as _logger
        _logger.exception("In-app/email notification failed after analysis reject use_case_id=%s", use_case_id)
    return {"use_case_id": use_case_id, "track": track, **_analysis_payload(use_case, db)}


def _estimate_is_complete(data: dict) -> tuple[bool, str | None]:
    err = validate_estimate_data(data, require_complete=True)
    if err:
        return False, err
    return True, None


@router.post("/{use_case_id}/estimate/assign", response_model=dict)
async def assign_estimate(
    use_case_id: str,
    payload: EstimateAssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Move Review→Estimate (or reassign in Estimate) with owner and due date."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")

    _require_workflow_governor(db, user, use_case.domain_id, "assign Estimate")

    if use_case.status not in ("Review", "Estimate"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estimate assignment is only allowed from Review or Estimate status.",
        )

    if not _user_has_role(db, payload.estimate_owner, ANALYSIS_TECHNICAL_OWNER_ROLES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estimate owner must be a tech_architect user.",
        )
    _require_assignee_domain_access(db, payload.estimate_owner, use_case.domain_id, "Estimate owner")
    if use_case.status == "Review":
        if not use_case.tech_analysis_completed_dt or not use_case.business_analysis_completed_dt:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Both Technical and Business analysis must be completed before assigning Estimate.",
            )
        _require_at_least_one_risk(db, use_case_id, "Moving to Estimate")

    due_date = _parse_due_date(payload.due_date)
    now = dt_cls.utcnow()
    currency = _portal_currency(db)
    previous_owner_id = use_case.estimate_owner
    existing = getattr(use_case, "estimate_data", None)
    if not isinstance(existing, dict) or not existing.get("lines"):
        use_case.estimate_data = empty_estimate_payload(currency)
    else:
        use_case.estimate_data = normalize_estimate_data(existing, currency)

    use_case.estimate_owner = payload.estimate_owner
    use_case.estimate_assigned_by = user_id
    use_case.estimate_assigned_dt = now
    use_case.estimate_due_date = due_date
    use_case.estimate_completed_dt = None
    use_case.status = "Estimate"
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    owner = db.query(User).filter(User.user_id == payload.estimate_owner).first()
    notify_estimate_assignment(
        db,
        use_case,
        estimate_owner=owner,
        assigner=user,
        due_date=due_date,
        background_tasks=background_tasks,
    )
    if previous_owner_id and previous_owner_id != payload.estimate_owner:
        previous_owner = db.query(User).filter(User.user_id == previous_owner_id).first()
        notify_stage_previous_owner(
            db,
            use_case,
            previous_owner=previous_owner,
            new_owner=owner,
            assigner=user,
            stage_label="Estimate",
            notification_type="estimate_reassigned",
            section="estimate",
            background_tasks=background_tasks,
        )

    audit_log = AuditLog(
        type="use_case",
        action="estimate_assign",
        user_id=user_id,
        details={
            "use_case_id": use_case_id,
            "estimate_owner": payload.estimate_owner,
            "due_date": due_date.isoformat(),
        },
    )
    db.add(audit_log)
    db.commit()

    return {
        "use_case_id": use_case.use_case_id,
        "status": use_case.status,
        **_analysis_payload(use_case, db),
        "message": "Estimate assigned successfully",
    }


@router.put("/{use_case_id}/estimate", response_model=dict)
async def save_estimate(
    use_case_id: str,
    payload: EstimateSaveRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Save estimate cost projection while in Estimate status."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if not _user_can_open_domain(db, user_id, use_case.domain_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    if use_case.status != "Estimate":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Estimate can only be edited in Estimate status.")
    if not use_case.estimate_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assign an Estimate owner before saving.")
    if not is_user_admin and use_case.estimate_owner != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned Estimate owner can save the estimate.",
        )
    if getattr(use_case, "estimate_completed_dt", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Estimate is already completed.")

    currency = _portal_currency(db)
    normalized = normalize_estimate_data(payload.estimate_data, currency)
    # Keep user-selected currency if valid; otherwise portal default
    user_currency = (payload.estimate_data or {}).get("currency") if isinstance(payload.estimate_data, dict) else None
    if isinstance(user_currency, str) and user_currency.strip().upper() in CURRENCY_OPTIONS:
        normalized["currency"] = user_currency.strip().upper()

    save_err = validate_estimate_data(normalized, require_complete=False)
    if save_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=save_err)

    use_case.estimate_data = normalized
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    audit_log = AuditLog(
        type="use_case",
        action="estimate_save",
        user_id=user_id,
        details={
            "use_case_id": use_case_id,
            "currency": normalized.get("currency"),
            "vendor_build": is_vendor_build(normalized),
        },
    )
    db.add(audit_log)
    db.commit()

    return {
        "use_case_id": use_case_id,
        "status": use_case.status,
        "estimate_data": use_case.estimate_data,
        **_analysis_payload(use_case, db),
        "message": "Estimate saved",
    }


@router.post("/{use_case_id}/estimate/complete", response_model=dict)
async def complete_estimate(
    use_case_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Mark estimate complete and automatically move to ROI."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if not _user_can_open_domain(db, user_id, use_case.domain_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    if use_case.status != "Estimate":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use case is not in Estimate status.")
    if not use_case.tech_analysis_completed_dt or not use_case.business_analysis_completed_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both Technical and Business analysis must be completed before completing Estimate.",
        )
    if not use_case.estimate_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assign an Estimate owner before completing.")
    if not is_user_admin and use_case.estimate_owner != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned Estimate owner can complete the estimate.",
        )
    if getattr(use_case, "estimate_completed_dt", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Estimate is already completed.")

    currency = _portal_currency(db)
    data = normalize_estimate_data(getattr(use_case, "estimate_data", None), currency)
    ok, err = _estimate_is_complete(data)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    now = dt_cls.utcnow()
    use_case.estimate_data = data
    use_case.estimate_completed_dt = now
    use_case.status = "ROI"
    use_case.roi_completed_dt = None
    if not isinstance(getattr(use_case, "roi_data", None), dict):
        use_case.roi_data = empty_roi_payload(data.get("currency") or currency)
    else:
        use_case.roi_data = normalize_roi_data(
            use_case.roi_data, default_currency=currency, estimate_data=data
        )
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    assigner = (
        db.query(User).filter(User.user_id == use_case.estimate_assigned_by).first()
        if use_case.estimate_assigned_by
        else None
    )
    notify_estimate_completed(
        db, use_case, completer=user, assigner=assigner, background_tasks=background_tasks
    )

    audit_log = AuditLog(
        type="use_case",
        action="estimate_complete",
        user_id=user_id,
        details={"use_case_id": use_case_id, "status": "ROI"},
    )
    db.add(audit_log)
    db.commit()

    return {
        "use_case_id": use_case_id,
        "status": use_case.status,
        "estimate_completed_dt": _iso(use_case.estimate_completed_dt),
        "estimate_data": use_case.estimate_data,
        **_analysis_payload(use_case, db),
        "message": "Estimate completed; use case moved to ROI.",
    }


@router.post("/{use_case_id}/roi/assign", response_model=dict)
async def assign_roi(
    use_case_id: str,
    payload: RoiAssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Assign ROI owner while in ROI status."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    _require_workflow_governor(db, user, use_case.domain_id, "assign ROI")

    if use_case.status != "ROI":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ROI assignment is only allowed in ROI status.")
    if not use_case.estimate_completed_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Complete Estimate before assigning ROI.",
        )
    if not _user_has_role(db, payload.roi_owner, ROI_OWNER_ROLES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ROI owner must be a business_reviewer, ai_leader, or domain_owner.",
        )
    eligible_ids = {u.user_id for u in _eligible_roi_owners(db, use_case.domain_id)}
    if payload.roi_owner not in eligible_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ROI owner must have access to this domain. Grant domain access first, then assign.",
        )

    previous_owner_id = use_case.roi_owner
    due_date = _parse_due_date(payload.due_date)
    now = dt_cls.utcnow()
    currency = _portal_currency(db)
    use_case.roi_data = normalize_roi_data(
        getattr(use_case, "roi_data", None),
        default_currency=currency,
        estimate_data=getattr(use_case, "estimate_data", None),
    )
    use_case.roi_owner = payload.roi_owner
    use_case.roi_assigned_by = user_id
    use_case.roi_assigned_dt = now
    use_case.roi_due_date = due_date
    use_case.roi_completed_dt = None
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    owner = db.query(User).filter(User.user_id == payload.roi_owner).first()
    previous_owner = (
        db.query(User).filter(User.user_id == previous_owner_id).first()
        if previous_owner_id and previous_owner_id != payload.roi_owner
        else None
    )
    notify_roi_assignment(
        db, use_case, roi_owner=owner, assigner=user, due_date=due_date, background_tasks=background_tasks
    )
    if previous_owner:
        notify_roi_previous_owner(
            db,
            use_case,
            previous_owner=previous_owner,
            new_owner=owner,
            assigner=user,
            background_tasks=background_tasks,
        )
    db.add(
        AuditLog(
            type="use_case",
            action="roi_assign",
            user_id=user_id,
            details={
                "use_case_id": use_case_id,
                "roi_owner": payload.roi_owner,
                "previous_roi_owner": previous_owner_id,
                "due_date": due_date.isoformat(),
            },
        )
    )
    db.commit()
    return {
        "use_case_id": use_case_id,
        "status": use_case.status,
        **_analysis_payload(use_case, db),
        "message": "ROI assigned successfully",
    }


@router.put("/{use_case_id}/roi", response_model=dict)
async def save_roi(
    use_case_id: str,
    payload: RoiSaveRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Save ROI savings grid while in ROI status."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if not _user_can_open_domain(db, user_id, use_case.domain_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    if use_case.status != "ROI":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ROI can only be edited in ROI status.")
    if not use_case.estimate_completed_dt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Complete Estimate before editing ROI.")
    if not use_case.roi_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assign an ROI owner before saving.")
    if not is_user_admin and use_case.roi_owner != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned ROI owner can save ROI.")
    if getattr(use_case, "roi_completed_dt", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ROI is already completed.")

    estimate_data = getattr(use_case, "estimate_data", None)
    estimate_currency = (
        str(estimate_data.get("currency") or "").strip().upper()
        if isinstance(estimate_data, dict)
        else ""
    )
    requested_currency = (
        str(payload.roi_data.get("currency") or "").strip().upper()
        if isinstance(payload.roi_data, dict)
        else ""
    )
    if requested_currency and estimate_currency and requested_currency != estimate_currency:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ROI currency must match the completed Estimate currency.",
        )
    save_err = validate_roi_data(payload.roi_data, require_complete=False)
    if save_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=save_err)

    currency = estimate_currency or _portal_currency(db)
    normalized = normalize_roi_data(
        payload.roi_data,
        default_currency=currency,
        estimate_data=estimate_data,
    )

    use_case.roi_data = normalized
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)
    db.add(
        AuditLog(
            type="use_case",
            action="roi_save",
            user_id=user_id,
            details={"use_case_id": use_case_id, "roi_percent": normalized.get("roi_percent")},
        )
    )
    db.commit()
    return {
        "use_case_id": use_case_id,
        "status": use_case.status,
        "roi_data": use_case.roi_data,
        **_analysis_payload(use_case, db),
        "message": "ROI saved",
    }


@router.post("/{use_case_id}/roi/complete", response_model=dict)
async def complete_roi(
    use_case_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Mark ROI complete and automatically move to AI Assessment."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if not _user_can_open_domain(db, user_id, use_case.domain_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    if use_case.status != "ROI":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use case is not in ROI status.")
    if not use_case.estimate_completed_dt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Complete Estimate before completing ROI.")
    if not use_case.roi_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assign an ROI owner before completing.")
    if not is_user_admin and use_case.roi_owner != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned ROI owner can complete ROI.")
    if getattr(use_case, "roi_completed_dt", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ROI is already completed.")

    raw_data = getattr(use_case, "roi_data", None)
    complete_err = validate_roi_data(raw_data, require_complete=True)
    if complete_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=complete_err)

    estimate_data = getattr(use_case, "estimate_data", None)
    currency = (
        str(estimate_data.get("currency") or "").strip().upper()
        if isinstance(estimate_data, dict)
        else ""
    ) or _portal_currency(db)
    data = normalize_roi_data(
        raw_data,
        default_currency=currency,
        estimate_data=estimate_data,
    )
    ok, err = roi_is_complete(data)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    now = dt_cls.utcnow()
    use_case.roi_data = data
    use_case.roi_completed_dt = now
    use_case.status = "AI Assessment"
    use_case.assessment_completed_dt = None
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    assigner = (
        db.query(User).filter(User.user_id == use_case.roi_assigned_by).first()
        if use_case.roi_assigned_by
        else None
    )
    notify_roi_completed(db, use_case, completer=user, assigner=assigner, background_tasks=background_tasks)
    db.add(
        AuditLog(
            type="use_case",
            action="roi_complete",
            user_id=user_id,
            details={
                "use_case_id": use_case_id,
                "status": "AI Assessment",
                "roi_percent": data.get("roi_percent"),
            },
        )
    )
    db.commit()
    return {
        "use_case_id": use_case_id,
        "status": use_case.status,
        "roi_completed_dt": _iso(use_case.roi_completed_dt),
        "roi_data": use_case.roi_data,
        **_analysis_payload(use_case, db),
        "message": "ROI completed; use case moved to AI Assessment.",
    }


@router.post("/{use_case_id}/ai-assessment/assign", response_model=dict)
async def assign_ai_assessment(
    use_case_id: str,
    payload: AssessmentAssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Assign governance owner for AI Assessment."""
    from datetime import datetime as dt_cls

    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    _require_workflow_governor(db, user, use_case.domain_id, "assign AI Assessment")
    if use_case.status != "AI Assessment":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI Assessment assignment is only allowed in AI Assessment status.",
        )
    if not use_case.roi_completed_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Complete ROI before assigning AI Assessment.",
        )
    if not _user_has_role(db, payload.assessment_owner, ASSESSMENT_OWNER_ROLES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assessment owner must be from the governance team (ai_leader, portal_admin, domain_owner, or business_reviewer).",
        )
    _require_assignee_domain_access(db, payload.assessment_owner, use_case.domain_id, "Assessment owner")

    due_date = _parse_due_date(payload.due_date)
    now = dt_cls.utcnow()
    previous_owner_id = use_case.assessment_owner
    use_case.assessment_owner = payload.assessment_owner
    use_case.assessment_assigned_by = user_id
    use_case.assessment_assigned_dt = now
    use_case.assessment_due_date = due_date
    use_case.assessment_completed_dt = None
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    owner = db.query(User).filter(User.user_id == payload.assessment_owner).first()
    notify_assessment_assignment(
        db,
        use_case,
        assessment_owner=owner,
        assigner=user,
        due_date=due_date,
        background_tasks=background_tasks,
    )
    if previous_owner_id and previous_owner_id != payload.assessment_owner:
        previous_owner = db.query(User).filter(User.user_id == previous_owner_id).first()
        notify_stage_previous_owner(
            db,
            use_case,
            previous_owner=previous_owner,
            new_owner=owner,
            assigner=user,
            stage_label="AI Assessment",
            notification_type="assessment_reassigned",
            section="assessment",
            background_tasks=background_tasks,
        )
    db.add(
        AuditLog(
            type="use_case",
            action="assessment_assign",
            user_id=user_id,
            details={
                "use_case_id": use_case_id,
                "assessment_owner": payload.assessment_owner,
                "due_date": due_date.isoformat(),
            },
        )
    )
    db.commit()
    return {
        "use_case_id": use_case_id,
        "status": use_case.status,
        **_analysis_payload(use_case, db),
        "message": "AI Assessment assigned successfully",
    }


@router.post("/{use_case_id}/ai-assessment/complete", response_model=dict)
async def complete_ai_assessment_assignment(
    use_case_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Mark AI Assessment assignment complete (checklist must already be closed). Ready for Approve/Reject."""
    from datetime import datetime as dt_cls

    from app.models import UseCaseAssessment

    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    use_case = (
        db.query(UseCase)
        .filter(UseCase.use_case_id == use_case_id)
        .with_for_update()
        .first()
    )
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    if not _user_can_open_domain(db, user_id, use_case.domain_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    if use_case.status != "AI Assessment":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use case is not in AI Assessment status.")
    if not use_case.roi_completed_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Complete ROI before completing AI Assessment.",
        )
    if not use_case.assessment_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assign an AI Assessment owner before completing.")
    if not is_user_admin and use_case.assessment_owner != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned AI Assessment owner can complete this assignment.",
        )
    if getattr(use_case, "assessment_completed_dt", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AI Assessment is already completed.")

    assessment = (
        db.query(UseCaseAssessment)
        .filter(UseCaseAssessment.use_case_id == use_case_id)
        .order_by(UseCaseAssessment.initiated_dt.desc())
        .first()
    )
    if not assessment or (assessment.status or "").upper() != "CLOSED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Close the Responsible AI assessment checklist before completing the AI Assessment assignment.",
        )

    now = dt_cls.utcnow()
    use_case.assessment_completed_dt = now
    use_case.modified_by = user_id
    db.commit()
    db.refresh(use_case)

    assigner = (
        db.query(User).filter(User.user_id == use_case.assessment_assigned_by).first()
        if use_case.assessment_assigned_by
        else None
    )
    notify_assessment_completed(
        db, use_case, completer=user, assigner=assigner, background_tasks=background_tasks
    )
    db.add(
        AuditLog(
            type="use_case",
            action="assessment_complete",
            user_id=user_id,
            details={"use_case_id": use_case_id, "status": use_case.status},
        )
    )
    db.commit()
    return {
        "use_case_id": use_case_id,
        "status": use_case.status,
        "assessment_completed_dt": _iso(use_case.assessment_completed_dt),
        **_analysis_payload(use_case, db),
        "message": "AI Assessment completed. Authorized users may Approve or Reject.",
    }


@router.get("/{use_case_id}/risk-reviews")
async def get_use_case_risk_reviews(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get risk reviews for a use case. Requires case_view permission and domain access."""
    user_id = get_current_user_id(request)
    _check_use_case_access(db, user_id, use_case_id, require_edit=False)
    items = db.query(UseCaseRiskReview).filter(UseCaseRiskReview.use_case_id == use_case_id).all()
    assignee_ids = {item.assigned_to for item in items if item.assigned_to}
    names: dict[str, str] = {}
    if assignee_ids:
        for user in db.query(User).filter(User.user_id.in_(assignee_ids)).all():
            names[user.user_id] = user.user_name
    payloads = jsonable_encoder(items)
    for payload, item in zip(payloads, items):
        payload["assigned_to_name"] = names.get(item.assigned_to)
    return payloads


@router.post("/{use_case_id}/risk-reviews")
async def create_use_case_risk_review(
    use_case_id: str,
    data: UseCaseRiskReviewCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Create a risk review. Requires case_review permission and domain access."""
    user_id = get_current_user_id(request)
    use_case, _domain = _check_use_case_access(db, user_id, use_case_id, require_edit=False)
    _require_editable_stage(
        use_case,
        RISK_REVIEW_EDITABLE_STATUSES,
        "Risks can only be changed while the use case is in Analysis through AI Assessment.",
    )
    _check_use_case_permission(db, user_id, "case_review", error_message="You do not have permission to perform use case risk reviews")
    if data.assigned_to:
        _require_assignee_domain_access(db, data.assigned_to, use_case.domain_id, "Risk assignee")
    item = UseCaseRiskReview(
        use_case_id=use_case_id,
        risk_title=data.risk_title,
        risk_description=data.risk_description,
        risk_category=data.risk_category,
        risk_likelihood=data.risk_likelihood,
        risk_impact=data.risk_impact,
        assigned_to=data.assigned_to,
        mitigation_strategy=data.mitigation_strategy,
        closure_comment=data.closure_comment,
        status=data.status,
        created_by=user_id,
        modified_by=user_id
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    if item.assigned_to:
        use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
        assignee = db.query(User).filter(User.user_id == item.assigned_to).first()
        actor = db.query(User).filter(User.user_id == user_id).first()
        if use_case:
            notify_risk_assigned(
                db,
                use_case,
                assignee=assignee,
                actor=actor,
                risk_title=item.risk_title,
                risk_review_id=item.risk_review_id,
            )
    return item


@router.put("/{use_case_id}/risk-reviews/{risk_review_id}")
async def update_use_case_risk_review(
    use_case_id: str,
    risk_review_id: int,
    data: UseCaseRiskReviewUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Update a risk review. Requires case_review permission and domain access."""
    user_id = get_current_user_id(request)
    use_case, _domain = _check_use_case_access(db, user_id, use_case_id, require_edit=False)
    _require_editable_stage(
        use_case,
        RISK_REVIEW_EDITABLE_STATUSES,
        "Risks can only be changed while the use case is in Analysis through AI Assessment.",
    )
    _check_use_case_permission(db, user_id, "case_review", error_message="You do not have permission to perform use case risk reviews")
    item = db.query(UseCaseRiskReview).filter(
        UseCaseRiskReview.risk_review_id == risk_review_id,
        UseCaseRiskReview.use_case_id == use_case_id
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk review not found")
    previous_assignee = item.assigned_to
    if data.assigned_to is not None:
        if data.assigned_to:
            _require_assignee_domain_access(db, data.assigned_to, use_case.domain_id, "Risk assignee")
        item.assigned_to = data.assigned_to
    if data.mitigation_strategy is not None:
        item.mitigation_strategy = data.mitigation_strategy
    if data.closure_comment is not None:
        item.closure_comment = data.closure_comment
    if data.status is not None:
        item.status = data.status
    item.modified_by = user_id
    db.commit()
    db.refresh(item)
    if data.assigned_to is not None and data.assigned_to and data.assigned_to != previous_assignee:
        use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
        assignee = db.query(User).filter(User.user_id == item.assigned_to).first()
        actor = db.query(User).filter(User.user_id == user_id).first()
        if use_case:
            notify_risk_assigned(
                db,
                use_case,
                assignee=assignee,
                actor=actor,
                risk_title=item.risk_title,
                risk_review_id=item.risk_review_id,
            )
    return item


@router.delete("/{use_case_id}/risk-reviews/{risk_review_id}")
async def delete_use_case_risk_review(
    use_case_id: str,
    risk_review_id: int,
    request: Request,
    db: Session = Depends(get_db)
):
    """Delete a risk review. Requires case_review permission and domain access."""
    user_id = get_current_user_id(request)
    use_case, _domain = _check_use_case_access(db, user_id, use_case_id, require_edit=False)
    _require_editable_stage(
        use_case,
        RISK_REVIEW_EDITABLE_STATUSES,
        "Risks can only be changed while the use case is in Analysis through AI Assessment.",
    )
    _check_use_case_permission(db, user_id, "case_review", error_message="You do not have permission to perform use case risk reviews")
    item = db.query(UseCaseRiskReview).filter(
        UseCaseRiskReview.risk_review_id == risk_review_id,
        UseCaseRiskReview.use_case_id == use_case_id
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk review not found")
    db.delete(item)
    db.commit()
    return {"message": "Risk review deleted successfully"}


# Use Case Comments endpoints (comments and rating; any user with case_view can add comment+rating)
class UseCaseCommentCreate(BaseModel):
    comment: str | None = None
    rating: int | None = None  # 1-5 star rating on comment


class UseCaseCommentUpdate(BaseModel):
    rating: int | None = None  # 1-5 star rating


@router.get("/{use_case_id}/comments")
async def get_use_case_comments(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get comments for a use case. Requires case_view permission and domain access."""
    user_id = get_current_user_id(request)

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission
    require_permission(
        db, user, "case_view",
        allow_admin=True,
        error_message="You do not have permission to view use cases"
    )

    # Verify use case exists and user has access
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")

    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")

    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == use_case.domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)

    from app.models import User
    comments = db.query(UseCaseComment).filter(UseCaseComment.use_case_id == use_case_id).order_by(UseCaseComment.comment_date.desc()).all()
    result = []
    for c in comments:
        u = db.query(User).filter(User.user_id == c.comment_by).first()
        result.append({
            "comment_id": c.comment_id,
            "use_case_id": c.use_case_id,
            "comment_date": c.comment_date.isoformat() if c.comment_date else None,
            "comment_by": c.comment_by,
            "comment": c.comment,
            "rating": c.rating,
            "user_name": u.user_name if u else None,
        })
    return result


@router.post("/{use_case_id}/comments")
async def create_use_case_comment(
    use_case_id: str,
    comment: UseCaseCommentCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Create a comment (and optional rating) for a use case. Requires case_comment permission and domain access."""
    user_id = get_current_user_id(request)
    _check_use_case_access(db, user_id, use_case_id, require_edit=False)
    _check_use_case_permission(db, user_id, "case_comment", error_message="You do not have permission to add comments or ratings to use cases")
    rating_val = comment.rating
    if rating_val is not None and (rating_val < 1 or rating_val > 5):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rating must be between 1 and 5"
        )
    new_comment = UseCaseComment(
        use_case_id=use_case_id,
        comment=comment.comment,
        comment_by=user_id,
        rating=rating_val
    )
    db.add(new_comment)
    db.commit()
    db.refresh(new_comment)
    from app.models import User
    u = db.query(User).filter(User.user_id == new_comment.comment_by).first()
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if use_case:
        notify_comment_added(
            db,
            use_case,
            actor=u,
            comment_preview=new_comment.comment,
        )
    return {
        "comment_id": new_comment.comment_id,
        "use_case_id": new_comment.use_case_id,
        "comment_date": new_comment.comment_date.isoformat() if new_comment.comment_date else None,
        "comment_by": new_comment.comment_by,
        "comment": new_comment.comment,
        "rating": new_comment.rating,
        "user_name": u.user_name if u else None,
    }


@router.put("/{use_case_id}/comments/{comment_id}")
async def update_use_case_comment(
    use_case_id: str,
    comment_id: int,
    data: UseCaseCommentUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Update a comment's rating. Requires case_comment permission; user can only update their own comment's rating."""
    user_id = get_current_user_id(request)
    _check_use_case_access(db, user_id, use_case_id, require_edit=False)
    _check_use_case_permission(db, user_id, "case_comment", error_message="You do not have permission to add or update comments/ratings on use cases")
    c = db.query(UseCaseComment).filter(
        UseCaseComment.comment_id == comment_id,
        UseCaseComment.use_case_id == use_case_id
    ).first()
    if not c:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if c.comment_by != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only update your own comment's rating")
    if data.rating is not None:
        if data.rating < 1 or data.rating > 5:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rating must be between 1 and 5")
        c.rating = data.rating
    db.commit()
    db.refresh(c)
    from app.models import User
    u = db.query(User).filter(User.user_id == c.comment_by).first()
    return {
        "comment_id": c.comment_id,
        "use_case_id": c.use_case_id,
        "comment_date": c.comment_date.isoformat() if c.comment_date else None,
        "comment_by": c.comment_by,
        "comment": c.comment,
        "rating": c.rating,
        "user_name": u.user_name if u else None,
    }
