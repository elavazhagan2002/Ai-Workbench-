"""
Domain management endpoints.
"""
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_serializer
from sqlalchemy.orm import Session

from app.core.authorization import DOMAIN_ACCESS_DENIED_DETAIL, get_user_permissions, get_user_with_permissions, is_admin, require_permission
from app.core.database import get_db
from app.core.logging_config import logger
from app.middleware.auth_middleware import get_current_user_id
from app.models import AuditLog, Domain, DomainAccess, Permission, Role, RolePermission, UseCase, User
from app.utils.notification_emails import (
    notify_admins_new_domain,
    notify_domain_access_granted,
    notify_domain_access_removed,
    notify_domain_owner_changed,
)

router = APIRouter()


class DomainCreate(BaseModel):
    domain_short_name: str
    domain_name: str
    domain_detail: str | None = None
    owner_id: str | None = None  # Optional; defaults to creator if not provided or invalid


class DomainUpdate(BaseModel):
    domain_short_name: str | None = None
    domain_name: str | None = None
    domain_detail: str | None = None
    owner_id: str | None = None


class DomainResponse(BaseModel):
    domain_id: str
    domain_short_name: str
    domain_name: str
    domain_detail: str | None
    owner_id: str | None
    created_by: str | None
    created_dt: datetime
    modified_by: str | None
    modified_dt: datetime

    @field_serializer('created_dt', 'modified_dt')
    def serialize_datetime(self, value: datetime) -> str:
        """Convert datetime objects to ISO format strings."""
        return value.isoformat()

    class Config:
        from_attributes = True


class DomainOwnerUpdate(BaseModel):
    """Request model for updating domain owner."""
    owner_id: str


@router.get("/", response_model=list[DomainResponse])
async def get_domains(
    request: Request,
    db: Session = Depends(get_db)
):
    """Get all domains user has access to. Requires domain_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Fetching domains for user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "domain_access",
        allow_admin=True,
        error_message="You do not have permission to access domains"
    )

    # Get domains user has access to (or all if admin)
    if is_user_admin:
        # Admin can see all domains
        domains = db.query(Domain).order_by(Domain.created_dt.desc()).all()
    else:
        # Regular users see only domains they have access to
        domain_accesses = db.query(DomainAccess).filter(
            DomainAccess.user_id == user_id
        ).all()
        domain_ids = [da.domain_id for da in domain_accesses]
        # Also include domains owned by user
        owned_domains = db.query(Domain).filter(Domain.owner_id == user_id).all()
        owned_domain_ids = [d.domain_id for d in owned_domains]
        all_domain_ids = list(set(domain_ids + owned_domain_ids))

        domains = db.query(Domain).filter(
            Domain.domain_id.in_(all_domain_ids)
        ).order_by(Domain.created_dt.desc()).all()

    logger.debug(f"Found {len(domains)} domains for user: {user_id}")
    return domains


def _get_users_with_permission(db: Session, permission_name: str) -> list:
    """Return users whose role has the given permission (or portal_admin)."""
    perm = db.query(Permission).filter(Permission.permission_name == permission_name).first()
    if not perm:
        return []
    role_ids = [r[0] for r in db.query(RolePermission.role_id).filter(
        RolePermission.permission_id == perm.permission_id
    ).all()]
    admin_role = db.query(Role).filter(Role.role_name == "portal_admin").first()
    if not admin_role:
        admin_role = db.query(Role).filter(Role.role_name == "Admin").first()
    if admin_role and admin_role.role_id not in role_ids:
        role_ids.append(admin_role.role_id)
    users = db.query(User).filter(User.role_id.in_(role_ids)).all()
    # Only return active users (deactivated users cannot be assigned as owner or to domain access)
    return [u for u in users if getattr(u, "is_active", True)]


@router.get("/eligible-owners")
async def get_eligible_domain_owners(
    request: Request,
    db: Session = Depends(get_db)
):
    """Get users who have domain_owner permission (for owner dropdown). Requires domain_access."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "domain_access",
        allow_admin=True,
        error_message="You do not have permission to access domains"
    )
    users = _get_users_with_permission(db, "domain_owner")
    return [
        {"user_id": u.user_id, "user_name": u.user_name, "user_email": u.user_email}
        for u in users
    ]


@router.get("/eligible-access-users")
async def get_eligible_domain_access_users(
    request: Request,
    db: Session = Depends(get_db)
):
    """Get users who have domain_access permission (for assigning to domain). Requires domain_access."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db, user, "domain_access",
        allow_admin=True,
        error_message="You do not have permission to access domains"
    )
    users = _get_users_with_permission(db, "domain_access")
    return [
        {"user_id": u.user_id, "user_name": u.user_name, "user_email": u.user_email}
        for u in users
    ]


@router.post("/", response_model=DomainResponse)
async def create_domain(
    domain: DomainCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Create a new domain. Requires create_domain permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Creating domain: {domain.domain_short_name} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass is enabled by default)
    require_permission(
        db, user, "create_domain",
        allow_admin=True,
        error_message="You do not have permission to create domains"
    )

    # Check if short name exists
    existing = db.query(Domain).filter(
        Domain.domain_short_name == domain.domain_short_name
    ).first()
    if existing:
        logger.warning(f"Domain creation failed: Short name exists - {domain.domain_short_name}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Domain short name already exists"
        )

    # Check if domain name exists
    existing_name = db.query(Domain).filter(Domain.domain_name == domain.domain_name.strip()).first()
    if existing_name:
        logger.warning(f"Domain creation failed: Domain name exists - {domain.domain_name}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Domain name already exists"
        )

    # Owner: use provided owner_id if valid (has domain_owner permission), else creator
    owner_id = user_id
    if domain.owner_id:
        new_owner = db.query(User).filter(User.user_id == domain.owner_id).first()
        if new_owner:
            new_owner_perms = get_user_permissions(db, new_owner)
            if "domain_owner" in new_owner_perms or is_admin(db, new_owner):
                owner_id = domain.owner_id
            # else keep creator as owner

    new_domain = Domain(
        domain_short_name=domain.domain_short_name,
        domain_name=domain.domain_name,
        domain_detail=domain.domain_detail,
        owner_id=owner_id,
        created_by=user_id,
        modified_by=user_id
    )
    db.add(new_domain)
    db.flush()

    # Grant access to creator
    domain_access = DomainAccess(
        domain_id=new_domain.domain_id,
        user_id=user_id,
        created_by=user_id,
        modified_by=user_id
    )
    db.add(domain_access)

    # Create audit log
    audit_log = AuditLog(
        type="domain",
        action="create",
        user_id=user_id,
        details={"domain_id": new_domain.domain_id, **domain.model_dump()}
    )
    db.add(audit_log)
    db.commit()
    db.refresh(new_domain)

    logger.info(f"Domain created successfully: {new_domain.domain_id}")
    notify_admins_new_domain(db, new_domain, user, background_tasks=background_tasks)
    return new_domain


@router.put("/{domain_id}", response_model=DomainResponse)
async def update_domain(
    domain_id: str,
    domain: DomainUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Update a domain. Requires edit_domain permission or domain owner."""
    user_id = get_current_user_id(request)
    logger.info(f"Updating domain: {domain_id} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Get domain
    db_domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not db_domain:
        logger.warning(f"Domain update failed: Domain not found - {domain_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )

    # Check permission (allow admin and owner)
    is_owner = db_domain.owner_id == user_id
    require_permission(
        db, user, "edit_domain",
        resource_owner_id=db_domain.owner_id if is_owner else None,
        allow_admin=True,
        error_message="You do not have permission to update this domain"
    )

    # Check domain access (unless admin or owner)
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            logger.warning(f"Domain update failed: No access - domain: {domain_id}, user: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=DOMAIN_ACCESS_DENIED_DETAIL
            )

    # Check if domain name is being changed and already exists on another domain
    if domain.domain_name is not None and domain.domain_name.strip() != db_domain.domain_name:
        existing_name = db.query(Domain).filter(
            Domain.domain_name == domain.domain_name.strip(),
            Domain.domain_id != domain_id
        ).first()
        if existing_name:
            logger.warning(f"Domain update failed: Domain name exists - {domain.domain_name}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Domain name already exists"
            )

    update_data = domain.model_dump(exclude_unset=True)
    owner_id_new = update_data.pop("owner_id", None)
    update_data["modified_by"] = user_id

    for key, value in update_data.items():
        setattr(db_domain, key, value)

    # If owner_id is being updated, validate new owner has domain_owner permission
    if owner_id_new is not None:
        new_owner = db.query(User).filter(User.user_id == owner_id_new).first()
        if not new_owner:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Owner user not found"
            )
        new_owner_perms = get_user_permissions(db, new_owner)
        if "domain_owner" not in new_owner_perms and not is_admin(db, new_owner):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The selected user does not have permission to be a domain owner (requires domain_owner permission)"
            )
        db_domain.owner_id = owner_id_new

    # Create audit log
    audit_log = AuditLog(
        type="domain",
        action="update",
        user_id=user_id,
        details={"domain_id": domain_id, **domain.model_dump(exclude_unset=True)}
    )
    db.add(audit_log)
    db.commit()
    db.refresh(db_domain)

    logger.info(f"Domain updated successfully: {domain_id}")
    return db_domain


@router.delete("/{domain_id}")
async def delete_domain(
    domain_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Delete a domain. Requires delete_domain permission or domain owner."""
    user_id = get_current_user_id(request)
    logger.info(f"Deleting domain: {domain_id} by user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Get domain
    db_domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not db_domain:
        logger.warning(f"Domain delete failed: Domain not found - {domain_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )

    # Check permission (allow admin and owner)
    is_owner = db_domain.owner_id == user_id
    require_permission(
        db, user, "delete_domain",
        resource_owner_id=db_domain.owner_id if is_owner else None,
        allow_admin=True,
        error_message="You do not have permission to delete this domain"
    )

    # Check domain access (unless admin or owner)
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            logger.warning(f"Domain delete failed: No access - domain: {domain_id}, user: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=DOMAIN_ACCESS_DENIED_DETAIL
            )

    domain_name = db_domain.domain_name

    # Check for dependent records (use cases)
    use_case_count = db.query(UseCase).filter(UseCase.domain_id == domain_id).count()
    if use_case_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete domain. It has {use_case_count} use case(s). Please delete or move these use cases first."
        )

    # Check for domain access records
    access_count = db.query(DomainAccess).filter(DomainAccess.domain_id == domain_id).count()
    if access_count > 0:
        # Delete domain access records (they're dependent on the domain)
        db.query(DomainAccess).filter(DomainAccess.domain_id == domain_id).delete()

    db.delete(db_domain)

    # Create audit log
    audit_log = AuditLog(
        type="domain",
        action="delete",
        user_id=user_id,
        details={"domain_id": domain_id, "domain_name": domain_name}
    )
    db.add(audit_log)
    db.commit()

    logger.info(f"Domain deleted successfully: {domain_id}")
    return {"message": "Domain deleted successfully"}


@router.put("/{domain_id}/owner", response_model=DomainResponse)
async def update_domain_owner(
    domain_id: str,
    owner_update: DomainOwnerUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Update domain owner. Only current owner or admin can reassign ownership."""
    user_id = get_current_user_id(request)
    logger.info(f"Updating domain owner: {domain_id} by user: {user_id}")

    # Get domain
    db_domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not db_domain:
        logger.warning(f"Domain owner update failed: Domain not found - {domain_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check if user is current owner
    is_owner = db_domain.owner_id == user_id

    if not is_user_admin and not is_owner:
        logger.warning(f"Domain owner update failed: Not owner or admin - domain: {domain_id}, user: {user_id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only domain owner or admin can reassign ownership"
        )

    # Verify new owner exists
    new_owner = db.query(User).filter(User.user_id == owner_update.owner_id).first()
    if not new_owner:
        logger.warning(f"Domain owner update failed: New owner not found - {owner_update.owner_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="New owner not found"
        )

    # New owner must have domain_owner permission (only users with this permission can be assigned as domain owner)
    new_owner_permissions = get_user_permissions(db, new_owner)
    if "domain_owner" not in new_owner_permissions and not is_admin(db, new_owner):
        logger.warning(f"Domain owner update failed: New owner lacks domain_owner permission - {owner_update.owner_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The selected user does not have permission to be a domain owner (requires domain_owner permission)"
        )

    # Update owner
    old_owner_id = db_domain.owner_id
    db_domain.owner_id = owner_update.owner_id
    db_domain.modified_by = user_id

    # Create audit log
    audit_log = AuditLog(
        type="domain",
        action="update_owner",
        user_id=user_id,
        details={
            "domain_id": domain_id,
            "old_owner_id": old_owner_id,
            "new_owner_id": owner_update.owner_id
        }
    )
    db.add(audit_log)
    db.commit()
    db.refresh(db_domain)

    previous_owner = db.query(User).filter(User.user_id == old_owner_id).first() if old_owner_id else None
    notify_domain_owner_changed(
        db,
        db_domain,
        actor=user,
        new_owner=new_owner,
        previous_owner=previous_owner,
    )

    logger.info(f"Domain owner updated successfully: {domain_id} (new owner: {owner_update.owner_id})")
    return db_domain


@router.get("/{domain_id}", response_model=DomainResponse)
async def get_domain(
    domain_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get a specific domain. Requires domain_access permission and domain access."""
    user_id = get_current_user_id(request)
    logger.debug(f"Fetching domain: {domain_id} for user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "domain_access",
        allow_admin=True,
        error_message="You do not have permission to access domains"
    )

    # Get domain
    domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not domain:
        logger.warning(f"Domain not found: {domain_id}")
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
            logger.warning(f"Domain access denied: domain: {domain_id}, user: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=DOMAIN_ACCESS_DENIED_DETAIL
            )

    return domain


class DomainAccessUserResponse(BaseModel):
    """User assigned to a domain."""
    user_id: str
    user_name: str
    user_email: str


class DomainAccessAdd(BaseModel):
    """Request to add a user to domain access."""
    user_id: str


def _require_edit_domain_and_access(db: Session, user_id: str, domain_id: str):
    """Require edit_domain or domain ownership, and that user has access to the domain. Returns (user, domain)."""
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    # Allow if user has edit_domain, or is admin, or is the domain owner (so Architect/Reviewer as owner can edit/assign)
    require_permission(
        db, user, "edit_domain",
        resource_owner_id=domain.owner_id,
        allow_admin=True,
        error_message="You do not have permission to edit this domain"
    )
    is_owner = domain.owner_id == user_id
    if not is_user_admin and not is_owner:
        access = db.query(DomainAccess).filter(
            DomainAccess.domain_id == domain_id,
            DomainAccess.user_id == user_id
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DOMAIN_ACCESS_DENIED_DETAIL)
    return user, domain


def _require_domain_owner_or_admin_for_access(db: Session, user: User, domain: Domain):
    """Only domain owner or administrator can assign/remove users to/from a domain. Raises 403 otherwise."""
    if is_admin(db, user):
        return
    if domain.owner_id == user.user_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only the domain owner or an administrator can assign users to this domain"
    )


@router.get("/{domain_id}/access", response_model=list[DomainAccessUserResponse])
async def get_domain_access(
    domain_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """List users assigned to this domain. Only domain owner or administrator."""
    user_id = get_current_user_id(request)
    user, domain = _require_edit_domain_and_access(db, user_id, domain_id)
    _require_domain_owner_or_admin_for_access(db, user, domain)
    access_list = db.query(DomainAccess).filter(DomainAccess.domain_id == domain_id).all()
    result = []
    for da in access_list:
        u = db.query(User).filter(User.user_id == da.user_id).first()
        if u:
            result.append(DomainAccessUserResponse(
                user_id=u.user_id,
                user_name=u.user_name,
                user_email=u.user_email
            ))
    return result


@router.post("/{domain_id}/access", response_model=DomainAccessUserResponse)
async def add_domain_access(
    domain_id: str,
    body: DomainAccessAdd,
    request: Request,
    db: Session = Depends(get_db)
):
    """Assign a user to this domain. Only domain owner or administrator."""
    user_id = get_current_user_id(request)
    user, domain = _require_edit_domain_and_access(db, user_id, domain_id)
    _require_domain_owner_or_admin_for_access(db, user, domain)
    target_user = db.query(User).filter(User.user_id == body.user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    # User being assigned must have domain_access permission (role contains domain_access)
    target_perms = get_user_permissions(db, target_user)
    if "domain_access" not in target_perms and not is_admin(db, target_user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only users with domain_access permission (in their role) can be assigned to a domain"
        )
    existing = db.query(DomainAccess).filter(
        DomainAccess.domain_id == domain_id,
        DomainAccess.user_id == body.user_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already assigned to this domain"
        )
    da = DomainAccess(
        domain_id=domain_id,
        user_id=body.user_id,
        created_by=user_id,
        modified_by=user_id
    )
    db.add(da)
    db.commit()
    db.refresh(da)
    notify_domain_access_granted(
        db,
        domain,
        actor=user,
        target_user=target_user,
    )
    return DomainAccessUserResponse(
        user_id=target_user.user_id,
        user_name=target_user.user_name,
        user_email=target_user.user_email
    )


@router.delete("/{domain_id}/access/{access_user_id}")
async def remove_domain_access(
    domain_id: str,
    access_user_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Remove a user's access to this domain. Only domain owner or administrator."""
    user_id = get_current_user_id(request)
    user, domain = _require_edit_domain_and_access(db, user_id, domain_id)
    _require_domain_owner_or_admin_for_access(db, user, domain)
    da = db.query(DomainAccess).filter(
        DomainAccess.domain_id == domain_id,
        DomainAccess.user_id == access_user_id
    ).first()
    if not da:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not assigned to this domain")
    target_user = db.query(User).filter(User.user_id == access_user_id).first()
    db.delete(da)
    db.commit()
    notify_domain_access_removed(
        db,
        domain,
        actor=user,
        target_user=target_user,
    )
    return {"message": "User removed from domain access"}
