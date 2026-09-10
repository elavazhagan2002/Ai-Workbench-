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
)
from app.models import Domain, Permission, Role, RolePermission, User


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
    """
    Return True if the user owns the domain (domains.owner_id) or holds the domain_owner role
    and is listed as owner_id for that domain.
    """
    if not domain_id:
        return False
    domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not domain:
        return False
    return domain.owner_id == user.user_id


def has_domain_owner_role(db: Session, user: User) -> bool:
    """Return True if the user's role is domain_owner."""
    return get_user_role_name(db, user) == DOMAIN_OWNER_ROLE


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
