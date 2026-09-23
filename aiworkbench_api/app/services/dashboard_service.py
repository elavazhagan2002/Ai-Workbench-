"""
Dashboard aggregation helpers for enterprise, domain, and individual views.
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable

from sqlalchemy.orm import Session

from app.core.authorization import DOMAIN_ACCESS_DENIED_DETAIL
from app.models import (
    Domain,
    DomainAccess,
    UseCase,
    UseCaseDocumentationQualityResult,
    User,
)


WORKFLOW_STATUSES = [
    "New",
    "Analysis",
    "Review",
    "Estimate",
    "ROI",
    "AI Assessment",
    "Approved",
    "Rejected",
]


def _count_by(values: Iterable[str | None]) -> list[dict]:
    counter: Counter[str] = Counter()
    for value in values:
        label = (value or "Unassigned").strip() or "Unassigned"
        counter[label] += 1
    return [{"label": k, "count": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0]))]


def _roi_bucket(roi_percent) -> str:
    if roi_percent is None:
        return "N/A"
    try:
        pct = float(roi_percent)
    except (TypeError, ValueError):
        return "N/A"
    if pct < 0:
        return "Negative"
    if pct < 50:
        return "0–50%"
    if pct < 100:
        return "50–100%"
    return "100%+"


def _quality_bucket(score: int | None) -> str:
    if score is None:
        return "Not scored"
    if score < 60:
        return "Needs work (<60)"
    if score < 80:
        return "Fair (60–79)"
    return "Strong (80+)"


def accessible_domain_ids(db: Session, user: User, *, is_user_admin: bool) -> list[str] | None:
    """Return domain ids the user can see, or None for unrestricted (admin)."""
    if is_user_admin:
        return None
    owned = [
        d.domain_id
        for d in db.query(Domain.domain_id).filter(Domain.owner_id == user.user_id).all()
    ]
    access = [
        a.domain_id
        for a in db.query(DomainAccess.domain_id).filter(DomainAccess.user_id == user.user_id).all()
    ]
    return list({*owned, *access})


def _use_cases_for_domains(db: Session, domain_ids: list[str] | None) -> list[UseCase]:
    q = db.query(UseCase)
    if domain_ids is not None:
        if not domain_ids:
            return []
        q = q.filter(UseCase.domain_id.in_(domain_ids))
    return q.all()


def _quality_map(db: Session, use_case_ids: list[str]) -> dict[str, int]:
    if not use_case_ids:
        return {}
    rows = (
        db.query(UseCaseDocumentationQualityResult)
        .filter(UseCaseDocumentationQualityResult.use_case_id.in_(use_case_ids))
        .all()
    )
    return {r.use_case_id: int(r.overall_score) for r in rows}


def _user_name_map(db: Session, user_ids: set[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    users = db.query(User).filter(User.user_id.in_(list(user_ids))).all()
    return {u.user_id: (u.user_name or u.user_email or u.user_id) for u in users}


def _owner_display(uc: UseCase) -> str | None:
    return uc.technical_owner or uc.business_owner or uc.estimate_owner or uc.roi_owner or uc.assessment_owner


def aggregate_use_cases(db: Session, use_cases: list[UseCase]) -> dict:
    ids = [uc.use_case_id for uc in use_cases]
    quality = _quality_map(db, ids)

    owner_ids = {oid for uc in use_cases if (oid := _owner_display(uc))}
    names = _user_name_map(db, owner_ids)

    by_status = _count_by([uc.status for uc in use_cases])
    # Ensure workflow statuses appear even at 0 for stable charts
    status_map = {row["label"]: row["count"] for row in by_status}
    by_status_full = [{"label": s, "count": status_map.get(s, 0)} for s in WORKFLOW_STATUSES]
    for label, count in status_map.items():
        if label not in WORKFLOW_STATUSES:
            by_status_full.append({"label": label, "count": count})

    by_owner = _count_by([names.get(oid, oid) if (oid := _owner_display(uc)) else "Unassigned" for uc in use_cases])
    by_quality = _count_by([_quality_bucket(quality.get(uc.use_case_id)) for uc in use_cases])

    roi_labels = []
    for uc in use_cases:
        if not uc.roi_completed_dt:
            continue
        data = uc.roi_data if isinstance(uc.roi_data, dict) else {}
        roi_labels.append(_roi_bucket(data.get("roi_percent") if data else None))
    by_roi = _count_by(roi_labels)

    return {
        "total_use_cases": len(use_cases),
        "by_status": by_status_full,
        "by_owner": by_owner[:25],
        "by_quality": by_quality,
        "by_roi": by_roi,
    }


def domain_breakdown(db: Session, use_cases: list[UseCase]) -> list[dict]:
    domain_ids = {uc.domain_id for uc in use_cases if uc.domain_id}
    domains = (
        db.query(Domain).filter(Domain.domain_id.in_(list(domain_ids))).all() if domain_ids else []
    )
    name_map = {d.domain_id: d.domain_name for d in domains}
    counts: Counter[str] = Counter()
    for uc in use_cases:
        label = name_map.get(uc.domain_id, uc.domain_id or "Unknown")
        counts[label] += 1
    return [{"label": k, "count": v} for k, v in sorted(counts.items(), key=lambda x: (-x[1], x[0]))]


def build_enterprise_dashboard(db: Session, user: User, *, is_user_admin: bool) -> dict:
    domain_ids = accessible_domain_ids(db, user, is_user_admin=is_user_admin)
    # Enterprise still respects domain access for non-admin unless they somehow have the perm without access —
    # for portal_admin/ai_leader with no DomainAccess, show all when admin; otherwise accessible only.
    if is_user_admin:
        domains = db.query(Domain).all()
        use_cases = db.query(UseCase).all()
    else:
        domains = (
            db.query(Domain).filter(Domain.domain_id.in_(domain_ids or [])).all()
            if domain_ids
            else []
        )
        use_cases = _use_cases_for_domains(db, domain_ids)

    agg = aggregate_use_cases(db, use_cases)
    return {
        "level": "enterprise",
        "domain_count": len(domains),
        "domains": [
            {"domain_id": d.domain_id, "domain_name": d.domain_name, "domain_short_name": d.domain_short_name}
            for d in sorted(domains, key=lambda x: (x.domain_name or "").lower())
        ],
        "by_domain": domain_breakdown(db, use_cases),
        **agg,
    }


def build_domain_dashboard(
    db: Session,
    user: User,
    *,
    is_user_admin: bool,
    domain_id: str | None = None,
) -> dict:
    accessible = accessible_domain_ids(db, user, is_user_admin=is_user_admin)
    if domain_id:
        if accessible is not None and domain_id not in accessible:
            raise PermissionError(DOMAIN_ACCESS_DENIED_DETAIL)
        domain_ids = [domain_id]
    else:
        domain_ids = accessible  # None = all

    domains_q = db.query(Domain)
    if domain_ids is not None:
        domains_q = domains_q.filter(Domain.domain_id.in_(domain_ids or []))
    domains = domains_q.order_by(Domain.domain_name.asc()).all()

    use_cases = _use_cases_for_domains(db, domain_ids)
    agg = aggregate_use_cases(db, use_cases)
    selected = None
    if domain_id:
        selected = next((d for d in domains if d.domain_id == domain_id), None)

    return {
        "level": "domain",
        "selected_domain_id": domain_id,
        "selected_domain_name": selected.domain_name if selected else None,
        "available_domains": [
            {"domain_id": d.domain_id, "domain_name": d.domain_name, "domain_short_name": d.domain_short_name}
            for d in domains
        ],
        **agg,
    }


def _pending_tasks(db: Session, user_id: str) -> list[dict]:
    tasks: list[dict] = []
    user = db.query(User).filter(User.user_id == user_id).first()
    role_name = user.role.role_name if user and user.role else ""
    governor_domain_ids: list[str] | None = []
    if role_name == "portal_admin":
        governor_domain_ids = None
    elif role_name == "ai_leader" and user:
        governor_domain_ids = accessible_domain_ids(db, user, is_user_admin=False)
    else:
        governor_domain_ids = [
            domain_id
            for (domain_id,) in db.query(Domain.domain_id).filter(Domain.owner_id == user_id).all()
        ]

    unassigned_roi_query = db.query(UseCase).filter(
        UseCase.status == "ROI",
        UseCase.roi_owner.is_(None),
        UseCase.roi_completed_dt.is_(None),
    )
    if governor_domain_ids is not None:
        if governor_domain_ids:
            unassigned_roi_query = unassigned_roi_query.filter(UseCase.domain_id.in_(governor_domain_ids))
        else:
            unassigned_roi_query = None
    if unassigned_roi_query is not None:
        for uc in unassigned_roi_query.all():
            tasks.append(
                {
                    "use_case_id": uc.use_case_id,
                    "domain_id": uc.domain_id,
                    "title": uc.use_case_title or uc.use_case_name,
                    "status": uc.status,
                    "task": "Assign ROI Owner",
                    "section": "roi",
                    "due_date": None,
                }
            )

    use_cases = db.query(UseCase).filter(
        (UseCase.technical_owner == user_id)
        | (UseCase.business_owner == user_id)
        | (UseCase.estimate_owner == user_id)
        | (UseCase.roi_owner == user_id)
        | (UseCase.assessment_owner == user_id)
    ).all()

    for uc in use_cases:
        title = uc.use_case_title or uc.use_case_name
        if (
            uc.status == "Analysis"
            and uc.technical_owner == user_id
            and not uc.tech_analysis_completed_dt
        ):
            tasks.append(
                {
                    "use_case_id": uc.use_case_id,
                    "domain_id": uc.domain_id,
                    "title": title,
                    "status": uc.status,
                    "task": "Complete Technical Analysis",
                    "section": "tech_analysis",
                    "due_date": uc.analysis_due_date.isoformat() if uc.analysis_due_date else None,
                }
            )
        if (
            uc.status == "Analysis"
            and uc.business_owner == user_id
            and not uc.business_analysis_completed_dt
        ):
            tasks.append(
                {
                    "use_case_id": uc.use_case_id,
                    "domain_id": uc.domain_id,
                    "title": title,
                    "status": uc.status,
                    "task": "Complete Business Analysis",
                    "section": "business_analysis",
                    "due_date": uc.analysis_due_date.isoformat() if uc.analysis_due_date else None,
                }
            )
        if uc.status == "Estimate" and uc.estimate_owner == user_id and not uc.estimate_completed_dt:
            tasks.append(
                {
                    "use_case_id": uc.use_case_id,
                    "domain_id": uc.domain_id,
                    "title": title,
                    "status": uc.status,
                    "task": "Complete Estimate",
                    "section": "estimate",
                    "due_date": uc.estimate_due_date.isoformat() if uc.estimate_due_date else None,
                }
            )
        if uc.status == "ROI" and uc.roi_owner == user_id and not uc.roi_completed_dt:
            tasks.append(
                {
                    "use_case_id": uc.use_case_id,
                    "domain_id": uc.domain_id,
                    "title": title,
                    "status": uc.status,
                    "task": "Complete ROI",
                    "section": "roi",
                    "due_date": uc.roi_due_date.isoformat() if uc.roi_due_date else None,
                }
            )
        if (
            uc.status == "AI Assessment"
            and uc.assessment_owner == user_id
            and not uc.assessment_completed_dt
        ):
            tasks.append(
                {
                    "use_case_id": uc.use_case_id,
                    "domain_id": uc.domain_id,
                    "title": title,
                    "status": uc.status,
                    "task": "Complete AI Assessment",
                    "section": "assessment",
                    "due_date": uc.assessment_due_date.isoformat() if uc.assessment_due_date else None,
                }
            )
    return tasks


def build_individual_dashboard(db: Session, user: User) -> dict:
    user_id = user.user_id
    initiated = db.query(UseCase).filter(UseCase.created_by == user_id).all()
    assigned = db.query(UseCase).filter(
        (UseCase.technical_owner == user_id)
        | (UseCase.business_owner == user_id)
        | (UseCase.estimate_owner == user_id)
        | (UseCase.roi_owner == user_id)
        | (UseCase.assessment_owner == user_id)
    ).all()

    # Union for status of initiated + assigned
    by_id: dict[str, UseCase] = {}
    for uc in [*initiated, *assigned]:
        by_id[uc.use_case_id] = uc
    combined = list(by_id.values())

    initiated_by_status = _count_by([uc.status for uc in initiated])
    assigned_by_status = _count_by([uc.status for uc in assigned])
    combined_by_status = _count_by([uc.status for uc in combined])

    pending = _pending_tasks(db, user_id)

    return {
        "level": "individual",
        "pending_tasks": pending,
        "pending_task_count": len(pending),
        "initiated_count": len(initiated),
        "assigned_count": len(assigned),
        "initiated_by_status": initiated_by_status,
        "assigned_by_status": assigned_by_status,
        "initiated_and_assigned_by_status": combined_by_status,
        "initiated_use_cases": [
            {
                "use_case_id": uc.use_case_id,
                "title": uc.use_case_title or uc.use_case_name,
                "status": uc.status,
                "domain_id": uc.domain_id,
                "created_dt": uc.created_dt.isoformat() if uc.created_dt else None,
            }
            for uc in sorted(initiated, key=lambda x: x.created_dt or x.use_case_id, reverse=True)[:50]
        ],
    }
