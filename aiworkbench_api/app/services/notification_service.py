"""
In-app notification helpers — create and query per-user inbox rows.

Design rules:
- Never raise into workflow APIs (assign / reject / complete).
- Prefer flush + shared commit; isolated commit only when the caller already committed.
- Deduplicate recipients (assigner + domain owner, etc.).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Iterable

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.logging_config import logger
from app.models import Domain, DomainAccess, Notification, Role, UseCase, User

# Action-needed inbox items that become stale after Approve/Reject.
STALE_WHEN_TERMINAL_TYPES = frozenset(
    {
        "assessment_completed",
        "ready_for_estimate",
        "estimate_completed",
        "roi_completed",
        "analysis_assigned",
        "estimate_assigned",
        "roi_assigned",
        "assessment_assigned",
        "analysis_send_back",
    }
)


ASSIGNMENT_TYPES = frozenset(
    {
        "analysis_assigned",
        "estimate_assigned",
        "roi_assigned",
        "assessment_assigned",
        "analysis_send_back",
        "analysis_rejected",
        "analysis_reassigned",
        "estimate_reassigned",
        "roi_reassigned",
        "assessment_reassigned",
        "use_case_created",
        "ready_for_estimate",
        "estimate_completed",
        "roi_completed",
        "assessment_completed",
        "risk_assigned",
        "domain_access_granted",
    }
)

UPDATE_TYPES = frozenset(
    {
        "analysis_completed",
        "analysis_rejected",
        "use_case_created",
        "use_case_approved",
        "use_case_rejected",
        "use_case_moved",
        "use_case_deleted",
        "domain_created",
        "domain_owner_changed",
        "domain_access_removed",
        "registration_pending",
        "comment_added",
    }
)

def use_case_edit_link(
    *,
    domain_id: str | None,
    use_case_id: str,
    section: str | None = None,
    action: str | None = None,
) -> str:
    """Build hash deep-link into UseCaseEdit."""
    if domain_id:
        base = f"#/d/{domain_id}/u/{use_case_id}/edit"
    else:
        base = f"#/u/{use_case_id}/edit"
    params: list[str] = []
    if section:
        params.append(f"section={section}")
    if action:
        params.append(f"action={action}")
    if not params:
        return base
    return f"{base}?{'&'.join(params)}"


def resolve_domain_owner_id(db: Session, domain_id: str | None) -> str | None:
    if not domain_id:
        return None
    domain = db.query(Domain).filter(Domain.domain_id == domain_id).first()
    if not domain:
        return None
    owner_id = getattr(domain, "owner_id", None)
    return str(owner_id) if owner_id else None


def get_active_users_by_role_names(db: Session, role_names: Iterable[str]) -> list[User]:
    names = [n for n in role_names if n]
    if not names:
        return []
    roles = db.query(Role).filter(Role.role_name.in_(names)).all()
    if not roles:
        return []
    role_ids = [r.role_id for r in roles]
    return (
        db.query(User)
        .filter(User.role_id.in_(role_ids), User.is_active.is_(True))
        .all()
    )


def governor_user_ids(db: Session, domain_id: str | None) -> list[str]:
    """Governors who can act on this domain: portal admins, domain owner, and domain-scoped ai_leaders.

    ai_leader receives assign notifications only when they have DomainAccess (or own the domain).
    Portal admins are always included.
    """
    ids: list[str] = [
        u.user_id for u in get_active_users_by_role_names(db, ("portal_admin", "Admin"))
    ]
    owner_id = resolve_domain_owner_id(db, domain_id)
    if owner_id:
        ids.append(owner_id)

    if domain_id:
        member_ids = {
            row[0]
            for row in db.query(DomainAccess.user_id).filter(DomainAccess.domain_id == domain_id).all()
            if row[0]
        }
        if owner_id:
            member_ids.add(owner_id)
        for leader in get_active_users_by_role_names(db, ("ai_leader",)):
            if leader.user_id in member_ids:
                ids.append(leader.user_id)

    return stakeholder_recipient_ids(*ids)


def use_case_stakeholder_ids(
    db: Session,
    use_case: UseCase,
    extra: Iterable[str | None] | None = None,
) -> list[str]:
    """Creator, current stage owners, and governors for this use case's domain."""
    return stakeholder_recipient_ids(
        getattr(use_case, "created_by", None),
        getattr(use_case, "technical_owner", None),
        getattr(use_case, "business_owner", None),
        getattr(use_case, "estimate_owner", None),
        getattr(use_case, "roi_owner", None),
        getattr(use_case, "assessment_owner", None),
        *governor_user_ids(db, getattr(use_case, "domain_id", None)),
        *(extra or []),
    )


def stakeholder_recipient_ids(
    *user_ids: str | None,
    exclude: Iterable[str | None] | None = None,
) -> list[str]:
    """Dedupe recipient IDs and drop excluded actors."""
    skip = {str(x) for x in (exclude or []) if x}
    seen: set[str] = set()
    out: list[str] = []
    for raw in user_ids:
        if not raw:
            continue
        uid = str(raw)
        if uid in skip or uid in seen:
            continue
        seen.add(uid)
        out.append(uid)
    return out


def create_notification(
    db: Session,
    *,
    recipient_user_id: str | None,
    actor_user_id: str | None = None,
    type: str,
    title: str,
    message: str,
    severity: str = "info",
    entity_type: str | None = None,
    entity_id: str | None = None,
    domain_id: str | None = None,
    link: str | None = None,
    actions: list[str] | None = None,
    payload: dict[str, Any] | None = None,
    commit: bool = False,
) -> Notification | None:
    """
    Insert one inbox row.

    Default is flush-only (commit=False) so the caller can share one transaction.
    Never raises — returns None on skip/failure so workflow APIs stay intact.
    """
    if not recipient_user_id:
        return None
    if actor_user_id and recipient_user_id == actor_user_id:
        return None

    row = Notification(
        recipient_user_id=recipient_user_id,
        actor_user_id=actor_user_id,
        type=type,
        title=(title or "")[:200],
        message=(message or "")[:500],
        severity=severity if severity in ("critical", "warning", "info") else "info",
        entity_type=entity_type,
        entity_id=entity_id,
        domain_id=domain_id,
        link=link,
        actions=actions or ["open"],
        payload=payload,
        is_read=False,
        created_dt=datetime.now(UTC).replace(tzinfo=None),
    )
    try:
        # SAVEPOINT so a failed insert cannot poison the outer workflow transaction.
        with db.begin_nested():
            db.add(row)
            db.flush()
        if commit:
            db.commit()
            try:
                db.refresh(row)
            except Exception:
                pass
        return row
    except Exception:
        logger.exception(
            "Failed to create notification type=%s recipient=%s",
            type,
            recipient_user_id,
        )
        if commit:
            try:
                db.rollback()
            except Exception:
                pass
        return None


def create_notifications_for_users(
    db: Session,
    *,
    recipient_user_ids: Iterable[str | None],
    actor_user_id: str | None = None,
    type: str,
    title: str,
    message: str,
    severity: str = "info",
    entity_type: str | None = None,
    entity_id: str | None = None,
    domain_id: str | None = None,
    link: str | None = None,
    actions: list[str] | None = None,
    payload: dict[str, Any] | None = None,
    commit: bool = True,
) -> int:
    """Create one notification per recipient (deduped). Safe — never raises."""
    created = 0
    for uid in stakeholder_recipient_ids(*list(recipient_user_ids), exclude=[actor_user_id]):
        row = create_notification(
            db,
            recipient_user_id=uid,
            actor_user_id=actor_user_id,
            type=type,
            title=title,
            message=message,
            severity=severity,
            entity_type=entity_type,
            entity_id=entity_id,
            domain_id=domain_id,
            link=link,
            actions=actions,
            payload=payload,
            commit=False,
        )
        if row:
            created += 1
    if created and commit:
        try:
            db.commit()
        except Exception:
            logger.exception("Failed to commit notifications type=%s", type)
            try:
                db.rollback()
            except Exception:
                pass
            return 0
    return created


def notify_assigner_and_domain_owner(
    db: Session,
    use_case: UseCase,
    *,
    assigner_user_id: str | None,
    actor_user_id: str | None,
    type: str,
    title: str,
    message: str,
    severity: str = "info",
    link: str | None = None,
    actions: list[str] | None = None,
    payload: dict[str, Any] | None = None,
    commit: bool = True,
    extra_recipient_ids: Iterable[str | None] | None = None,
) -> int:
    """Notify domain-accessible governors (portal_admin, owner, ai_leader) plus assigner."""
    recipients = [
        *governor_user_ids(db, getattr(use_case, "domain_id", None)),
        assigner_user_id,
        *(extra_recipient_ids or []),
    ]
    return create_notifications_for_users(
        db,
        recipient_user_ids=recipients,
        actor_user_id=actor_user_id,
        type=type,
        title=title,
        message=message,
        severity=severity,
        entity_type="use_case",
        entity_id=getattr(use_case, "use_case_id", None),
        domain_id=getattr(use_case, "domain_id", None),
        link=link,
        actions=actions,
        payload=payload,
        commit=commit,
    )


def get_active_admin_users(db: Session) -> list[User]:
    admin_role = db.query(Role).filter(Role.role_name == "portal_admin").first()
    if not admin_role:
        admin_role = db.query(Role).filter(Role.role_name == "Admin").first()
    if not admin_role:
        return []
    return (
        db.query(User)
        .filter(User.role_id == admin_role.role_id, User.is_active.is_(True))
        .all()
    )


def create_notifications_for_admins(
    db: Session,
    *,
    actor_user_id: str | None = None,
    type: str,
    title: str,
    message: str,
    severity: str = "info",
    entity_type: str | None = None,
    entity_id: str | None = None,
    domain_id: str | None = None,
    link: str | None = None,
    actions: list[str] | None = None,
    payload: dict[str, Any] | None = None,
) -> int:
    """Create one notification per active admin. Returns count created. Never raises."""
    try:
        admins = get_active_admin_users(db)
        return create_notifications_for_users(
            db,
            recipient_user_ids=[a.user_id for a in admins],
            actor_user_id=actor_user_id,
            type=type,
            title=title,
            message=message,
            severity=severity,
            entity_type=entity_type,
            entity_id=entity_id,
            domain_id=domain_id,
            link=link,
            actions=actions,
            payload=payload,
            commit=True,
        )
    except Exception:
        logger.exception("Failed to create admin notifications type=%s", type)
        return 0


def dismiss_stale_use_case_action_notifications(db: Session, use_case_id: str | None) -> int:
    """Hide pending-action inbox items after a use case is Approved or Rejected."""
    if not use_case_id:
        return 0
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        rows = (
            db.query(Notification)
            .filter(
                Notification.entity_type == "use_case",
                Notification.entity_id == use_case_id,
                Notification.type.in_(STALE_WHEN_TERMINAL_TYPES),
                Notification.dismissed_dt.is_(None),
            )
            .all()
        )
        for row in rows:
            row.dismissed_dt = now
            if not row.is_read:
                row.is_read = True
                row.read_dt = now
        if rows:
            db.commit()
        return len(rows)
    except Exception:
        logger.exception("Failed to dismiss stale action notifications use_case_id=%s", use_case_id)
        return 0


def _exclude_stale_terminal_actions(query):
    """Keep inbox items that are not superseded by an Approved/Rejected use case."""
    return query.outerjoin(
        UseCase,
        (Notification.entity_type == "use_case") & (Notification.entity_id == UseCase.use_case_id),
    ).filter(
        or_(
            Notification.type.notin_(STALE_WHEN_TERMINAL_TYPES),
            UseCase.use_case_id.is_(None),
            UseCase.status.notin_(("Approved", "Rejected")),
        )
    )


def unread_count_for_user(db: Session, user_id: str) -> int:
    query = db.query(Notification).filter(
        Notification.recipient_user_id == user_id,
        Notification.is_read.is_(False),
        Notification.dismissed_dt.is_(None),
    )
    return _exclude_stale_terminal_actions(query).count()


def list_notifications_for_user(
    db: Session,
    user_id: str,
    *,
    limit: int = 20,
    unread_only: bool = False,
    filter_group: str | None = None,
) -> list[Notification]:
    q = db.query(Notification).filter(
        Notification.recipient_user_id == user_id,
        Notification.dismissed_dt.is_(None),
    )
    q = _exclude_stale_terminal_actions(q)
    if unread_only or filter_group == "unread":
        q = q.filter(Notification.is_read.is_(False))
    if filter_group == "assignments":
        q = q.filter(Notification.type.in_(ASSIGNMENT_TYPES))
    elif filter_group == "updates":
        q = q.filter(Notification.type.in_(UPDATE_TYPES))

    return q.order_by(Notification.created_dt.desc()).limit(max(1, min(limit, 100))).all()


def mark_notification_read(db: Session, user_id: str, notification_id: str) -> Notification | None:
    row = (
        db.query(Notification)
        .filter(
            Notification.notification_id == notification_id,
            Notification.recipient_user_id == user_id,
        )
        .first()
    )
    if not row:
        return None
    if not row.is_read:
        row.is_read = True
        row.read_dt = datetime.now(UTC).replace(tzinfo=None)
        db.commit()
        db.refresh(row)
    return row


def mark_all_notifications_read(db: Session, user_id: str) -> int:
    now = datetime.now(UTC).replace(tzinfo=None)
    rows = (
        db.query(Notification)
        .filter(
            Notification.recipient_user_id == user_id,
            Notification.is_read.is_(False),
            Notification.dismissed_dt.is_(None),
        )
        .all()
    )
    for row in rows:
        row.is_read = True
        row.read_dt = now
    if rows:
        db.commit()
    return len(rows)


def dismiss_all_notifications(db: Session, user_id: str, filter_group: str | None = None) -> int:
    now = datetime.now(UTC).replace(tzinfo=None)
    q = db.query(Notification).filter(
        Notification.recipient_user_id == user_id,
        Notification.dismissed_dt.is_(None),
    )
    if filter_group == "unread":
        q = q.filter(Notification.is_read.is_(False))
    elif filter_group == "assignments":
        q = q.filter(Notification.type.in_(ASSIGNMENT_TYPES))
    elif filter_group == "updates":
        q = q.filter(Notification.type.in_(UPDATE_TYPES))
    rows = q.all()
    for row in rows:
        row.dismissed_dt = now
        if not row.is_read:
            row.is_read = True
            row.read_dt = now
    if rows:
        db.commit()
    return len(rows)


def dismiss_notification(db: Session, user_id: str, notification_id: str) -> Notification | None:
    row = (
        db.query(Notification)
        .filter(
            Notification.notification_id == notification_id,
            Notification.recipient_user_id == user_id,
        )
        .first()
    )
    if not row:
        return None
    row.dismissed_dt = datetime.now(UTC).replace(tzinfo=None)
    if not row.is_read:
        row.is_read = True
        row.read_dt = row.dismissed_dt
    db.commit()
    db.refresh(row)
    return row


def _iso_utc(value: datetime | None) -> str | None:
    """Serialize DB datetimes as UTC ISO-8601 with Z (naive values are treated as UTC)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat() + "Z"
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def serialize_notification(row: Notification, actor_name: str | None = None) -> dict[str, Any]:
    return {
        "notification_id": row.notification_id,
        "type": row.type,
        "title": row.title,
        "message": row.message,
        "severity": row.severity,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "domain_id": row.domain_id,
        "link": row.link,
        "actions": row.actions or ["open"],
        "payload": row.payload or {},
        "is_read": bool(row.is_read),
        "read_dt": _iso_utc(row.read_dt),
        "created_dt": _iso_utc(row.created_dt),
        "actor_user_id": row.actor_user_id,
        "actor_name": actor_name,
    }
