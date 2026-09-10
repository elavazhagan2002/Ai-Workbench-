"""
Settings and system management endpoints.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.ai_category_options import normalize_ai_category
from app.core.authorization import get_user_with_permissions, is_admin, require_permission
from app.core.database import get_db
from app.core.field_limits import (
    EXPECTED_BENEFITS_MAX_LENGTH,
    USE_CASE_DESCRIPTION_MAX_LENGTH,
)
from app.core.logging_config import logger
from app.core.security import get_password_hash
from app.middleware.auth_middleware import get_current_user_id
from app.models import (
    AnonymousIdea,
    AuditLog,
    BugReport,
    Domain,
    DomainAccess,
    OrganizationType,
    Permission,
    Role,
    RolePermission,
    SystemConfig,
    UseCase,
    UseCaseComment,
    UseCaseData,
    UseCaseReview,
    UseCaseRiskReview,
    UseCaseTag,
    User,
)
from app.services.llm import llm_gateway
from app.utils.notification_emails import notify_admins_new_use_case, send_welcome_email

router = APIRouter()

REGISTRATION_STATUS_PENDING = "pending"
REGISTRATION_STATUS_APPROVED = "approved"
REGISTRATION_STATUS_REJECTED = "rejected"


# Response models
class RoleResponse(BaseModel):
    role_id: str
    role_name: str
    role_description: str | None
    permissions: list[str] = []  # List of permission names

    class Config:
        from_attributes = True


class PermissionResponse(BaseModel):
    permission_id: str
    permission_name: str
    permission_type: str = "portal"

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    user_id: str
    user_name: str
    user_email: str
    role_id: str | None
    role_name: str | None
    organization: str | None = None
    organization_type: str | None = None
    user_image: str | None = None
    is_active: bool = True
    registration_status: str = REGISTRATION_STATUS_APPROVED
    interested_domain_id: str | None = None
    interested_domain_name: str | None = None

    class Config:
        from_attributes = True


class AssignedDomainResponse(BaseModel):
    domain_id: str
    domain_short_name: str
    domain_name: str
    domain_detail: str | None = None


class UserAssignedDomainsResponse(BaseModel):
    user_id: str
    user_name: str
    user_email: str
    interested_domain_id: str | None = None
    interested_domain_name: str | None = None
    assigned_domains: list[AssignedDomainResponse] = []
    total_domains: int


# Request models
class RoleCreate(BaseModel):
    role_name: str
    role_description: str | None = None
    permission_ids: list[str] = []


class RoleUpdate(BaseModel):
    role_name: str | None = None
    role_description: str | None = None
    permission_ids: list[str] | None = None


class UserCreate(BaseModel):
    user_name: str
    user_email: str
    user_pwd: str
    role_id: str | None = None
    organization: str | None = None
    organization_type: str | None = None
    user_image: str | None = None


class UserUpdate(BaseModel):
    user_name: str | None = None
    user_email: str | None = None
    user_pwd: str | None = None
    role_id: str | None = None
    organization: str | None = None
    organization_type: str | None = None
    user_image: str | None = None
    is_active: bool | None = None


class ApproveUsersRequest(BaseModel):
    """Request body for bulk approving pending registrations."""
    user_ids: list[str]


class RejectUsersRequest(BaseModel):
    """Request body for bulk rejecting pending registrations."""
    user_ids: list[str]


def _user_registration_status(user: User) -> str:
    return getattr(user, "registration_status", None) or REGISTRATION_STATUS_APPROVED


class OrganizationTypeResponse(BaseModel):
    org_type_id: str
    name: str
    description: str | None = None

    class Config:
        from_attributes = True


class OrganizationTypeCreate(BaseModel):
    name: str
    description: str | None = None


class OrganizationTypeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


@router.get("/organization-types", response_model=list[OrganizationTypeResponse])
async def get_organization_types(
    request: Request,
    db: Session = Depends(get_db),
):
    """List all organization types. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings",
    )
    types = db.query(OrganizationType).order_by(OrganizationType.name).all()
    return types


@router.post("/organization-types", response_model=OrganizationTypeResponse)
async def create_organization_type(
    org_type_data: OrganizationTypeCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    """Create a new organization type. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings",
    )

    existing = (
        db.query(OrganizationType)
        .filter(OrganizationType.name == org_type_data.name)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organization type name already exists",
        )

    org_type = OrganizationType(
        name=org_type_data.name,
        description=org_type_data.description,
        created_by=user_id,
        modified_by=user_id,
    )
    db.add(org_type)
    db.commit()
    db.refresh(org_type)
    return org_type


@router.put("/organization-types/{org_type_id}", response_model=OrganizationTypeResponse)
async def update_organization_type(
    org_type_id: str,
    org_type_data: OrganizationTypeUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    """Update an existing organization type. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings",
    )

    org_type = (
        db.query(OrganizationType)
        .filter(OrganizationType.org_type_id == org_type_id)
        .first()
    )
    if not org_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization type not found",
        )

    if org_type_data.name and org_type_data.name != org_type.name:
        # Ensure new name is unique
        exists = (
            db.query(OrganizationType)
            .filter(OrganizationType.name == org_type_data.name)
            .first()
        )
        if exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Organization type name already exists",
            )
        org_type.name = org_type_data.name

    if org_type_data.description is not None:
        org_type.description = org_type_data.description

    org_type.modified_by = user_id
    db.commit()
    db.refresh(org_type)
    return org_type


@router.delete("/organization-types/{org_type_id}")
async def delete_organization_type(
    org_type_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Delete an organization type. Blocks delete if any user currently references it."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings",
    )

    org_type = (
        db.query(OrganizationType)
        .filter(OrganizationType.org_type_id == org_type_id)
        .first()
    )
    if not org_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization type not found",
        )

    # If any user currently uses this organization_type, block deletion
    in_use = (
        db.query(User)
        .filter(User.organization_type == org_type.name)
        .first()
    )
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete organization type that is in use by one or more users",
        )

    db.delete(org_type)
    db.commit()
    return {"detail": "Organization type deleted"}

@router.get("/config")
async def get_system_config(
    request: Request,
    db: Session = Depends(get_db)
):
    """Get system configuration. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Fetching system config by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access system settings"
    )

    config = db.query(SystemConfig).first()
    if not config:
        logger.info("System config not found, creating default configuration")
        # Create default config if it doesn't exist
        from app.services.init_service import DEFAULT_CONFIG, SYSTEM_USER
        config = SystemConfig(
            config_data=DEFAULT_CONFIG,
            created_by=SYSTEM_USER,
            modified_by=SYSTEM_USER
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        logger.info("Created default system configuration")

    config_payload = dict(config.config_data or {})
    llm_payload = dict(config_payload.get("llm") or {})
    provider_debug = llm_gateway.get_provider_debug_info()
    llm_payload.update(
        {
            "provider": provider_debug.get("provider"),
            "provider_id": provider_debug.get("provider_id"),
            "model": provider_debug.get("model"),
            "base_url": provider_debug.get("base_url"),
            "enabled": provider_debug.get("enabled"),
            "config_source": "environment",
        }
    )
    config_payload["llm"] = llm_payload

    return {
        "config_id": config.config_id,
        "config_data": config_payload,
        "created_by": config.created_by,
        "created_dt": config.created_dt,
        "modified_by": config.modified_by,
        "modified_dt": config.modified_dt,
    }


@router.get("/roles", response_model=list[RoleResponse])
async def get_roles(
    request: Request,
    db: Session = Depends(get_db)
):
    """Get all roles. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Fetching roles by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    roles = db.query(Role).all()

    # Get permissions for each role
    result = []
    for role in roles:
        # Query role_permissions to get permission IDs for this role
        role_perms = db.query(RolePermission).filter(
            RolePermission.role_id == role.role_id
        ).all()
        perm_ids = [rp.permission_id for rp in role_perms]

        # Get permission names
        perms = db.query(Permission).filter(
            Permission.permission_id.in_(perm_ids)
        ).all()
        perm_names = [p.permission_name for p in perms]

        result.append(RoleResponse(
            role_id=role.role_id,
            role_name=role.role_name,
            role_description=role.role_description,
            permissions=perm_names
        ))

    return result


@router.post("/roles", response_model=RoleResponse)
async def create_role(
    role_data: RoleCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Create a new role. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Creating role: {role_data.role_name} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    # Check if role name already exists
    existing = db.query(Role).filter(Role.role_name == role_data.role_name).first()
    if existing:
        logger.warning(f"Role creation failed: Role name exists - {role_data.role_name}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role name already exists"
        )

    # Create role
    new_role = Role(
        role_name=role_data.role_name,
        role_description=role_data.role_description,
        created_by=user_id,
        modified_by=user_id
    )
    db.add(new_role)
    db.flush()  # Get role_id

    # Assign permissions
    perm_names = []
    if role_data.permission_ids:
        for perm_id in role_data.permission_ids:
            permission = db.query(Permission).filter(Permission.permission_id == perm_id).first()
            if permission:
                role_permission = RolePermission(
                    role_id=new_role.role_id,
                    permission_id=permission.permission_id,
                    created_by=user_id,
                    modified_by=user_id
                )
                db.add(role_permission)
                perm_names.append(permission.permission_name)

    db.commit()
    db.refresh(new_role)

    logger.info(f"Role created successfully: {new_role.role_id}")
    return RoleResponse(
        role_id=new_role.role_id,
        role_name=new_role.role_name,
        role_description=new_role.role_description,
        permissions=perm_names
    )


@router.put("/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: str,
    role_data: RoleUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Update a role. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Updating role: {role_id} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    # Get role
    role = db.query(Role).filter(Role.role_id == role_id).first()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )

    # Check if role name is being changed and if new name already exists
    if role_data.role_name and role_data.role_name != role.role_name:
        existing = db.query(Role).filter(Role.role_name == role_data.role_name).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Role name already exists"
            )
        role.role_name = role_data.role_name

    # Update role description if provided
    if role_data.role_description is not None:
        role.role_description = role_data.role_description

    role.modified_by = user_id

    # Update permissions if provided
    perm_names = []
    if role_data.permission_ids is not None:
        # Remove existing permissions
        db.query(RolePermission).filter(RolePermission.role_id == role_id).delete()

        # Add new permissions
        for perm_id in role_data.permission_ids:
            permission = db.query(Permission).filter(Permission.permission_id == perm_id).first()
            if permission:
                role_permission = RolePermission(
                    role_id=role_id,
                    permission_id=permission.permission_id,
                    created_by=user_id,
                    modified_by=user_id
                )
                db.add(role_permission)
                perm_names.append(permission.permission_name)
    else:
        # Keep existing permissions, just get their names
        role_perms = db.query(RolePermission).filter(
            RolePermission.role_id == role_id
        ).all()
        perm_ids = [rp.permission_id for rp in role_perms]
        perms = db.query(Permission).filter(
            Permission.permission_id.in_(perm_ids)
        ).all()
        perm_names = [p.permission_name for p in perms]

    db.commit()
    db.refresh(role)

    logger.info(f"Role updated successfully: {role_id}")
    return RoleResponse(
        role_id=role.role_id,
        role_name=role.role_name,
        role_description=role.role_description,
        permissions=perm_names
    )


@router.delete("/roles/{role_id}")
async def delete_role(
    role_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Delete a role. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Deleting role: {role_id} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    # Get role
    role = db.query(Role).filter(Role.role_id == role_id).first()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )

    # Check if any users are using this role
    users_with_role = db.query(User).filter(User.role_id == role_id).count()
    if users_with_role > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete role. {users_with_role} user(s) are assigned to this role."
        )

    # Delete role (permissions will be deleted via CASCADE)
    db.delete(role)
    db.commit()

    logger.info(f"Role deleted successfully: {role_id}")
    return {"message": "Role deleted successfully"}


@router.get("/permissions", response_model=list[PermissionResponse])
async def get_permissions(
    request: Request,
    db: Session = Depends(get_db)
):
    """Get all permissions. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Fetching permissions by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    permissions_list = db.query(Permission).all()
    return permissions_list


class UsersListResponse(BaseModel):
    """Paginated users list."""
    users: list[UserResponse]
    total: int


@router.get("/users", response_model=UsersListResponse)
async def get_users(
    request: Request,
    db: Session = Depends(get_db),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    """Get users with pagination (default 10 per page). Requires settings_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Fetching users by user: {user_id} (limit={limit}, offset={offset})")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    total = db.query(User).count()
    users = db.query(User).order_by(User.user_name).offset(offset).limit(limit).all()
    result = []
    for u in users:
        role_name = None
        if u.role_id and u.role:
            role_name = u.role.role_name
        interested_domain_id = getattr(u, "interested_domain_id", None)
        interested_domain_name = None
        if interested_domain_id:
            d = db.query(Domain).filter(Domain.domain_id == interested_domain_id).first()
            interested_domain_name = d.domain_name if d else None
        result.append(
            UserResponse(
                user_id=u.user_id,
                user_name=u.user_name,
                user_email=u.user_email,
                role_id=u.role_id,
                role_name=role_name,
                organization=getattr(u, "organization", None),
                organization_type=getattr(u, "organization_type", None),
                user_image=u.user_image,
                is_active=getattr(u, "is_active", True),
                registration_status=_user_registration_status(u),
                interested_domain_id=interested_domain_id,
                interested_domain_name=interested_domain_name,
            )
        )
    return UsersListResponse(users=result, total=total)


@router.get("/users/all", response_model=list[UserResponse])
async def get_all_users(
    request: Request,
    db: Session = Depends(get_db)
):
    """Get all users (no pagination). For dropdowns. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )
    users = db.query(User).order_by(User.user_name).all()
    result = []
    for u in users:
        role_name = None
        if u.role_id and u.role:
            role_name = u.role.role_name
        interested_domain_id = getattr(u, "interested_domain_id", None)
        interested_domain_name = None
        if interested_domain_id:
            d = db.query(Domain).filter(Domain.domain_id == interested_domain_id).first()
            interested_domain_name = d.domain_name if d else None
        result.append(
            UserResponse(
                user_id=u.user_id,
                user_name=u.user_name,
                user_email=u.user_email,
                role_id=u.role_id,
                role_name=role_name,
                organization=getattr(u, "organization", None),
                organization_type=getattr(u, "organization_type", None),
                user_image=u.user_image,
                is_active=getattr(u, "is_active", True),
                registration_status=_user_registration_status(u),
                interested_domain_id=interested_domain_id,
                interested_domain_name=interested_domain_name,
            )
        )
    return result

@router.get("/users/pending", response_model=list[UserResponse])
async def get_pending_users(
    request: Request,
    db: Session = Depends(get_db)
):
    """Get all users pending approval. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )
    users = db.query(User).filter(
        User.is_active.is_(False),
        User.registration_status == REGISTRATION_STATUS_PENDING,
    ).order_by(User.created_dt.desc()).all()
    result = []
    for u in users:
        role_name = None
        if u.role_id and u.role:
            role_name = u.role.role_name
        interested_domain_name = None
        interested_domain_id = getattr(u, "interested_domain_id", None)
        if interested_domain_id:
            d = db.query(Domain).filter(Domain.domain_id == interested_domain_id).first()
            interested_domain_name = d.domain_name if d else None
        result.append(
            UserResponse(
                user_id=u.user_id,
                user_name=u.user_name,
                user_email=u.user_email,
                role_id=u.role_id,
                role_name=role_name,
                organization=getattr(u, "organization", None),
                organization_type=getattr(u, "organization_type", None),
                user_image=u.user_image,
                is_active=getattr(u, "is_active", True),
                registration_status=_user_registration_status(u),
                interested_domain_id=interested_domain_id,
                interested_domain_name=interested_domain_name,
            )
        )
    return result


@router.get("/users/{user_id}/domains", response_model=UserAssignedDomainsResponse)
async def get_user_assigned_domains(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get all domains assigned to a specific user. Requires settings_access permission."""
    current_user_id = get_current_user_id(request)
    logger.info(f"Fetching assigned domains for user {user_id} by user: {current_user_id}")

    user, _, _ = get_user_with_permissions(db, current_user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    target_user = db.query(User).filter(User.user_id == user_id).first()
    if not target_user:
        logger.warning(f"Assigned domains fetch failed: User not found - {user_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    interested_domain_id = getattr(target_user, "interested_domain_id", None)
    interested_domain_name = None
    if interested_domain_id:
        interested_domain = db.query(Domain).filter(Domain.domain_id == interested_domain_id).first()
        interested_domain_name = interested_domain.domain_name if interested_domain else None

    assigned_domains = db.query(Domain).join(
        DomainAccess,
        DomainAccess.domain_id == Domain.domain_id
    ).filter(
        DomainAccess.user_id == user_id
    ).order_by(
        Domain.domain_name.asc()
    ).all()

    domain_responses = [
        AssignedDomainResponse(
            domain_id=domain.domain_id,
            domain_short_name=domain.domain_short_name,
            domain_name=domain.domain_name,
            domain_detail=domain.domain_detail,
        )
        for domain in assigned_domains
    ]

    logger.info(f"Found {len(domain_responses)} assigned domain(s) for user {user_id}")
    return UserAssignedDomainsResponse(
        user_id=target_user.user_id,
        user_name=target_user.user_name,
        user_email=target_user.user_email,
        interested_domain_id=interested_domain_id,
        interested_domain_name=interested_domain_name,
        assigned_domains=domain_responses,
        total_domains=len(domain_responses),
    )


@router.post("/users/approve")
async def approve_users(
    body: ApproveUsersRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Set is_active=True for the given user IDs (bulk approve pending registrations). Requires settings_access."""
    current_user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, current_user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )
    approved = 0
    approved_users: list[User] = []
    for uid in body.user_ids:
        if not uid:
            continue
        u = db.query(User).filter(User.user_id == uid).first()
        if not u:
            continue
        if getattr(u, "is_active", True) is True or _user_registration_status(u) != REGISTRATION_STATUS_PENDING:
            continue
        u.is_active = True
        u.registration_status = REGISTRATION_STATUS_APPROVED
        u.modified_by = current_user_id
        approved += 1
        approved_users.append(u)
        # Auto-assign user to their interested domain (from registration)
        interested_domain_id = getattr(u, "interested_domain_id", None)
        if interested_domain_id:
            domain = db.query(Domain).filter(Domain.domain_id == interested_domain_id).first()
            if domain:
                existing = db.query(DomainAccess).filter(
                    DomainAccess.domain_id == interested_domain_id,
                    DomainAccess.user_id == u.user_id,
                ).first()
                if not existing:
                    da = DomainAccess(
                        domain_id=interested_domain_id,
                        user_id=u.user_id,
                        created_by=current_user_id,
                        modified_by=current_user_id,
                    )
                    db.add(da)
                    logger.info(f"Auto-assigned user {u.user_id} to domain {interested_domain_id} on approval")
    db.commit()
    for approved_user in approved_users:
        send_welcome_email(approved_user, background_tasks=background_tasks)
    logger.info(f"User {current_user_id} approved {approved} registration(s)")
    return {"approved": approved, "message": f"Approved {approved} user(s)."}


@router.post("/users/reject")
async def reject_users(
    body: RejectUsersRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Mark pending registrations as rejected. Requires settings_access."""
    current_user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, current_user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )
    rejected = 0
    rejected_user_ids: list[str] = []
    for uid in body.user_ids:
        if not uid:
            continue
        u = db.query(User).filter(User.user_id == uid).first()
        if not u:
            continue
        if getattr(u, "is_active", True) is True or _user_registration_status(u) != REGISTRATION_STATUS_PENDING:
            continue
        u.is_active = False
        u.registration_status = REGISTRATION_STATUS_REJECTED
        u.modified_by = current_user_id
        rejected += 1
        rejected_user_ids.append(u.user_id)

    if rejected:
        audit_log = AuditLog(
            type="user",
            action="reject_registration",
            user_id=current_user_id,
            details={"user_ids": rejected_user_ids, "count": rejected}
        )
        db.add(audit_log)

    db.commit()
    logger.info(f"User {current_user_id} rejected {rejected} registration(s)")
    return {"rejected": rejected, "message": f"Rejected {rejected} user request(s)."}


@router.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Create a new user. Requires settings_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Creating user: {user_data.user_email} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    # Check if email already exists
    existing = db.query(User).filter(User.user_email == user_data.user_email).first()
    if existing:
        logger.warning(f"User creation failed: Email exists - {user_data.user_email}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already exists"
        )

    # Check if user name already exists
    existing_name = db.query(User).filter(User.user_name == user_data.user_name.strip()).first()
    if existing_name:
        logger.warning(f"User creation failed: User name exists - {user_data.user_name}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User name already exists"
        )

    # Validate role if provided
    role_name = None
    if user_data.role_id:
        role = db.query(Role).filter(Role.role_id == user_data.role_id).first()
        if not role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid role ID"
            )
        role_name = role.role_name

    # Hash password
    hashed_password = get_password_hash(user_data.user_pwd)

    # Create user
    new_user = User(
        user_name=user_data.user_name,
        user_email=user_data.user_email,
        user_pwd=hashed_password,
        role_id=user_data.role_id,
        organization=user_data.organization,
        organization_type=user_data.organization_type,
        user_image=user_data.user_image,
        registration_status=REGISTRATION_STATUS_APPROVED,
        created_by=user_id,
        modified_by=user_id,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Create audit log
    audit_log = AuditLog(
        type="user",
        action="create",
        user_id=user_id,
        details={"user_id": new_user.user_id, "user_email": new_user.user_email}
    )
    db.add(audit_log)
    db.commit()

    logger.info(f"User created successfully: {new_user.user_id}")
    return UserResponse(
        user_id=new_user.user_id,
        user_name=new_user.user_name,
        user_email=new_user.user_email,
        role_id=new_user.role_id,
        role_name=role_name,
        organization=getattr(new_user, "organization", None),
        organization_type=getattr(new_user, "organization_type", None),
        user_image=new_user.user_image,
        is_active=getattr(new_user, "is_active", True),
        registration_status=_user_registration_status(new_user),
    )


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    user_data: UserUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Update a user. Requires settings_access permission."""
    current_user_id = get_current_user_id(request)
    logger.info(f"Updating user: {user_id} by user: {current_user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, current_user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings"
    )

    # Get user to update
    user_to_update = db.query(User).filter(User.user_id == user_id).first()
    if not user_to_update:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if email is being changed and if new email already exists
    if user_data.user_email and user_data.user_email != user_to_update.user_email:
        existing = db.query(User).filter(User.user_email == user_data.user_email).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already exists"
            )
        user_to_update.user_email = user_data.user_email

    # Check if user name is being changed and if new name already exists
    if user_data.user_name is not None and user_data.user_name.strip() != user_to_update.user_name:
        existing_name = db.query(User).filter(User.user_name == user_data.user_name.strip()).first()
        if existing_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User name already exists"
            )

    # Update user name if provided
    if user_data.user_name is not None:
        user_to_update.user_name = user_data.user_name.strip()

    # Update password if provided
    if user_data.user_pwd:
        user_to_update.user_pwd = get_password_hash(user_data.user_pwd)

    # Update role if provided
    role_name = None
    if user_data.role_id is not None:
        if user_data.role_id:
            role = db.query(Role).filter(Role.role_id == user_data.role_id).first()
            if not role:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid role ID"
                )
            role_name = role.role_name
            user_to_update.role_id = user_data.role_id
        else:
            user_to_update.role_id = None
    else:
        # Keep existing role, get role name
        if user_to_update.role_id and user_to_update.role:
            role_name = user_to_update.role.role_name

    if user_data.organization is not None:
        user_to_update.organization = user_data.organization
    if user_data.organization_type is not None:
        user_to_update.organization_type = user_data.organization_type
    if user_data.user_image is not None:
        user_to_update.user_image = user_data.user_image
    if user_data.is_active is not None:
        if user_id == current_user_id and user_data.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate your own account"
            )
        user_to_update.is_active = user_data.is_active
        if user_data.is_active is True:
            user_to_update.registration_status = REGISTRATION_STATUS_APPROVED

    user_to_update.modified_by = current_user_id

    db.commit()
    db.refresh(user_to_update)

    # Create audit log
    audit_log = AuditLog(
        type="user",
        action="update",
        user_id=current_user_id,
        details={"user_id": user_id, "user_email": user_to_update.user_email}
    )
    db.add(audit_log)
    db.commit()

    logger.info(f"User updated successfully: {user_id}")
    return UserResponse(
        user_id=user_to_update.user_id,
        user_name=user_to_update.user_name,
        user_email=user_to_update.user_email,
        role_id=user_to_update.role_id,
        role_name=role_name,
        organization=getattr(user_to_update, "organization", None),
        organization_type=getattr(user_to_update, "organization_type", None),
        user_image=user_to_update.user_image,
        is_active=getattr(user_to_update, "is_active", True),
        registration_status=_user_registration_status(user_to_update),
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Delete a user permanently. Administrator only. Cannot delete self. Cannot delete users who have use case comments (deactivate instead)."""
    current_user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, current_user_id)
    if not is_admin(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can delete users"
        )
    if user_id == current_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account"
        )
    user_to_delete = db.query(User).filter(User.user_id == user_id).first()
    if not user_to_delete:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    is_rejected_registration = _user_registration_status(user_to_delete) == REGISTRATION_STATUS_REJECTED
    # Block delete if user has use case comments, except rejected registration requests
    comment_count = db.query(UseCaseComment).filter(UseCaseComment.comment_by == user_id).count()
    if comment_count and not is_rejected_registration:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete user who has commented on use cases. Deactivate the user instead."
        )
    if comment_count and is_rejected_registration:
        db.query(UseCaseComment).filter(UseCaseComment.comment_by == user_id).delete()
    # Null out references then delete user
    db.query(Domain).filter(Domain.owner_id == user_id).update({Domain.owner_id: None})
    db.query(Domain).filter(Domain.created_by == user_id).update({Domain.created_by: None})
    db.query(Domain).filter(Domain.modified_by == user_id).update({Domain.modified_by: None})
    db.query(DomainAccess).filter(DomainAccess.user_id == user_id).delete()
    db.query(DomainAccess).filter(DomainAccess.created_by == user_id).update({DomainAccess.created_by: None})
    db.query(DomainAccess).filter(DomainAccess.modified_by == user_id).update({DomainAccess.modified_by: None})
    db.query(UseCase).filter(UseCase.created_by == user_id).update({UseCase.created_by: None})
    db.query(UseCase).filter(UseCase.modified_by == user_id).update({UseCase.modified_by: None})
    db.query(UseCase).filter(UseCase.technical_owner == user_id).update({UseCase.technical_owner: None})
    db.query(UseCase).filter(UseCase.business_owner == user_id).update({UseCase.business_owner: None})
    db.query(UseCaseTag).filter(UseCaseTag.created_by == user_id).update({UseCaseTag.created_by: None})
    db.query(UseCaseData).filter(UseCaseData.created_by == user_id).update({UseCaseData.created_by: None})
    db.query(UseCaseRiskReview).filter(UseCaseRiskReview.created_by == user_id).update({UseCaseRiskReview.created_by: None})
    db.query(UseCaseRiskReview).filter(UseCaseRiskReview.assigned_to == user_id).update({UseCaseRiskReview.assigned_to: None})
    db.query(UseCaseReview).filter(UseCaseReview.created_by == user_id).update({UseCaseReview.created_by: None})
    db.query(AuditLog).filter(AuditLog.user_id == user_id).update({AuditLog.user_id: None})
    db.query(User).filter(User.created_by == user_id).update({User.created_by: None})
    db.query(User).filter(User.modified_by == user_id).update({User.modified_by: None})
    db.query(SystemConfig).filter(SystemConfig.created_by == user_id).update({SystemConfig.created_by: None})
    db.query(SystemConfig).filter(SystemConfig.modified_by == user_id).update({SystemConfig.modified_by: None})
    db.delete(user_to_delete)
    db.commit()
    audit_log = AuditLog(
        type="user",
        action="delete",
        user_id=current_user_id,
        details={"deleted_user_id": user_id, "deleted_user_email": user_to_delete.user_email}
    )
    db.add(audit_log)
    db.commit()
    logger.info(f"User deleted: {user_id} by admin: {current_user_id}")
    return {"status": "deleted", "user_id": user_id}


# ---------- Anonymous Ideas (list + qualify) ----------
class AnonymousIdeaResponse(BaseModel):
    idea_id: str
    domain_id: str | None
    domain_name: str | None = None
    idea_text: str
    submitted_by_name: str | None = None
    submitted_by_email: str | None = None
    submitted_by_organization: str | None = None
    status: str
    qualified_use_case_id: str | None = None
    created_dt: str

    class Config:
        from_attributes = True


class QualifyIdeaRequest(BaseModel):
    """Mandatory fields to create a use case from an idea."""
    target_domain_id: str
    use_case_name: str  # max 30
    use_case_title: str | None = None  # max 100
    use_case_description: str | None = None  # max 1500
    expected_benefits: str | None = None  # max 1000
    department: str | None = None
    ai_category: str | None = None  # P, G, A, S
    feasibility: str | None = None
    intended_audience: str | None = None
    tags: list[str] | None = None


@router.get("/anonymous-ideas", response_model=list[AnonymousIdeaResponse])
async def get_anonymous_ideas(
    request: Request,
    db: Session = Depends(get_db),
    status_filter: str | None = Query(None, description="Filter by status: new, qualified"),
):
    """List anonymous ideas. Requires settings_access."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings",
    )
    q = db.query(AnonymousIdea).order_by(AnonymousIdea.created_dt.desc())
    if status_filter in ("new", "qualified"):
        q = q.filter(AnonymousIdea.status == status_filter)
    ideas = q.all()
    out = []
    for idea in ideas:
        domain_name = None
        if idea.domain_id:
            d = db.query(Domain).filter(Domain.domain_id == idea.domain_id).first()
            domain_name = d.domain_name if d else None
        out.append(AnonymousIdeaResponse(
            idea_id=idea.idea_id,
            domain_id=idea.domain_id,
            domain_name=domain_name,
            idea_text=idea.idea_text,
            submitted_by_name=idea.submitted_by_name,
            submitted_by_email=getattr(idea, "submitted_by_email", None),
            submitted_by_organization=idea.submitted_by_organization,
            status=idea.status,
            qualified_use_case_id=idea.qualified_use_case_id,
            created_dt=idea.created_dt.isoformat() if idea.created_dt else "",
        ))
    return out


@router.post("/anonymous-ideas/{idea_id}/qualify")
async def qualify_anonymous_idea(
    idea_id: str,
    body: QualifyIdeaRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Create a use case from an anonymous idea in the selected domain. Requires settings_access and domain access."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to access settings",
    )
    idea = db.query(AnonymousIdea).filter(AnonymousIdea.idea_id == idea_id).first()
    if not idea:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Idea not found")
    if idea.status == "qualified":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This idea has already been qualified.",
        )
    domain = db.query(Domain).filter(Domain.domain_id == body.target_domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target domain not found")
    if not is_user_admin:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == body.target_domain_id,
            DomainAccess.user_id == user_id,
        ).first()
        is_owner = domain.owner_id == user_id
        if not access and not is_owner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to the target domain",
            )
    name = (body.use_case_name or "").strip()[:30]
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use case name is required (max 30 characters)")
    normalized_ai_category = normalize_ai_category(body.ai_category)
    if body.ai_category and normalized_ai_category is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid AI category")
    if body.feasibility and body.feasibility not in ("Yes", "No", "Yes (Difficult)"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid feasibility")
    title = (body.use_case_title or "")[:100] if body.use_case_title else None
    desc = (body.use_case_description or "")[:USE_CASE_DESCRIPTION_MAX_LENGTH] if body.use_case_description else None
    benefits = (body.expected_benefits or "")[:EXPECTED_BENEFITS_MAX_LENGTH] if body.expected_benefits else None
    dept = (body.department or "")[:30] if body.department else None
    audience = (body.intended_audience or "")[:200] if body.intended_audience else None
    use_case = UseCase(
        domain_id=body.target_domain_id,
        use_case_name=name,
        use_case_title=title,
        use_case_description=desc,
        expected_benefits=benefits,
        department=dept,
        ai_category=normalized_ai_category,
        feasibility=body.feasibility or None,
        intended_audience=audience,
        status="New",
        created_by=user_id,
        modified_by=user_id,
    )
    db.add(use_case)
    db.commit()
    db.refresh(use_case)
    for tag_name in (body.tags or []):
        if tag_name and str(tag_name).strip():
            tag = UseCaseTag(
                use_case_id=use_case.use_case_id,
                tag_name=str(tag_name).strip()[:50],
                created_by=user_id,
            )
            db.add(tag)
    idea.status = "qualified"
    idea.qualified_use_case_id = use_case.use_case_id
    db.commit()
    db.refresh(idea)
    audit_log = AuditLog(
        type="use_case",
        action="create",
        user_id=user_id,
        details={"use_case_id": use_case.use_case_id, "from_idea_id": idea_id, "domain_id": body.target_domain_id},
    )
    db.add(audit_log)
    db.commit()
    logger.info(f"Idea {idea_id} qualified as use case {use_case.use_case_id}")
    notify_admins_new_use_case(db, use_case, domain, user, background_tasks=background_tasks)
    return {
        "message": "Idea qualified and use case created.",
        "use_case_id": use_case.use_case_id,
        "domain_id": use_case.domain_id,
    }


# ---------- Bug reports / Feature requests (submit: any user; list: admin) ----------
class FeedbackSubmitRequest(BaseModel):
    report_type: str  # 'bug' | 'feature'
    comments: str | None = None
    screenshot: str | None = None  # base64 data URL (e.g. data:image/png;base64,...)


class FeedbackResponse(BaseModel):
    report_id: str
    report_type: str
    comments: str | None = None
    submitted_dt: str
    submitted_by: str | None = None
    submitted_by_name: str | None = None
    submitted_by_email: str | None = None
    screenshot: str | None = None  # base64 data URL for admin view
    release_number: str | None = None


class FeedbackReleaseUpdate(BaseModel):
    release_number: str | None = None  # empty string or null to clear


@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(
    body: FeedbackSubmitRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Submit a bug report or feature request. Any authenticated user. Optional screenshot (base64 data URL)."""
    user_id = get_current_user_id(request)
    if body.report_type not in ("bug", "feature"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="report_type must be 'bug' or 'feature'",
        )
    comments = (body.comments or "").strip() or None
    screenshot = (body.screenshot or "").strip() or None
    if screenshot and len(screenshot) > 10_000_000:  # ~7.5MB base64
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Screenshot too large",
        )
    report = BugReport(
        report_type=body.report_type,
        comments=comments,
        submitted_by=user_id,
        screenshot=screenshot,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    submitter = db.query(User).filter(User.user_id == user_id).first()
    logger.info(f"Feedback submitted: {report.report_id} type={report.report_type} by {user_id}")
    return FeedbackResponse(
        report_id=report.report_id,
        report_type=report.report_type,
        comments=report.comments,
        submitted_dt=report.submitted_dt.isoformat() if report.submitted_dt else "",
        submitted_by=report.submitted_by,
        submitted_by_name=submitter.user_name if submitter else None,
        submitted_by_email=submitter.user_email if submitter else None,
        screenshot=report.screenshot,
        release_number=getattr(report, "release_number", None),
    )


@router.get("/feedback/release-numbers", response_model=list[str])
async def list_feedback_release_numbers(
    request: Request,
    db: Session = Depends(get_db),
):
    """List distinct release numbers assigned to feedback (for filter dropdown). Requires settings_access."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to view feedback",
    )
    rows = db.query(BugReport.release_number).filter(
        BugReport.release_number.isnot(None),
        BugReport.release_number != "",
    ).distinct().order_by(BugReport.release_number).all()
    return [r[0] for r in rows if r[0]]


@router.get("/feedback", response_model=list[FeedbackResponse])
async def list_feedback(
    request: Request,
    db: Session = Depends(get_db),
    release_filter: str | None = Query("unassigned", description="unassigned | all | or a specific release number"),
):
    """List bug reports and feature requests. Requires settings_access. Default: only items without release assignment."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to view feedback",
    )
    query = db.query(BugReport).order_by(BugReport.submitted_dt.desc())
    if release_filter == "unassigned" or release_filter is None or release_filter == "":
        query = query.filter(
            (BugReport.release_number.is_(None)) | (BugReport.release_number == ""),
        )
    elif release_filter != "all":
        query = query.filter(BugReport.release_number == release_filter)
    reports = query.all()
    out = []
    for r in reports:
        submitter = db.query(User).filter(User.user_id == r.submitted_by).first() if r.submitted_by else None
        out.append(FeedbackResponse(
            report_id=r.report_id,
            report_type=r.report_type,
            comments=r.comments,
            submitted_dt=r.submitted_dt.isoformat() if r.submitted_dt else "",
            submitted_by=r.submitted_by,
            submitted_by_name=submitter.user_name if submitter else None,
            submitted_by_email=submitter.user_email if submitter else None,
            screenshot=r.screenshot,
            release_number=getattr(r, "release_number", None),
        ))
    return out


@router.patch("/feedback/{report_id}", response_model=FeedbackResponse)
async def update_feedback_release(
    report_id: str,
    body: FeedbackReleaseUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    """Update release number for a bug report/feature request. Requires settings_access."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "settings_access",
        allow_admin=True,
        error_message="You do not have permission to update feedback",
    )
    report = db.query(BugReport).filter(BugReport.report_id == report_id).first()
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    release_number = (body.release_number or "").strip() or None
    report.release_number = release_number
    db.commit()
    db.refresh(report)
    submitter = db.query(User).filter(User.user_id == report.submitted_by).first() if report.submitted_by else None
    return FeedbackResponse(
        report_id=report.report_id,
        report_type=report.report_type,
        comments=report.comments,
        submitted_dt=report.submitted_dt.isoformat() if report.submitted_dt else "",
        submitted_by=report.submitted_by,
        submitted_by_name=submitter.user_name if submitter else None,
        submitted_by_email=submitter.user_email if submitter else None,
        screenshot=report.screenshot,
        release_number=report.release_number,
    )
