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
from urllib.parse import parse_qs, urlencode

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.logging_config import logger
from app.models import (
    Domain,
    DomainAccess,
    Notification,
    Permission,
    Role,
    RolePermission,
    UseCase,
    UseCaseRiskReview,
    User,
)

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

GOVERNOR_ACTION_TYPES = frozenset(
    {
        "use_case_created",
        "analysis_completed",
        "analysis_rejected",
        "ready_for_estimate",
        "estimate_completed",
        "roi_completed",
        "assessment_completed",
    }
)

CASE_ASSIGN_ACTION_TYPES = frozenset(
    {
        "use_case_created",
        "analysis_rejected",
        "ready_for_estimate",
        "estimate_completed",
        "roi_completed",
    }
)

EDIT_NOTIFICATION_TYPES = frozenset(
    {
        "use_case_created",
        "analysis_assigned",
        "analysis_rejected",
        "analysis_send_back",
        "ready_for_estimate",
        "estimate_assigned",
        "estimate_completed",
        "roi_assigned",
        "roi_completed",
        "assessment_assigned",
        "assessment_completed",
        "risk_assigned",
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


def _notification_role_name(db: Session, user: User) -> str | None:
    if not user.role_id:
        return None
    role = db.query(Role).filter(Role.role_id == user.role_id).first()
    return role.role_name if role else None


def _notification_permissions(db: Session, user: User) -> set[str]:
    if not user.role_id:
        return set()
    return {
        row[0]
        for row in (
            db.query(Permission.permission_name)
            .join(RolePermission, RolePermission.permission_id == Permission.permission_id)
            .filter(RolePermission.role_id == user.role_id)
            .all()
        )
    }


def _accessible_domain_ids(db: Session, user: User, role_name: str | None) -> set[str]:
    if role_name in ("portal_admin", "Admin"):
        return {row[0] for row in db.query(Domain.domain_id).all()}
    domain_ids = {
        row[0]
        for row in db.query(DomainAccess.domain_id).filter(DomainAccess.user_id == user.user_id).all()
    }
    domain_ids.update(
        row[0]
        for row in db.query(Domain.domain_id).filter(Domain.owner_id == user.user_id).all()
    )
    return domain_ids


def _is_current_governor(
    user: User,
    role_name: str | None,
    domain: Domain | None,
    accessible_domain_ids: set[str],
) -> bool:
    if role_name in ("portal_admin", "Admin"):
        return True
    if not domain:
        return False
    if domain.owner_id == user.user_id:
        return True
    return role_name == "ai_leader" and domain.domain_id in accessible_domain_ids


def _assignment_still_belongs_to_user(
    row: Notification,
    use_case: UseCase,
    user_id: str,
    role_name: str | None,
    risk_reviews: dict[int, UseCaseRiskReview],
) -> bool:
    if row.type in ("analysis_assigned", "analysis_send_back"):
        track = str((row.payload or {}).get("track") or "").lower()
        if track.startswith("tech"):
            return (
                role_name == "tech_architect"
                and use_case.status == "Analysis"
                and use_case.technical_owner == user_id
            )
        if track.startswith("bus"):
            return (
                role_name == "business_reviewer"
                and use_case.status == "Analysis"
                and use_case.business_owner == user_id
            )
        return use_case.status == "Analysis" and (
            (role_name == "tech_architect" and use_case.technical_owner == user_id)
            or (role_name == "business_reviewer" and use_case.business_owner == user_id)
        )
    if row.type == "estimate_assigned":
        return (
            role_name == "tech_architect"
            and use_case.status == "Estimate"
            and use_case.estimate_owner == user_id
        )
    if row.type == "roi_assigned":
        return (
            role_name in ("business_reviewer", "ai_leader", "domain_owner")
            and use_case.status == "ROI"
            and use_case.roi_owner == user_id
        )
    if row.type == "assessment_assigned":
        return (
            role_name in ("business_reviewer", "ai_leader", "domain_owner", "portal_admin")
            and use_case.status == "AI Assessment"
            and use_case.assessment_owner == user_id
        )
    if row.type == "risk_assigned":
        raw_id = (row.payload or {}).get("risk_review_id")
        try:
            risk_id = int(raw_id)
        except (TypeError, ValueError):
            return False
        risk = risk_reviews.get(risk_id)
        return bool(
            risk
            and risk.use_case_id == use_case.use_case_id
            and risk.assigned_to == user_id
            and risk.status == "open"
        )
    return True


def _governor_action_matches_stage(row: Notification, use_case: UseCase) -> bool:
    expected_status = {
        "use_case_created": "New",
        "analysis_completed": "Analysis",
        "analysis_rejected": "Analysis",
        "ready_for_estimate": "Review",
        "estimate_completed": "ROI",
        "roi_completed": "AI Assessment",
        "assessment_completed": "AI Assessment",
    }.get(row.type)
    if expected_status is not None and use_case.status != expected_status:
        return False
    if row.type == "use_case_created":
        return not use_case.technical_owner and not use_case.business_owner
    if row.type == "estimate_completed":
        return not use_case.roi_owner
    if row.type == "roi_completed":
        return not use_case.assessment_owner
    return True


def _use_case_notification_is_visible(
    row: Notification,
    use_case: UseCase | None,
    user: User,
    role_name: str | None,
    permissions: set[str],
    accessible_domains: set[str],
    domains: dict[str, Domain],
    risk_reviews: dict[int, UseCaseRiskReview],
) -> bool:
    if not use_case:
        return row.type == "use_case_deleted" and row.domain_id in accessible_domains
    if use_case.domain_id not in accessible_domains:
        return False
    is_admin = role_name in ("portal_admin", "Admin")
    if not is_admin and "case_view" not in permissions:
        return False
    if not _assignment_still_belongs_to_user(
        row,
        use_case,
        user.user_id,
        role_name,
        risk_reviews,
    ):
        return False
    if not is_admin and row.type in CASE_ASSIGN_ACTION_TYPES and "case_assign" not in permissions:
        return False
    if (
        not is_admin
        and row.type == "assessment_completed"
        and not {"case_approve", "case_reject"}.intersection(permissions)
    ):
        return False
    if not is_admin and row.type == "risk_assigned" and "case_review" not in permissions:
        return False
    if (
        not is_admin
        and row.type == "assessment_assigned"
        and not {"initiate_assessment", "contribute_assessment", "case_assess"}.intersection(permissions)
    ):
        return False
    if row.type not in GOVERNOR_ACTION_TYPES:
        return True
    return (
        _is_current_governor(
            user,
            role_name,
            domains.get(use_case.domain_id),
            accessible_domains,
        )
        and _governor_action_matches_stage(row, use_case)
    )


def _domain_notification_is_visible(
    row: Notification,
    role_name: str | None,
    accessible_domains: set[str],
) -> bool:
    if row.type in ("domain_access_removed", "domain_owner_changed"):
        return True
    if row.type == "domain_created":
        return role_name in ("portal_admin", "Admin")
    domain_id = row.domain_id or row.entity_id
    return bool(domain_id and domain_id in accessible_domains)


def _notification_is_visible(
    row: Notification,
    user: User,
    role_name: str | None,
    permissions: set[str],
    accessible_domains: set[str],
    use_cases: dict[str, UseCase],
    domains: dict[str, Domain],
    risk_reviews: dict[int, UseCaseRiskReview],
) -> bool:
    if row.type == "registration_pending":
        return role_name in ("portal_admin", "Admin") or "settings_access" in permissions
    if row.entity_type == "use_case":
        return _use_case_notification_is_visible(
            row,
            use_cases.get(row.entity_id or ""),
            user,
            role_name,
            permissions,
            accessible_domains,
            domains,
            risk_reviews,
        )
    if row.entity_type == "domain":
        return _domain_notification_is_visible(row, role_name, accessible_domains)
    return True


def _visible_notification_rows(
    db: Session,
    user_id: str,
    rows: list[Notification],
) -> tuple[list[Notification], dict[str, UseCase]]:
    """Apply current role, domain membership, case location, and assignment ownership."""
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user or not user.is_active:
        return [], {}

    role_name = _notification_role_name(db, user)
    permissions = _notification_permissions(db, user)
    accessible_domains = _accessible_domain_ids(db, user, role_name)
    use_case_ids = {
        row.entity_id
        for row in rows
        if row.entity_type == "use_case" and row.entity_id
    }
    use_cases = {
        item.use_case_id: item
        for item in db.query(UseCase).filter(UseCase.use_case_id.in_(use_case_ids)).all()
    } if use_case_ids else {}
    domain_ids = set(accessible_domains)
    domain_ids.update(item.domain_id for item in use_cases.values() if item.domain_id)
    domain_ids.update(row.domain_id for row in rows if row.domain_id)
    domains = {
        item.domain_id: item
        for item in db.query(Domain).filter(Domain.domain_id.in_(domain_ids)).all()
    } if domain_ids else {}
    risk_ids: set[int] = set()
    for row in rows:
        if row.type != "risk_assigned":
            continue
        try:
            risk_ids.add(int((row.payload or {}).get("risk_review_id")))
        except (TypeError, ValueError):
            continue
    risk_reviews = {
        item.risk_review_id: item
        for item in (
            db.query(UseCaseRiskReview)
            .filter(UseCaseRiskReview.risk_review_id.in_(risk_ids))
            .all()
        )
    } if risk_ids else {}

    visible = [
        row
        for row in rows
        if _notification_is_visible(
            row,
            user,
            role_name,
            permissions,
            accessible_domains,
            use_cases,
            domains,
            risk_reviews,
        )
    ]
    return visible, use_cases


def current_notification_link(
    row: Notification,
    use_cases: dict[str, UseCase],
) -> str | None:
    """Rebuild a use-case deep link with its current domain after moves."""
    if row.entity_type != "use_case":
        return row.link
    use_case = use_cases.get(row.entity_id or "")
    if not use_case:
        return row.link if row.type == "use_case_deleted" else None
    params: dict[str, list[str]] = {}
    if row.link and "?" in row.link:
        params = parse_qs(row.link.split("?", 1)[1])

    should_edit = (
        row.type in EDIT_NOTIFICATION_TYPES
        and use_case.status not in ("Approved", "Rejected")
    )
    if should_edit:
        return use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section=(params.get("section") or [None])[0],
            action=(params.get("action") or [None])[0],
        )

    base = f"#/d/{use_case.domain_id}/u/{use_case.use_case_id}"
    section = (params.get("section") or [None])[0]
    return f"{base}?{urlencode({'section': section})}" if section else base


def unread_count_for_user(db: Session, user_id: str) -> int:
    query = db.query(Notification).filter(
        Notification.recipient_user_id == user_id,
        Notification.is_read.is_(False),
        Notification.dismissed_dt.is_(None),
    )
    rows = _exclude_stale_terminal_actions(query).all()
    visible, _ = _visible_notification_rows(db, user_id, rows)
    return len(visible)


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

    rows = q.order_by(Notification.created_dt.desc()).all()
    visible, _ = _visible_notification_rows(db, user_id, rows)
    return visible[:max(1, min(limit, 100))]


def resolve_notification_for_user(
    db: Session,
    user_id: str,
    notification_id: str,
) -> tuple[Notification, str | None] | None:
    row = (
        db.query(Notification)
        .filter(
            Notification.notification_id == notification_id,
            Notification.recipient_user_id == user_id,
            Notification.dismissed_dt.is_(None),
        )
        .first()
    )
    if not row:
        return None
    visible, use_cases = _visible_notification_rows(db, user_id, [row])
    if not visible:
        return None
    return row, current_notification_link(row, use_cases)


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


def serialize_notification(
    row: Notification,
    actor_name: str | None = None,
    link_override: str | None = None,
) -> dict[str, Any]:
    return {
        "notification_id": row.notification_id,
        "type": row.type,
        "title": row.title,
        "message": row.message,
        "severity": row.severity,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "domain_id": row.domain_id,
        "link": link_override if link_override is not None else row.link,
        "actions": row.actions or ["open"],
        "payload": row.payload or {},
        "is_read": bool(row.is_read),
        "read_dt": _iso_utc(row.read_dt),
        "created_dt": _iso_utc(row.created_dt),
        "actor_user_id": row.actor_user_id,
        "actor_name": actor_name,
    }
