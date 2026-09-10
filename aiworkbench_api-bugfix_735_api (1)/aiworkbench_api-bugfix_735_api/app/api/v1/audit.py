"""
Audit log endpoints.
"""
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.authorization import get_user_with_permissions, require_permission
from app.core.database import get_db
from app.core.logging_config import logger
from app.middleware.auth_middleware import get_current_user_id
from app.models import AuditLog, User

router = APIRouter()


class UiNavigationEventRequest(BaseModel):
    """Client-reported UI navigation for the audit trail (any signed-in user)."""
    action: Literal["domain_opened", "use_cases_opened", "blog_post_opened"]
    domain_id: str | None = None
    domain_name: str | None = None
    domain_short_name: str | None = None
    blog_post_id: str | None = None
    blog_title: str | None = None
    blog_kind: str | None = None

    @field_validator(
        "domain_id",
        "domain_name",
        "domain_short_name",
        "blog_post_id",
        "blog_title",
        "blog_kind",
        mode="before",
    )
    @classmethod
    def strip_strings(cls, v):
        if v is None or not isinstance(v, str):
            return v
        s = v.strip()
        return s or None


class AuditLogResponse(BaseModel):
    audit_id: str
    audit_date: str
    type: str
    action: str
    user_id: str | None
    details: dict[str, Any] | None
    user_name: str | None = None

    class Config:
        from_attributes = True


@router.post("/navigation-event", status_code=status.HTTP_204_NO_CONTENT)
async def record_ui_navigation_event(
    request: Request,
    db: Session = Depends(get_db),
    payload: UiNavigationEventRequest = Body(...),
):
    """
    Record a user navigation event (domain, use-case list, or blog/article open).
    Does not require audit_access; any authenticated user may submit.
    """
    user_id = get_current_user_id(request)
    action = payload.action

    if action == "domain_opened":
        if not payload.domain_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="domain_id is required for domain_opened",
            )
    elif action == "use_cases_opened":
        if not payload.domain_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="domain_id is required for use_cases_opened",
            )
    elif action == "blog_post_opened" and not payload.blog_post_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="blog_post_id is required for blog_post_opened",
        )

    details = payload.model_dump(exclude_none=True, exclude={"action"})
    db.add(
        AuditLog(
            type="ui_navigation",
            action=action,
            user_id=user_id,
            details=details,
        )
    )
    db.commit()
    logger.debug("ui_navigation audit: user=%s action=%s", user_id, action)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/", response_model=list[AuditLogResponse])
async def get_audit_logs(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    type_filter: str | None = Query(None, alias="type"),
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db)
):
    """Get audit logs with filtering. Requires audit_access permission."""
    user_id = get_current_user_id(request)
    logger.info(f"Fetching audit logs for user: {user_id}")

    # Get user with permissions
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)

    # Check permission (Admin bypass enabled)
    require_permission(
        db, user, "audit_access",
        allow_admin=True,
        error_message="You do not have permission to access audit logs"
    )

    # Build query
    query = db.query(AuditLog)

    if type_filter:
        query = query.filter(AuditLog.type == type_filter)

    if date_from:
        try:
            date_from_obj = datetime.fromisoformat(date_from.replace('Z', '+00:00'))
            query = query.filter(AuditLog.audit_date >= date_from_obj)
        except Exception as e:
            logger.warning(f"Invalid date_from format: {date_from} - {str(e)}")

    if date_to:
        try:
            date_to_obj = datetime.fromisoformat(date_to.replace('Z', '+00:00'))
            query = query.filter(AuditLog.audit_date <= date_to_obj)
        except Exception as e:
            logger.warning(f"Invalid date_to format: {date_to} - {str(e)}")

    # Get total count before pagination
    total_count = query.count()
    logger.info(f"Total audit logs found: {total_count}")

    # Apply pagination and ordering
    logs = query.order_by(AuditLog.audit_date.desc()).offset(skip).limit(limit).all()
    logger.info(f"Returning {len(logs)} audit logs (skip={skip}, limit={limit})")

    result = []
    for log in logs:
        user_name = None
        if log.user_id:
            user_obj = db.query(User).filter(User.user_id == log.user_id).first()
            if user_obj:
                user_name = user_obj.user_name

        result.append(AuditLogResponse(
            audit_id=log.audit_id,
            audit_date=log.audit_date.isoformat(),
            type=log.type,
            action=log.action,
            user_id=log.user_id,
            details=log.details,
            user_name=user_name
        ))

    # Apply search filter if provided (after fetching from DB)
    if search:
        search_lower = search.lower()
        result = [
            log for log in result
            if search_lower in log.type.lower() or
               search_lower in log.action.lower() or
               (log.details and search_lower in str(log.details).lower())
        ]
        logger.info(f"After search filter: {len(result)} audit logs")

    logger.info(f"Returning {len(result)} audit logs to client")
    return result
