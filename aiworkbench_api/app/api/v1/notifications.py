"""
In-app notification inbox endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth_middleware import get_current_user_id
from app.models import UseCase, User
from app.services.notification_service import (
    current_notification_link,
    dismiss_all_notifications,
    dismiss_notification,
    list_notifications_for_user,
    mark_all_notifications_read,
    mark_notification_read,
    resolve_notification_for_user,
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
    use_case_ids = {
        row.entity_id
        for row in rows
        if row.entity_type == "use_case" and row.entity_id
    }
    use_cases = {
        item.use_case_id: item
        for item in db.query(UseCase).filter(UseCase.use_case_id.in_(use_case_ids)).all()
    } if use_case_ids else {}
    return {
        "unread_count": unread_count_for_user(db, user_id),
        "items": [
            serialize_notification(
                r,
                actor_name=names.get(r.actor_user_id) if r.actor_user_id else None,
                link_override=current_notification_link(r, use_cases),
            )
            for r in rows
        ],
    }


@router.get("/unread-count")
async def get_unread_count(request: Request, db: Session = Depends(get_db)):
    user_id = get_current_user_id(request)
    return {"unread_count": unread_count_for_user(db, user_id)}


@router.get("/{notification_id}/resolve")
async def resolve_notification(
    notification_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Revalidate access and return the notification's current deep link."""
    user_id = get_current_user_id(request)
    resolved = resolve_notification_for_user(db, user_id, notification_id)
    if not resolved:
        stale_row = dismiss_notification(db, user_id, notification_id)
        if stale_row:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail=(
                    "This is an old notification. The use case, domain, assignment, "
                    "role, or permission changed, so this action is no longer available."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    row, link = resolved
    actor_names = _actor_names(db, {row.actor_user_id} if row.actor_user_id else set())
    return serialize_notification(
        row,
        actor_name=actor_names.get(row.actor_user_id) if row.actor_user_id else None,
        link_override=link,
    )


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
