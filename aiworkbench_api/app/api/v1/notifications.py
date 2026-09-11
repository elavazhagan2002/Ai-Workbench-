"""
In-app notification inbox endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth_middleware import get_current_user_id
from app.models import User
from app.services.notification_service import (
    dismiss_all_notifications,
    dismiss_notification,
    list_notifications_for_user,
    mark_all_notifications_read,
    mark_notification_read,
    serialize_notification,
    unread_count_for_user,
)

router = APIRouter()


def _actor_names(db: Session, actor_ids: set[str]) -> dict[str, str]:
    if not actor_ids:
        return {}
    users = db.query(User).filter(User.user_id.in_(actor_ids)).all()
    return {
        u.user_id: (u.user_name or u.user_email or "Unknown user")
        for u in users
    }


@router.get("")
@router.get("/")
async def list_notifications(
    request: Request,
    db: Session = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    unread_only: bool = Query(default=False),
    filter: str | None = Query(default=None),
):
    """List current user's in-app notifications."""
    user_id = get_current_user_id(request)
    allowed = {None, "all", "unread", "assignments", "updates"}
    if filter not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="filter must be one of: all, unread, assignments, updates",
        )
    filter_group = None if not filter or filter == "all" else filter
    rows = list_notifications_for_user(
        db,
        user_id,
        limit=limit,
        unread_only=unread_only,
        filter_group=filter_group,
    )
    names = _actor_names(db, {r.actor_user_id for r in rows if r.actor_user_id})
    return {
        "unread_count": unread_count_for_user(db, user_id),
        "items": [
            serialize_notification(r, actor_name=names.get(r.actor_user_id) if r.actor_user_id else None)
            for r in rows
        ],
    }


@router.get("/unread-count")
async def get_unread_count(request: Request, db: Session = Depends(get_db)):
    user_id = get_current_user_id(request)
    return {"unread_count": unread_count_for_user(db, user_id)}


@router.patch("/{notification_id}/read")
async def read_notification(
    notification_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    row = mark_notification_read(db, user_id, notification_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return {
        "notification_id": row.notification_id,
        "is_read": True,
        "unread_count": unread_count_for_user(db, user_id),
    }


@router.post("/read-all")
async def read_all_notifications(request: Request, db: Session = Depends(get_db)):
    user_id = get_current_user_id(request)
    updated = mark_all_notifications_read(db, user_id)
    return {"updated": updated, "unread_count": 0}


@router.post("/dismiss-all")
async def dismiss_all(
    request: Request,
    db: Session = Depends(get_db),
    filter: str | None = Query(default="all"),
):
    user_id = get_current_user_id(request)
    allowed = {None, "all", "unread", "assignments", "updates"}
    if filter not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="filter must be one of: all, unread, assignments, updates",
        )
    filter_group = None if not filter or filter == "all" else filter
    updated = dismiss_all_notifications(db, user_id, filter_group=filter_group)
    return {"updated": updated, "unread_count": unread_count_for_user(db, user_id)}


@router.post("/{notification_id}/dismiss")
async def dismiss_one(
    notification_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    row = dismiss_notification(db, user_id, notification_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return {
        "notification_id": row.notification_id,
        "dismissed": True,
        "unread_count": unread_count_for_user(db, user_id),
    }
