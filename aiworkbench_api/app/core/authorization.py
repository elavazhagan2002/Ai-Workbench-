"""
Authorization utilities for role-based access control.
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.logging_config import logger
from app.core.workflow import (
    DOMAIN_OWNER_ROLE,
    DOMAIN_SCOPED_PERMISSIONS,
    PORTAL_ADMIN_ROLE,
    PRIVILEGED_PERMISSIONS,
    SYSTEM_ROLE_NAMES,
)
from app.models import Domain, DomainAccess, Permission, Role, RolePermission, User

# Shown when a user opens a domain/use case without DomainAccess (or ownership).
DOMAIN_ACCESS_DENIED_DETAIL = (
    "Sorry - this domain is not assigned to you. "
    "Please contact a portal admin or domain owner to request access."
)


def get_user_permissions(db: Session, user: User) -> list[str]:
    """
    Get user permissions from their role.

    Args:
        db: Database session
        user: User object

    Returns:
        List of permission names
    """
    permissions = []
    if user.role_id:
        role_perms = db.query(RolePermission).filter(
            RolePermission.role_id == user.role_id
        ).all()
        perm_ids = [rp.permission_id for rp in role_perms]
        if perm_ids:
            perms = db.query(Permission).filter(
                Permission.permission_id.in_(perm_ids)
            ).all()
            permissions = [p.permission_name for p in perms]
    return permissions


def is_portal_admin(db: Session, user: User) -> bool:
    """Return True if user has the portal_admin role (formerly Admin)."""
    if not user.role_id:
        return False

    role = db.query(Role).filter(Role.role_id == user.role_id).first()
    return bool(role and role.role_name == PORTAL_ADMIN_ROLE)


def is_admin(db: Session, user: User) -> bool:
    """
    Check if user has portal_admin role.

    Kept as is_admin for backward compatibility with existing call sites.
    """
    return is_portal_admin(db, user)


def get_user_role_name(db: Session, user: User) -> str | None:
    """Return the user's role_name or None."""
    if not user.role_id:
        return None
    role = db.query(Role).filter(Role.role_id == user.role_id).first()
    return role.role_name if role else None


def is_domain_owner(db: Session, user: User, domain_id: str) -> bool:
    """Return True when domains.owner_id matches this user."""
    if not domain_id:
        return False
    domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not domain:
        return False
    return domain.owner_id == user.user_id


def user_has_domain_membership(db: Session, user_id: str, domain_id: str) -> bool:
    """True when the user owns the domain or has an explicit DomainAccess row."""
    if not domain_id or not user_id:
        return False
    domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if domain and domain.owner_id == user_id:
        return True
    return (
        db.query(DomainAccess)
        .filter(DomainAccess.domain_id == domain_id, DomainAccess.user_id == user_id)
        .first()
        is not None
    )


def has_domain_owner_role(db: Session, user: User) -> bool:
    """Return True if the user's role is domain_owner."""
    return get_user_role_name(db, user) == DOMAIN_OWNER_ROLE


def is_domain_scoped_governor_role(db: Session, user: User) -> bool:
    """Roles that govern a domain when they have membership (DomainAccess or owner_id)."""
    return get_user_role_name(db, user) in ("ai_leader", DOMAIN_OWNER_ROLE)


def is_domain_governor(db: Session, user: User, domain_id: str) -> bool:
    """
    Return True for portal admins, the assigned domain owner (owner_id), or scoped
    ai_leader / domain_owner role holders with membership on this domain.
    """
    if is_portal_admin(db, user):
        return True
    if is_domain_owner(db, user, domain_id):
        return True
    if not user_has_domain_membership(db, user.user_id, domain_id):
        return False
    return is_domain_scoped_governor_role(db, user)


def check_permission(
    db: Session,
    user: User,
    required_permission: str,
    resource_owner_id: str = None,
    allow_admin: bool = True,
    domain_id: str = None,
) -> bool:
    """
    Check if user has required permission, is resource owner, or domain owner (scoped).

    Args:
        db: Database session
        user: User object
        required_permission: Required permission name
        resource_owner_id: Optional resource owner ID (for owner-based access)
        allow_admin: Whether portal_admin role bypasses permission check
        domain_id: Optional domain ID; when set, domain owners get domain-scoped perms

    Returns:
        True if user has permission
    """
    # portal_admin bypass (if enabled)
    if allow_admin and is_portal_admin(db, user):
        return True

    # Check if user is resource owner
    if resource_owner_id and user.user_id == resource_owner_id:
        return True

    # Domain owner of the given domain gets domain-scoped usecase/workflow/portal perms
    if (
        domain_id
        and required_permission in DOMAIN_SCOPED_PERMISSIONS
        and is_domain_owner(db, user, domain_id)
    ):
        return True

    # Check permissions from role
    permissions = get_user_permissions(db, user)
    return required_permission in permissions


def require_permission(
    db: Session,
    user: User,
    required_permission: str,
    resource_owner_id: str = None,
    allow_admin: bool = True,
    error_message: str = None,
    domain_id: str = None,
) -> None:
    """
    Require user to have permission or be resource owner.
    Raises HTTPException if permission check fails.
    """
    if not check_permission(
        db,
        user,
        required_permission,
        resource_owner_id,
        allow_admin,
        domain_id=domain_id,
    ):
        permissions = get_user_permissions(db, user)
        is_user_admin = is_portal_admin(db, user)

        logger.warning(
            f"Permission denied: user={user.user_id}, "
            f"required={required_permission}, "
            f"has_permission={required_permission in permissions}, "
            f"is_admin={is_user_admin}, "
            f"is_owner={resource_owner_id == user.user_id if resource_owner_id else False}, "
            f"domain_id={domain_id}"
        )

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=error_message or f"You do not have permission to perform this action. Required: {required_permission}"
        )


def is_system_role_name(role_name: str | None) -> bool:
    """True for seeded system roles that must not be renamed or deleted."""
    return bool(role_name and role_name in SYSTEM_ROLE_NAMES)


def count_active_portal_admins(db: Session) -> int:
    """Count active users with the portal_admin role."""
    admin_role = db.query(Role).filter(Role.role_name == PORTAL_ADMIN_ROLE).first()
    if not admin_role:
        return 0
    return (
        db.query(User)
        .filter(User.role_id == admin_role.role_id, User.is_active.is_(True))
        .count()
    )


def permission_names_for_ids(db: Session, permission_ids: list[str] | None) -> set[str]:
    """Resolve permission IDs to names."""
    if not permission_ids:
        return set()
    rows = (
        db.query(Permission.permission_name)
        .filter(Permission.permission_id.in_(permission_ids))
        .all()
    )
    return {name for (name,) in rows if name}


def require_can_grant_permissions(
    db: Session,
    actor: User,
    permission_names: set[str],
) -> None:
    """
    Only portal_admin may grant privileged permissions (settings_access / audit_access).
    """
    if not permission_names.intersection(PRIVILEGED_PERMISSIONS):
        return
    if is_portal_admin(db, actor):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only portal_admin can grant settings_access or audit_access",
    )


def require_can_assign_role(
    db: Session,
    actor: User,
    target_role: Role | None,
    *,
    previous_role_name: str | None = None,
) -> None:
    """
    Guard role assignment: only portal_admin may assign portal_admin,
    and the last active portal_admin cannot be demoted.
    """
    new_name = target_role.role_name if target_role else None
    if new_name == PORTAL_ADMIN_ROLE and not is_portal_admin(db, actor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only portal_admin can assign the portal_admin role",
        )
    if previous_role_name == PORTAL_ADMIN_ROLE and new_name != PORTAL_ADMIN_ROLE:
        if count_active_portal_admins(db) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote the last active portal_admin",
            )


def get_user_with_permissions(db: Session, user_id: str) -> tuple[User, list[str], bool]:
    """
    Get user with their permissions and portal_admin status.

    Returns:
        Tuple of (User, permissions list, is_admin bool)
    """
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    permissions = get_user_permissions(db, user)
    is_user_admin = is_portal_admin(db, user)

    return user, permissions, is_user_admin
