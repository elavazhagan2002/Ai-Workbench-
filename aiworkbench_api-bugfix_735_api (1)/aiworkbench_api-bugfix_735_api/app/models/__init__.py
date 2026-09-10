"""
Database models.
"""
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import CHAR
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.field_limits import (
    BALANCING_STRATEGY_MAX_LENGTH,
    EXPECTED_BENEFITS_MAX_LENGTH,
    HUMAN_IN_LOOP_STRATEGY_MAX_LENGTH,
    INTENDED_USE_MAX_LENGTH,
    PROTECTED_ATTRIBUTES_MAX_LENGTH,
    USE_CASE_DESCRIPTION_MAX_LENGTH,
)


def generate_uuid():
    """Generate a UUID string."""
    return str(uuid.uuid4())


class Permission(Base):
    __tablename__ = "permissions"

    permission_id = Column(String(36), primary_key=True, default=generate_uuid)
    permission_name = Column(String(30), unique=True, nullable=False)
    # workflow | usecase | portal — taxonomy for Settings UI grouping
    permission_type = Column(String(20), nullable=False, default="portal")
    created_by = Column(String(36), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Role(Base):
    __tablename__ = "roles"

    role_id = Column(String(36), primary_key=True, default=generate_uuid)
    role_name = Column(String(25), unique=True, nullable=False)
    role_description = Column(String(250), nullable=True)
    created_by = Column(String(36), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    role_permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id = Column(String(36), ForeignKey("roles.role_id", ondelete="CASCADE"), primary_key=True)
    permission_id = Column(String(36), ForeignKey("permissions.permission_id", ondelete="CASCADE"), primary_key=True)
    created_by = Column(String(36), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    role = relationship("Role", back_populates="role_permissions")
    permission = relationship("Permission")


class User(Base):
    __tablename__ = "users"

    user_id = Column(String(36), primary_key=True, default=generate_uuid)
    user_image = Column(Text, nullable=True)
    user_name = Column(String(25), unique=True, nullable=False)
    user_email = Column(String(100), unique=True, nullable=False)
    organization = Column(String(100), nullable=True)
    # Optional free-text organization type label selected from managed list
    organization_type = Column(String(100), nullable=True)
    user_pwd = Column(String(255), nullable=False)
    role_id = Column(String(36), ForeignKey("roles.role_id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    registration_status = Column(String(20), default="approved", nullable=False, index=True)
    interested_domain_id = Column(String(36), ForeignKey("domains.domain_id", ondelete="SET NULL"), nullable=True)
    created_by = Column(String(36), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    role = relationship("Role")


class UserLoginIP(Base):
    """Trusted login IP addresses verified for a user."""

    __tablename__ = "user_login_ips"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(36), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    ip_address = Column(String(45), nullable=False)
    first_seen_at = Column(DateTime, server_default=func.now(), nullable=False)
    last_seen_at = Column(DateTime, server_default=func.now(), nullable=False)
    verified_via_passcode = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "ip_address", name="uq_user_login_ips_user_ip"),
        Index("ix_user_login_ips_user_id", "user_id"),
        Index("ix_user_login_ips_ip_address", "ip_address"),
    )


class Domain(Base):
    __tablename__ = "domains"

    domain_id = Column(String(36), primary_key=True, default=generate_uuid)
    domain_short_name = Column(String(8), unique=True, nullable=False)
    domain_name = Column(String(50), unique=True, nullable=False)
    domain_detail = Column(String(250), nullable=True)
    owner_id = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class DomainAccess(Base):
    __tablename__ = "domain_access"

    domain_id = Column(String(36), ForeignKey("domains.domain_id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class UseCase(Base):
    __tablename__ = "use_cases"

    use_case_id = Column(String(36), primary_key=True, default=generate_uuid)
    domain_id = Column(String(36), ForeignKey("domains.domain_id", ondelete="CASCADE"), nullable=False)
    use_case_name = Column(String(30), nullable=False)
    use_case_title = Column(String(100), nullable=True)
    use_case_description = Column(String(USE_CASE_DESCRIPTION_MAX_LENGTH), nullable=True)
    intended_use = Column(String(INTENDED_USE_MAX_LENGTH), nullable=True)
    expected_benefits = Column(String(EXPECTED_BENEFITS_MAX_LENGTH), nullable=True)
    department = Column(String(30), nullable=True)
    ai_category = Column(CHAR(1), nullable=True)
    feasibility = Column(Text, nullable=True)
    status = Column(Text, default="New", nullable=False)
    intended_audience = Column(String(200), nullable=True)  # Target users/audience for the use case
    target_audience_type = Column(JSON, nullable=True)
    impacted_stakeholders = Column(JSON, nullable=True)
    technical_owner = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    business_owner = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    solution_design_overview = Column(Text, nullable=True)
    human_in_loop_strategy = Column(String(HUMAN_IN_LOOP_STRATEGY_MAX_LENGTH), nullable=True)
    bias_assessment_performed = Column(Boolean, default=False, nullable=False)
    protected_attributes = Column(String(PROTECTED_ATTRIBUTES_MAX_LENGTH), nullable=True)
    balancing_strategy = Column(String(BALANCING_STRATEGY_MAX_LENGTH), nullable=True)
    rejection_reason = Column(Text, nullable=True)  # Required when status is set to Rejected

    # Analysis assignment & completion tracking
    analysis_assigned_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    analysis_assigned_dt = Column(DateTime, nullable=True)
    analysis_due_date = Column(DateTime, nullable=True)
    tech_analysis_completed_dt = Column(DateTime, nullable=True)
    business_analysis_completed_dt = Column(DateTime, nullable=True)
    tech_analysis_rejected_dt = Column(DateTime, nullable=True)
    tech_analysis_rejection_note = Column(Text, nullable=True)
    business_analysis_rejected_dt = Column(DateTime, nullable=True)
    business_analysis_rejection_note = Column(Text, nullable=True)

    # Business analysis scoring
    frequency_of_task = Column(String(40), nullable=True)
    current_effort = Column(String(40), nullable=True)
    user_group_size = Column(String(40), nullable=True)
    efficiency_impact = Column(String(40), nullable=True)
    quality_compliance_impact = Column(String(60), nullable=True)
    user_urgency = Column(String(60), nullable=True)
    process_impact = Column(String(80), nullable=True)
    operational_compliance_risk = Column(String(40), nullable=True)

    # Technical analysis scoring
    tool_complexity = Column(String(80), nullable=True)
    host_system_capability = Column(String(80), nullable=True)
    data_privacy_security = Column(String(20), nullable=True)

    # Estimate assignment & cost projection (JSON)
    estimate_owner = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    estimate_assigned_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    estimate_assigned_dt = Column(DateTime, nullable=True)
    estimate_due_date = Column(DateTime, nullable=True)
    estimate_completed_dt = Column(DateTime, nullable=True)
    estimate_data = Column(JSON, nullable=True)

    # ROI assignment & savings projection (JSON)
    roi_owner = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    roi_assigned_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    roi_assigned_dt = Column(DateTime, nullable=True)
    roi_due_date = Column(DateTime, nullable=True)
    roi_completed_dt = Column(DateTime, nullable=True)
    roi_data = Column(JSON, nullable=True)

    # AI Assessment assignment
    assessment_owner = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    assessment_assigned_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    assessment_assigned_dt = Column(DateTime, nullable=True)
    assessment_due_date = Column(DateTime, nullable=True)
    assessment_completed_dt = Column(DateTime, nullable=True)

    # Relative path to mapped demo video under DEMO_VIDEOS_ROOT (e.g. "domain1/usecase1/demo.mp4")
    demo_video_path = Column(String(300), nullable=True)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationship to tags
    tags = relationship("UseCaseTag", back_populates="use_case", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("domain_id", "use_case_name", name="uq_use_case_domain_name"),
        CheckConstraint("ai_category IN ('P', 'G', 'A', 'S')", name="check_ai_category"),
        CheckConstraint("feasibility IN ('Yes', 'No', 'Yes (Difficult)')", name="check_feasibility"),
        CheckConstraint(
            "status IN ('New', 'Analysis', 'Review', 'Estimate', 'ROI', 'AI Assessment', "
            "'Approved', 'Rejected', 'Development', 'Testing', 'Production', 'Retired')",
            name="check_status",
        ),
    )


class UseCaseData(Base):
    __tablename__ = "use_case_data"

    data_req_id = Column(Integer, primary_key=True, autoincrement=True)
    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), nullable=False)
    data_req = Column(String(250), nullable=True)
    data_source = Column(String(30), nullable=True)
    volume = Column(String(20), nullable=True)
    data_classification = Column(String(30), nullable=True)
    data_owner = Column(String(100), nullable=True)
    data_usage = Column(JSON, nullable=True)
    is_pii_phi_involved = Column(Boolean, default=False, nullable=False)
    dataset_type = Column(String(20), nullable=True)
    data_lineage_available = Column(Boolean, default=False, nullable=False)
    data_quality_assessed = Column(Boolean, default=False, nullable=False)
    data_freshness_confirmed = Column(Boolean, default=False, nullable=False)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "data_classification IS NULL OR data_classification IN ('Public', 'Internal-Use', 'Confidential', 'Restricted', 'Highly-Restricted')",
            name="check_data_classification",
        ),
        CheckConstraint(
            "dataset_type IS NULL OR dataset_type IN ('Synthetic', 'Real')",
            name="check_dataset_type",
        ),
    )


class UseCaseRisk(Base):
    __tablename__ = "use_case_risks"

    risk_id = Column(Integer, primary_key=True, autoincrement=True)
    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), nullable=False)
    risk_category = Column(Text, nullable=True)
    risk_title = Column(String(50), nullable=True)
    risk_description = Column(Text, nullable=True)
    risk_likelihood = Column(Text, nullable=True)
    risk_impact = Column(Text, nullable=True)
    mitigation_strategy = Column(Text, nullable=True)
    risk_status = Column(Text, default="open", nullable=False)
    risk_closure_comment = Column(String(200), nullable=True)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("risk_category IN ('Business', 'Technical', 'Compliance', 'Operational', 'Data Quality')", name="check_risk_category"),
        CheckConstraint("risk_likelihood IN ('low', 'medium', 'high', 'critical')", name="check_risk_likelihood"),
        CheckConstraint("risk_impact IN ('low', 'medium', 'high', 'critical')", name="check_risk_impact"),
        CheckConstraint("risk_status IN ('open', 'closed', 'cancelled')", name="check_risk_status"),
    )


class UseCaseRiskReview(Base):
    """Merged risk + review: risk with assignment, mitigation strategy, and closure comment."""
    __tablename__ = "use_case_risk_reviews"

    risk_review_id = Column(Integer, primary_key=True, autoincrement=True)
    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), nullable=False)
    risk_category = Column(Text, nullable=True)
    risk_title = Column(String(50), nullable=True)
    risk_description = Column(Text, nullable=True)
    risk_likelihood = Column(Text, nullable=True)
    risk_impact = Column(Text, nullable=True)
    assigned_to = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    mitigation_strategy = Column(Text, nullable=True)
    closure_comment = Column(String(500), nullable=True)
    status = Column(Text, default="open", nullable=False)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("risk_category IN ('Operational', 'Business', 'Technical')", name="check_risk_review_category"),
        CheckConstraint("risk_likelihood IN ('low', 'medium', 'high', 'critical')", name="check_risk_review_likelihood"),
        CheckConstraint("risk_impact IN ('low', 'medium', 'high', 'critical')", name="check_risk_review_impact"),
        CheckConstraint("status IN ('open', 'closed')", name="check_risk_review_status"),
    )


class UseCaseReview(Base):
    __tablename__ = "use_case_reviews"

    review_id = Column(Integer, primary_key=True, autoincrement=True)
    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), nullable=False)
    review_type = Column(Text, nullable=True)
    assigned_to = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    review_status = Column(Text, default="open", nullable=False)
    rating = Column(Integer, nullable=True)  # 1-5 star rating from reviewer
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("review_type IN ('Business', 'Technical', 'Compliance', 'Operational', 'Data Quality')", name="check_review_type"),
        CheckConstraint("review_status IN ('open', 'closed')", name="check_review_status"),
        CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="check_review_rating"),
    )


class UseCaseComment(Base):
    __tablename__ = "use_case_comments"

    comment_id = Column(Integer, primary_key=True, autoincrement=True)
    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), nullable=False)
    comment_date = Column(DateTime, server_default=func.now(), nullable=False)
    comment_by = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    comment = Column(String(300), nullable=True)
    rating = Column(Integer, nullable=True)  # 1-5 star rating (associated with comment)

    user = relationship("User")

    __table_args__ = (
        CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="check_comment_rating"),
    )


class UseCaseTag(Base):
    __tablename__ = "use_case_tags"

    tag_id = Column(Integer, primary_key=True, autoincrement=True)
    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), nullable=False)
    tag_name = Column(String(50), nullable=False)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)

    use_case = relationship("UseCase", back_populates="tags")

    __table_args__ = (
        # Ensure unique tag names per use case
        {"sqlite_autoincrement": True},
    )


class UseCaseLink(Base):
    """Reference link for a use case (URL + optional label). Stored in DB; no file."""
    __tablename__ = "use_case_links"

    link_id = Column(Integer, primary_key=True, autoincrement=True)
    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), nullable=False)
    url = Column(String(500), nullable=False)
    label = Column(String(200), nullable=True)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)


class UseCaseDocument(Base):
    """Metadata for a reference document attached to a use case. File stored under FILE_STORAGE_ROOT."""
    __tablename__ = "use_case_documents"

    document_id = Column(Integer, primary_key=True, autoincrement=True)
    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), nullable=False)
    file_name = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)  # relative to use_case_docs / use_case_id
    content_type = Column(String(100), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    uploaded_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    uploaded_dt = Column(DateTime, server_default=func.now(), nullable=False)


class UseCaseDocumentationQualityResult(Base):
    """Latest persisted documentation quality analysis for a use case."""
    __tablename__ = "use_case_documentation_quality_results"

    use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="CASCADE"), primary_key=True)
    overall_score = Column(Integer, nullable=False)
    strengths_count = Column(Integer, nullable=False, default=0)
    improvements_count = Column(Integer, nullable=False, default=0)
    status_label = Column(String(40), nullable=False)
    analyzed_at = Column(DateTime, server_default=func.now(), nullable=False)
    source_updated_at = Column(DateTime, nullable=True)
    analysis_payload = Column(Text, nullable=False)


class OrganizationType(Base):
    """Lookup table for allowed organization types."""

    __tablename__ = "organization_types"

    org_type_id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(250), nullable=True)
    created_by = Column(String(36), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class AssessmentChecklistTemplate(Base):
    __tablename__ = "assessment_checklist_templates"

    template_id = Column(String(36), primary_key=True, default=generate_uuid)
    version_number = Column(Integer, nullable=False)
    name = Column(String(200), nullable=False)
    status = Column(String(20), nullable=False, default="DRAFT")
    is_active = Column(Boolean, default=False, nullable=False)
    source_template_id = Column(String(36), ForeignKey("assessment_checklist_templates.template_id"), nullable=True)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    risk_classification_ranges = Column(JSON, nullable=True)

    areas = relationship(
        "AssessmentChecklistArea",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="AssessmentChecklistArea.seq_no",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT', 'IN REVIEW', 'EFFECTIVE', 'DEPRECATED')",
            name="check_assessment_checklist_status",
        ),
    )


class AssessmentChecklistArea(Base):
    __tablename__ = "assessment_checklist_areas"

    area_id = Column(Integer, primary_key=True, autoincrement=True)
    template_id = Column(
        String(36),
        ForeignKey("assessment_checklist_templates.template_id", ondelete="CASCADE"),
        nullable=False,
    )
    seq_no = Column(Integer, nullable=False)
    title = Column(String(200), nullable=False)

    template = relationship("AssessmentChecklistTemplate", back_populates="areas")
    items = relationship(
        "AssessmentChecklistItem",
        back_populates="area",
        cascade="all, delete-orphan",
        order_by="AssessmentChecklistItem.sno",
    )


class AssessmentChecklistItem(Base):
    __tablename__ = "assessment_checklist_items"

    item_id = Column(Integer, primary_key=True, autoincrement=True)
    area_id = Column(
        Integer,
        ForeignKey("assessment_checklist_areas.area_id", ondelete="CASCADE"),
        nullable=False,
    )
    sno = Column(String(20), nullable=False)
    assessment_item = Column(String(500), nullable=False)
    category = Column(String(50), nullable=False)
    base_score = Column(Float, nullable=False, default=0.0)
    penalty_factor = Column(Float, nullable=False, default=1.0)
    allowed_checklist_items = Column(JSON, nullable=True)

    area = relationship("AssessmentChecklistArea", back_populates="items")

    __table_args__ = (
        CheckConstraint(
            "category IN ('Business', 'Governance', 'Legal & Compliance', 'Technical', 'Security & Data Privacy', 'Operations')",
            name="check_assessment_item_category",
        ),
    )


class UseCaseAssessment(Base):
    __tablename__ = "use_case_assessments"

    assessment_id = Column(String(36), primary_key=True, default=generate_uuid)
    use_case_id = Column(
        String(36),
        ForeignKey("use_cases.use_case_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    template_id = Column(String(36), ForeignKey("assessment_checklist_templates.template_id"), nullable=False)
    template_version_number = Column(Integer, nullable=False)
    template_name = Column(String(200), nullable=False)
    template_snapshot = Column(JSON, nullable=False)
    status = Column(String(20), nullable=False, default="IN_PROGRESS")
    initiated_by = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    initiated_dt = Column(DateTime, server_default=func.now(), nullable=False)
    closed_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    closed_dt = Column(DateTime, nullable=True)
    next_review_date = Column(DateTime, nullable=True)
    total_score = Column(Float, nullable=True)
    risk_classification = Column(String(20), nullable=True)
    overall_findings = Column(Text, nullable=True)
    area_summaries = Column(JSON, nullable=True)
    question_scores = Column(JSON, nullable=True)
    ai_prefill_applied = Column(Boolean, default=False, nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    responses = relationship(
        "UseCaseAssessmentResponse",
        back_populates="assessment",
        cascade="all, delete-orphan",
    )
    history = relationship(
        "UseCaseAssessmentResponseHistory",
        back_populates="assessment",
        cascade="all, delete-orphan",
        order_by="UseCaseAssessmentResponseHistory.changed_dt.desc()",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('IN_PROGRESS', 'CLOSED')",
            name="check_use_case_assessment_status",
        ),
    )


class UseCaseAssessmentResponse(Base):
    __tablename__ = "use_case_assessment_responses"

    response_id = Column(String(36), primary_key=True, default=generate_uuid)
    assessment_id = Column(
        String(36),
        ForeignKey("use_case_assessments.assessment_id", ondelete="CASCADE"),
        nullable=False,
    )
    template_item_id = Column(Integer, nullable=False)
    area_id = Column(Integer, nullable=False)
    sno = Column(String(20), nullable=False)
    selected_answers = Column(JSON, nullable=True)
    comment = Column(Text, nullable=True)
    answered_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    answered_dt = Column(DateTime, nullable=True)
    last_modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    last_modified_dt = Column(DateTime, nullable=True)

    assessment = relationship("UseCaseAssessment", back_populates="responses")

    __table_args__ = (
        UniqueConstraint("assessment_id", "template_item_id", name="uq_assessment_item_response"),
    )


class UseCaseAssessmentResponseHistory(Base):
    __tablename__ = "use_case_assessment_response_history"

    history_id = Column(String(36), primary_key=True, default=generate_uuid)
    assessment_id = Column(
        String(36),
        ForeignKey("use_case_assessments.assessment_id", ondelete="CASCADE"),
        nullable=False,
    )
    template_item_id = Column(Integer, nullable=False)
    sno = Column(String(20), nullable=False)
    selected_answers = Column(JSON, nullable=True)
    comment = Column(Text, nullable=True)
    changed_by = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    changed_dt = Column(DateTime, server_default=func.now(), nullable=False)
    change_action = Column(String(20), nullable=False, default="updated")

    assessment = relationship("UseCaseAssessment", back_populates="history")


class AnonymousIdea(Base):
    """Anonymous idea submissions (no registration). Can be qualified into a use case."""
    __tablename__ = "anonymous_ideas"

    idea_id = Column(String(36), primary_key=True, default=generate_uuid)
    domain_id = Column(String(36), ForeignKey("domains.domain_id", ondelete="SET NULL"), nullable=True)
    idea_text = Column(Text, nullable=False)
    submitted_by_name = Column(String(100), nullable=True)
    submitted_by_email = Column(String(255), nullable=True)
    submitted_by_organization = Column(String(200), nullable=True)
    status = Column(String(20), default="new", nullable=False)  # 'new' | 'qualified'
    qualified_use_case_id = Column(String(36), ForeignKey("use_cases.use_case_id", ondelete="SET NULL"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)


class BugReport(Base):
    """Bug reports and feature requests from users (with optional screenshot)."""
    __tablename__ = "bug_reports"

    report_id = Column(String(36), primary_key=True, default=generate_uuid)
    report_type = Column(String(20), nullable=False)  # 'bug' | 'feature'
    comments = Column(Text, nullable=True)
    submitted_dt = Column(DateTime, server_default=func.now(), nullable=False)
    submitted_by = Column(String(36), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    screenshot = Column(Text, nullable=True)  # base64 PNG data URL or raw base64
    release_number = Column(String(50), nullable=True)  # e.g. "1.0.0" - which release this is assigned to


class BlogPost(Base):
    """Published or draft blog/article. Binary/HTML file under FILE_STORAGE_ROOT / blog_content."""

    __tablename__ = "blog_posts"

    blog_post_id = Column(String(36), primary_key=True, default=generate_uuid)
    title = Column(String(200), nullable=False)
    kind = Column(String(20), nullable=False)  # 'blog' | 'article'
    content_format = Column(String(10), nullable=False)  # 'pdf' | 'html'
    stored_path = Column(String(500), nullable=False)  # relative to blog_content root, e.g. {id}/content.pdf
    published = Column(Boolean, default=False, nullable=False)
    published_at = Column(DateTime, nullable=True)
    summary = Column(Text, nullable=True)
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    creator = relationship("User", foreign_keys=[created_by])


class AuditLog(Base):
    __tablename__ = "audit_logs"

    audit_id = Column(String(36), primary_key=True, default=generate_uuid)
    audit_date = Column(DateTime, server_default=func.now(), nullable=False)
    type = Column(Text, nullable=False)
    action = Column(Text, nullable=False)
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    details = Column(JSON, nullable=True)

    user = relationship("User")


class SystemConfig(Base):
    __tablename__ = "system_config"

    config_id = Column(String(36), primary_key=True, default=generate_uuid)
    config_data = Column(JSON, nullable=False, default={})
    created_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    created_dt = Column(DateTime, server_default=func.now(), nullable=False)
    modified_by = Column(String(36), ForeignKey("users.user_id"), nullable=True)
    modified_dt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
