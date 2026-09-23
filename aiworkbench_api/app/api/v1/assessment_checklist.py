"""AI Assessment Checklist template management endpoints."""

import json

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.assessment_checklist_options import (
    ASSESSMENT_CHECKLIST_STATUSES,
    ASSESSMENT_ITEM_CATEGORIES,
    ASSESSMENT_ITEM_MAX_LENGTH,
    ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH,
    DEFAULT_PENALTY_FACTOR,
    normalize_category,
    normalize_penalty_factor,
    normalize_question_answers,
    normalize_status,
    parse_checklist_import_payload,
)
from app.core.authorization import get_user_with_permissions, require_permission
from app.core.database import get_db
from app.core.logging_config import logger
from app.middleware.auth_middleware import get_current_user_id
from app.models import AssessmentChecklistTemplate
from app.services.assessment_checklist_service import (
    activate_template,
    add_template_area,
    add_template_item,
    apply_risk_classification_ranges,
    clone_template,
    create_template_from_import,
    create_template_from_scratch,
    deprecate_template,
    replace_template_areas,
    serialize_template,
    template_is_locked,
    update_template_item,
    update_template_settings,
    validate_status_update,
)

router = APIRouter()

MAX_CHECKLIST_IMPORT_BYTES = 5 * 1024 * 1024


def _require_checklist_permission(db: Session, user_id: str):
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "manage_assessment_checklist",
        allow_admin=True,
        error_message="You do not have permission to manage AI assessment checklist templates",
    )
    return user


class ChecklistAnswerInput(BaseModel):
    label: str = Field(max_length=200)
    penalty_factor: float = Field(default=DEFAULT_PENALTY_FACTOR, ge=0)

    @field_validator("penalty_factor", mode="before")
    @classmethod
    def validate_penalty_factor(cls, value):
        return normalize_penalty_factor(value)


class ChecklistItemInput(BaseModel):
    sno: str
    assessment_item: str = Field(max_length=ASSESSMENT_ITEM_MAX_LENGTH)
    category: str
    allowed_checklist_items: list[ChecklistAnswerInput] = Field(default_factory=list)

    @field_validator("category", mode="before")
    @classmethod
    def validate_category(cls, value):
        normalized = normalize_category(value)
        if normalized is None:
            raise ValueError(
                f"Category must be one of: {', '.join(ASSESSMENT_ITEM_CATEGORIES)}"
            )
        return normalized

    @field_validator("allowed_checklist_items", mode="before")
    @classmethod
    def validate_allowed_checklist_items(cls, value):
        return normalize_question_answers(value)


class ChecklistAreaInput(BaseModel):
    seq_no: int
    title: str = Field(max_length=200)
    items: list[ChecklistItemInput] = Field(default_factory=list)


class RiskClassificationRangeInput(BaseModel):
    level: str
    min_score: float = Field(ge=0)
    max_score: float = Field(ge=0)


class TemplateCreate(BaseModel):
    name: str = Field(max_length=ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH)
    clone_from_template_id: str | None = None
    areas: list[ChecklistAreaInput] | None = None
    risk_classification_ranges: list[RiskClassificationRangeInput] | None = None


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH)
    status: str | None = None
    areas: list[ChecklistAreaInput] | None = None
    risk_classification_ranges: list[RiskClassificationRangeInput] | None = None

    @field_validator("status", mode="before")
    @classmethod
    def validate_status(cls, value):
        if value in (None, ""):
            return None
        normalized = normalize_status(value)
        if normalized is None:
            raise ValueError(
                f"Status must be one of: {', '.join(ASSESSMENT_CHECKLIST_STATUSES)}"
            )
        return normalized


class TemplateClone(BaseModel):
    name: str = Field(max_length=ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH)


class AreaCreateInput(BaseModel):
    title: str = Field(max_length=200)


class AreaTitleUpdate(BaseModel):
    area_id: int
    title: str = Field(max_length=200)


class TemplateSettingsUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH)
    status: str | None = None
    risk_classification_ranges: list[RiskClassificationRangeInput] | None = None
    area_titles: list[AreaTitleUpdate] | None = None

    @field_validator("status", mode="before")
    @classmethod
    def validate_status(cls, value):
        if value in (None, ""):
            return None
        normalized = normalize_status(value)
        if normalized is None:
            raise ValueError(
                f"Status must be one of: {', '.join(ASSESSMENT_CHECKLIST_STATUSES)}"
            )
        return normalized


@router.get("/templates")
async def list_assessment_checklist_templates(
    request: Request,
    db: Session = Depends(get_db),
):
    _require_checklist_permission(db, get_current_user_id(request))
    templates = (
        db.query(AssessmentChecklistTemplate)
        .order_by(AssessmentChecklistTemplate.version_number.desc())
        .all()
    )
    return [serialize_template(template, db, include_areas=False) for template in templates]


@router.get("/templates/{template_id}")
async def get_assessment_checklist_template(
    template_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    _require_checklist_permission(db, get_current_user_id(request))
    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return serialize_template(template, db, include_areas=True)


@router.post("/templates", status_code=status.HTTP_201_CREATED)
async def create_assessment_checklist_template(
    payload: TemplateCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)

    has_existing = db.query(AssessmentChecklistTemplate.template_id).first() is not None
    try:
        if not has_existing:
            if not payload.areas:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="The first template must include assessment areas and items",
                )
            template = create_template_from_scratch(
                db,
                name=payload.name,
                user_id=user_id,
                areas_payload=[area.model_dump() for area in payload.areas],
                risk_classification_ranges=(
                    [row.model_dump() for row in payload.risk_classification_ranges]
                    if payload.risk_classification_ranges
                    else None
                ),
            )
        else:
            if not payload.clone_from_template_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Additional templates must be cloned from an existing template",
                )
            template = clone_template(
                db,
                source_template_id=payload.clone_from_template_id,
                name=payload.name,
                user_id=user_id,
            )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.post("/templates/{template_id}/clone", status_code=status.HTTP_201_CREATED)
async def clone_assessment_checklist_template(
    template_id: str,
    payload: TemplateClone,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)
    try:
        template = clone_template(
            db,
            source_template_id=template_id,
            name=payload.name,
            user_id=user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.post("/templates/import", status_code=status.HTTP_201_CREATED)
async def import_assessment_checklist_template(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Import a new DRAFT checklist template from a JSON file."""
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)

    filename = (file.filename or "").strip().lower()
    if filename and not filename.endswith(".json"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload a .json assessment checklist file",
        )

    try:
        raw_bytes = await file.read()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read uploaded file",
        ) from exc

    if not raw_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )
    if len(raw_bytes) > MAX_CHECKLIST_IMPORT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File exceeds maximum size (5 MB)",
        )

    try:
        raw_payload = json.loads(raw_bytes.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be UTF-8 encoded JSON",
        ) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid JSON: {exc.msg}",
        ) from exc

    try:
        parsed = parse_checklist_import_payload(raw_payload)
        template = create_template_from_import(
            db,
            name=parsed["name"],
            user_id=user_id,
            areas_payload=parsed["areas"],
            risk_classification_ranges=parsed.get("risk_classification_ranges"),
        )
        db.commit()
        db.refresh(template)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        logger.error("Failed to import assessment checklist template", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to import assessment checklist template",
        ) from exc

    return serialize_template(template, db, include_areas=True)


@router.put("/templates/{template_id}")
async def update_assessment_checklist_template(
    template_id: str,
    payload: TemplateUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)

    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if template.is_active or template_is_locked(template.status):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active or deprecated templates cannot be edited",
        )

    try:
        if payload.name is not None:
            template.name = payload.name.strip()
        if payload.status is not None:
            template.status = validate_status_update(template.status, payload.status)
        if payload.areas is not None:
            replace_template_areas(template, [area.model_dump() for area in payload.areas])
            apply_risk_classification_ranges(template, None, revalidate_existing=True)
        if payload.risk_classification_ranges is not None:
            apply_risk_classification_ranges(
                template,
                [row.model_dump() for row in payload.risk_classification_ranges],
            )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    template.modified_by = user_id
    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.put("/templates/{template_id}/settings")
async def update_assessment_checklist_template_settings(
    template_id: str,
    payload: TemplateSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)

    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if template.is_active or template_is_locked(template.status):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active or deprecated templates cannot be edited",
        )

    try:
        update_template_settings(
            template,
            name=payload.name,
            status=payload.status,
            risk_classification_ranges=(
                [row.model_dump() for row in payload.risk_classification_ranges]
                if payload.risk_classification_ranges is not None
                else None
            ),
            area_titles=(
                [row.model_dump() for row in payload.area_titles]
                if payload.area_titles is not None
                else None
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    template.modified_by = user_id
    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.post("/templates/{template_id}/areas", status_code=status.HTTP_201_CREATED)
async def add_assessment_checklist_area(
    template_id: str,
    payload: AreaCreateInput,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)

    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if template.is_active or template_is_locked(template.status):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active or deprecated templates cannot be edited",
        )

    add_template_area(template, payload.title)
    apply_risk_classification_ranges(template, None, revalidate_existing=True)
    template.modified_by = user_id
    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.post("/templates/{template_id}/areas/{area_id}/items", status_code=status.HTTP_201_CREATED)
async def add_assessment_checklist_item(
    template_id: str,
    area_id: int,
    payload: ChecklistItemInput,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)

    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if template.is_active or template_is_locked(template.status):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active or deprecated templates cannot be edited",
        )

    try:
        add_template_item(template, area_id, payload.model_dump())
        apply_risk_classification_ranges(template, None, revalidate_existing=True)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    template.modified_by = user_id
    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.put("/templates/{template_id}/items/{item_id}")
async def update_assessment_checklist_item(
    template_id: str,
    item_id: int,
    payload: ChecklistItemInput,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)

    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if template.is_active or template_is_locked(template.status):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active or deprecated templates cannot be edited",
        )

    try:
        update_template_item(template, item_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    template.modified_by = user_id
    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.post("/templates/{template_id}/activate")
async def activate_assessment_checklist_template(
    template_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)
    try:
        template = activate_template(db, template_id, user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.post("/templates/{template_id}/deprecate")
async def deprecate_assessment_checklist_template(
    template_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    _require_checklist_permission(db, user_id)
    try:
        template = deprecate_template(db, template_id, user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    db.commit()
    db.refresh(template)
    return serialize_template(template, db, include_areas=True)


@router.delete("/templates/{template_id}")
async def delete_assessment_checklist_template(
    template_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    _require_checklist_permission(db, get_current_user_id(request))
    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if template.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The active template cannot be deleted",
        )
    if template.status not in {"DRAFT", "IN REVIEW"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft or in-review templates can be deleted",
        )

    db.delete(template)
    db.commit()
    return {"message": "Template deleted successfully"}
