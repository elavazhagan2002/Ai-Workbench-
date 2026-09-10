"""
Dashboard endpoints — enterprise, domain, and individual levels.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.authorization import get_user_with_permissions, require_permission
from app.core.database import get_db
from app.middleware.auth_middleware import get_current_user_id
from app.services.dashboard_service import (
    build_domain_dashboard,
    build_enterprise_dashboard,
    build_individual_dashboard,
)

router = APIRouter()


@router.get("/enterprise")
async def get_enterprise_dashboard(request: Request, db: Session = Depends(get_db)):
    """Enterprise-level dashboard. Requires dashboard_enterprise."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "dashboard_enterprise",
        allow_admin=True,
        error_message="You do not have permission to view the Enterprise dashboard (requires dashboard_enterprise)",
    )
    return build_enterprise_dashboard(db, user, is_user_admin=is_user_admin)


@router.get("/domain")
async def get_domain_dashboard(
    request: Request,
    db: Session = Depends(get_db),
    domain_id: str | None = Query(default=None),
):
    """Domain-level dashboard. Requires dashboard_domain. Optional domain_id filter."""
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "dashboard_domain",
        allow_admin=True,
        domain_id=domain_id,
        error_message="You do not have permission to view the Domain dashboard (requires dashboard_domain)",
    )
    try:
        return build_domain_dashboard(
            db, user, is_user_admin=is_user_admin, domain_id=domain_id
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/individual")
async def get_individual_dashboard(request: Request, db: Session = Depends(get_db)):
    """Individual-level dashboard. Requires dashboard_individual."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "dashboard_individual",
        allow_admin=True,
        error_message="You do not have permission to view the Individual dashboard (requires dashboard_individual)",
    )
    return build_individual_dashboard(db, user)


@router.get("/levels")
async def get_available_dashboard_levels(request: Request, db: Session = Depends(get_db)):
    """Return which dashboard levels the current user can access."""
    user_id = get_current_user_id(request)
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)
    perm_names = set(permissions or [])
    if is_user_admin:
        levels = ["enterprise", "domain", "individual"]
    else:
        levels = []
        if "dashboard_enterprise" in perm_names:
            levels.append("enterprise")
        if "dashboard_domain" in perm_names:
            levels.append("domain")
        if "dashboard_individual" in perm_names:
            levels.append("individual")
    return {"levels": levels}
