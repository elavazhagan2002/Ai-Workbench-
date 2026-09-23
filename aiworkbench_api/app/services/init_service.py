"""
Service for initializing default data.
"""
import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.logging_config import logger
from app.core.security import get_password_hash
from app.core.workflow import (
    ROLE_RENAMES,
    USECASE_ACTION_PERMISSIONS,
    WORKFLOW_PERMISSIONS,
)
from app.models import Permission, Role, RolePermission, SystemConfig, User

SYSTEM_USER = "system"

# permission_name -> permission_type
PERMISSION_DEFINITIONS: dict[str, str] = {
    # workflow — ability to transition into that state
    "workflow_new": "workflow",
    "workflow_analysis": "workflow",
    "workflow_review": "workflow",
    "workflow_estimate": "workflow",
    "workflow_roi": "workflow",
    "workflow_ai_assessment": "workflow",
    "workflow_approved": "workflow",
    "workflow_rejected": "workflow",
    # usecase actions
    "case_create": "usecase",
    "case_edit": "usecase",
    "case_view": "usecase",
    "case_delete": "usecase",
    "case_assign": "usecase",
    "case_approve": "usecase",
    "case_reject": "usecase",
    "case_comment": "usecase",
    "case_review": "usecase",
    # portal actions
    "audit_access": "portal",
    "settings_access": "portal",
    "create_domain": "portal",
    "edit_domain": "portal",
    "delete_domain": "portal",
    "domain_access": "portal",
    "domain_owner": "portal",
    "map_demo": "portal",
    "view_demo": "portal",
    "view_live_demo": "portal",
    "view_document": "portal",
    "view_infographic": "portal",
    "view_blog": "portal",
    "manage_blog": "portal",
    "manage_assessment_checklist": "portal",
    "initiate_assessment": "portal",
    "contribute_assessment": "portal",
    # dashboard — separate permission set for analytics views
    "dashboard_enterprise": "dashboard",
    "dashboard_domain": "dashboard",
    "dashboard_individual": "dashboard",
}

DEFAULT_PERMISSIONS = list(PERMISSION_DEFINITIONS.keys())

ALL_WORKFLOW = list(WORKFLOW_PERMISSIONS)
ALL_USECASE = list(USECASE_ACTION_PERMISSIONS)

# Shared view / content perms
_VIEW_PERMS = [
    "domain_access",
    "case_view",
    "case_comment",
    "view_demo",
    "view_document",
    "view_infographic",
    "view_blog",
]

_DOMAIN_OWNER_PERMS = (
    ALL_WORKFLOW
    + ALL_USECASE
    + [
        "domain_access",
        "edit_domain",
        "domain_owner",
        "map_demo",
        "view_demo",
        "view_live_demo",
        "view_document",
        "view_infographic",
        "view_blog",
        "manage_blog",
        "initiate_assessment",
        "contribute_assessment",
        "dashboard_domain",
        "dashboard_individual",
    ]
)

_AI_LEADER_PERMS = (
    ALL_WORKFLOW
    + ALL_USECASE
    + [
        "domain_access",
        "domain_owner",
        "map_demo",
        "view_demo",
        "view_live_demo",
        "view_document",
        "view_infographic",
        "view_blog",
        "manage_blog",
        "initiate_assessment",
        "contribute_assessment",
        "dashboard_enterprise",
        "dashboard_domain",
        "dashboard_individual",
    ]
)

_TECH_ARCHITECT_PERMS = [
    "case_create",
    "case_edit",
    "case_view",
    "case_assign",
    "case_approve",
    "case_reject",
    "case_review",
    "case_comment",
    "domain_access",
    "domain_owner",
    "workflow_new",
    "workflow_analysis",
    "workflow_review",
    "workflow_estimate",
    "workflow_roi",
    "workflow_ai_assessment",
    "workflow_approved",
    "workflow_rejected",
    "map_demo",
    "view_demo",
    "view_live_demo",
    "view_document",
    "view_infographic",
    "view_blog",
    "manage_blog",
    "initiate_assessment",
    "dashboard_individual",
]

_BUSINESS_REVIEWER_PERMS = [
    "case_create",
    "case_edit",
    "case_view",
    "case_assign",
    "case_approve",
    "case_reject",
    "case_review",
    "case_comment",
    "domain_access",
    "domain_owner",
    "workflow_new",
    "workflow_analysis",
    "workflow_review",
    "workflow_estimate",
    "workflow_roi",
    "workflow_ai_assessment",
    "workflow_approved",
    "workflow_rejected",
    "view_demo",
    "view_live_demo",
    "view_document",
    "view_infographic",
    "view_blog",
    "contribute_assessment",
    "dashboard_individual",
]

_GENERAL_USER_PERMS = [
    "case_create",
    *_VIEW_PERMS,
    "workflow_new",  # can register into New (create always starts New)
    "dashboard_individual",
]

DEFAULT_ROLES = [
    {
        "role_name": "portal_admin",
        "role_description": "Portal administrator with full unrestricted access",
        "permissions": DEFAULT_PERMISSIONS,
    },
    {
        "role_name": "ai_leader",
        "role_description": "AI governance leader with broad use-case and workflow authority",
        "permissions": _AI_LEADER_PERMS,
    },
    {
        "role_name": "domain_owner",
        "role_description": "Domain owner with full access within assigned domains",
        "permissions": _DOMAIN_OWNER_PERMS,
    },
    {
        "role_name": "tech_architect",
        "role_description": "Technical architect with use case management and assignment capabilities",
        "permissions": _TECH_ARCHITECT_PERMS,
    },
    {
        "role_name": "business_reviewer",
        "role_description": "Business reviewer with review, ROI, and approval/rejection capabilities",
        "permissions": _BUSINESS_REVIEWER_PERMS,
    },
    {
        "role_name": "general_user",
        "role_description": "Standard user who can register and view use cases",
        "permissions": _GENERAL_USER_PERMS,
    },
]

DEFAULT_CONFIG = {
    "system_name": "AI Workbench",
    "version": "1.0.0",
    "currency": "USD",
    "dataTable": {
        "rowsPerPage": 10
    },
    "llm": {
        "provider": "OpenAI",
        "config_source": "ui",
        "enabled": True,
        "openai": {
            "apiKey": "",
            "model": "",
            "organization": "",
            "baseUrl": "",
        },
    },
    "storage": {
        "type": "Local"
    },
    "integrations": {}
}


def migrate_legacy_role_names(db: Session) -> None:
    """Rename Admin/Architect/Reviewer/User roles in place to the new role names."""
    for old_name, new_name in ROLE_RENAMES.items():
        old_role = db.query(Role).filter(Role.role_name == old_name).first()
        if not old_role:
            continue
        existing_new = db.query(Role).filter(Role.role_name == new_name).first()
        if existing_new:
            # Point users at the new role, then remove the legacy duplicate
            db.query(User).filter(User.role_id == old_role.role_id).update(
                {User.role_id: existing_new.role_id},
                synchronize_session=False,
            )
            db.query(RolePermission).filter(RolePermission.role_id == old_role.role_id).delete(
                synchronize_session=False
            )
            db.delete(old_role)
            logger.info("Merged legacy role %s into existing %s", old_name, new_name)
        else:
            old_role.role_name = new_name
            old_role.modified_by = SYSTEM_USER
            logger.info("Renamed role %s -> %s", old_name, new_name)
    db.commit()


def init_permissions(db: Session) -> None:
    """Initialize default permissions with types."""
    logger.info("Initializing default permissions...")

    for perm_name, perm_type in PERMISSION_DEFINITIONS.items():
        existing = db.query(Permission).filter(Permission.permission_name == perm_name).first()
        if not existing:
            permission = Permission(
                permission_name=perm_name,
                permission_type=perm_type,
                created_by=SYSTEM_USER,
                modified_by=SYSTEM_USER,
            )
            db.add(permission)
            logger.debug(f"Created permission: {perm_name} ({perm_type})")
        else:
            if getattr(existing, "permission_type", None) != perm_type:
                existing.permission_type = perm_type
                existing.modified_by = SYSTEM_USER

    db.commit()
    logger.info(f"Initialized {len(DEFAULT_PERMISSIONS)} permissions")
    migrate_legacy_assessment_permissions(db)


def migrate_legacy_assessment_permissions(db: Session) -> None:
    """Grant initiate_assessment to roles that still have deprecated case_assess."""
    legacy = db.query(Permission).filter(Permission.permission_name == "case_assess").first()
    initiate = db.query(Permission).filter(Permission.permission_name == "initiate_assessment").first()
    if not legacy or not initiate:
        return

    legacy_assignments = (
        db.query(RolePermission)
        .filter(RolePermission.permission_id == legacy.permission_id)
        .all()
    )
    for assignment in legacy_assignments:
        exists = (
            db.query(RolePermission)
            .filter(
                RolePermission.role_id == assignment.role_id,
                RolePermission.permission_id == initiate.permission_id,
            )
            .first()
        )
        if not exists:
            db.add(
                RolePermission(
                    role_id=assignment.role_id,
                    permission_id=initiate.permission_id,
                    created_by=SYSTEM_USER,
                    modified_by=SYSTEM_USER,
                )
            )
            logger.debug(
                "Migrated case_assess to initiate_assessment for role_id=%s",
                assignment.role_id,
            )

    db.commit()


def init_roles(db: Session) -> None:
    """Initialize default roles and assign permissions."""
    logger.info("Initializing default roles...")
    migrate_legacy_role_names(db)

    for role_data in DEFAULT_ROLES:
        role_name = role_data["role_name"]
        existing_role = db.query(Role).filter(Role.role_name == role_name).first()

        if not existing_role:
            role = Role(
                role_name=role_name,
                role_description=role_data["role_description"],
                created_by=SYSTEM_USER,
                modified_by=SYSTEM_USER
            )
            db.add(role)
            db.flush()  # Get role_id
            logger.debug(f"Created role: {role_name}")
        else:
            role = existing_role
            if role_data.get("role_description") and role.role_description != role_data["role_description"]:
                role.role_description = role_data["role_description"]
                role.modified_by = SYSTEM_USER

        # Production-safe: only ADD missing default permissions. Never strip
        # operator customizations from existing system roles on restart.
        for perm_name in role_data["permissions"]:
            permission = db.query(Permission).filter(Permission.permission_name == perm_name).first()
            if permission:
                existing_rp = db.query(RolePermission).filter(
                    RolePermission.role_id == role.role_id,
                    RolePermission.permission_id == permission.permission_id
                ).first()
                if not existing_rp:
                    role_permission = RolePermission(
                        role_id=role.role_id,
                        permission_id=permission.permission_id,
                        created_by=SYSTEM_USER,
                        modified_by=SYSTEM_USER
                    )
                    db.add(role_permission)
                    logger.debug(f"Assigned permission {perm_name} to role {role_name}")
        db.commit()
        logger.info(f"Synced permissions for role: {role_name}")


def init_system_config(db: Session) -> None:
    """Initialize default system configuration."""
    logger.info("Initializing system configuration...")

    existing_config = db.query(SystemConfig).first()
    if not existing_config:
        config = SystemConfig(
            config_data=DEFAULT_CONFIG,
            created_by=SYSTEM_USER,
            modified_by=SYSTEM_USER
        )
        db.add(config)
        db.commit()
        logger.info("Created default system configuration")
    else:
        logger.debug("System configuration already exists")


def init_admin_user(db: Session) -> None:
    """
    Create or reset the initial admin user only when ADMIN_EMAIL and ADMIN_INIT_PASSWORD
    are set in configuration (e.g. via environment variables). No credentials are hard-coded.
    """
    from app.core.config import settings

    admin_email = (settings.ADMIN_EMAIL or "").strip()
    admin_password = settings.ADMIN_INIT_PASSWORD or ""

    if not admin_email or not admin_password:
        logger.debug("Skipping default admin init: ADMIN_EMAIL and ADMIN_INIT_PASSWORD must be set in config/env.")
        return

    logger.info("Initializing default portal_admin user...")
    existing_admin = db.query(User).filter(User.user_email == admin_email).first()

    if not existing_admin:
        admin_role = db.query(Role).filter(Role.role_name == "portal_admin").first()
        if not admin_role:
            logger.error("portal_admin role not found. Please ensure roles are initialized first.")
            return

        admin_user = User(
            user_name=admin_email.split("@")[0] if "@" in admin_email else "admin",
            user_email=admin_email,
            user_pwd=get_password_hash(admin_password),
            role_id=admin_role.role_id,
            created_by=SYSTEM_USER,
            modified_by=SYSTEM_USER
        )
        db.add(admin_user)
        db.commit()
        logger.info("Default portal_admin user created (email from config).")
    else:
        if settings.ENVIRONMENT == "development":
            existing_admin.user_pwd = get_password_hash(admin_password)
            db.commit()
            logger.info("Default admin password reset in development (credentials from config).")
        else:
            logger.debug("Admin user already exists.")


def init_assessment_checklist_template(db: Session) -> None:
    """Seed the first assessment checklist from the Responsible AI Impact Assessment template."""
    from app.models import AssessmentChecklistTemplate
    from app.services.assessment_checklist_service import create_template_from_scratch

    if db.query(AssessmentChecklistTemplate.template_id).first():
        logger.debug("Assessment checklist template already exists; skipping seed.")
        return

    seed_path = Path(__file__).resolve().parent.parent / "data" / "responsible_ai_impact_assessment_seed.json"
    if not seed_path.exists():
        logger.warning(f"Assessment checklist seed file not found: {seed_path}")
        return

    with seed_path.open(encoding="utf-8") as seed_file:
        seed_data = json.load(seed_file)

    admin_user = (
        db.query(User)
        .join(Role, User.role_id == Role.role_id)
        .filter(Role.role_name == "portal_admin")
        .first()
    )
    creator_id = admin_user.user_id if admin_user else None

    create_template_from_scratch(
        db,
        name=seed_data["name"],
        user_id=creator_id,
        areas_payload=seed_data["areas"],
        risk_classification_ranges=seed_data.get("risk_classification_ranges"),
    )
    db.commit()
    logger.info(
        "Seeded assessment checklist template '%s' with %s areas",
        seed_data["name"],
        len(seed_data.get("areas", [])),
    )


def init_default_data() -> None:
    """Initialize all default data."""
    from app.core.database import SessionLocal

    logger.info("Initializing default data...")
    db = SessionLocal()

    try:
        init_permissions(db)
        init_roles(db)
        init_system_config(db)
        init_admin_user(db)
        init_assessment_checklist_template(db)
        logger.info("Default data initialization completed!")
    except Exception as e:
        logger.error(f"Error initializing default data: {str(e)}", exc_info=True)
        db.rollback()
        raise
    finally:
        db.close()
