"""Business logic for use case assessment checklist instances."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.core.assessment_checklist_options import (
    QUESTION_BASE_SCORE_TOTAL,
    compute_assessment_total_score,
    normalize_allowed_checklist_items,
)
from app.models import (
    AssessmentChecklistTemplate,
    UseCase,
    UseCaseAssessment,
    UseCaseAssessmentResponse,
    UseCaseAssessmentResponseHistory,
    User,
)
from app.services.assessment_checklist_service import serialize_template
from app.services.usecase_documentation_quality_service import usecase_documentation_quality_service

MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT = 60


def _get_active_effective_template(db: Session) -> AssessmentChecklistTemplate | None:
    return (
        db.query(AssessmentChecklistTemplate)
        .filter(
            AssessmentChecklistTemplate.is_active.is_(True),
            AssessmentChecklistTemplate.status == "EFFECTIVE",
        )
        .first()
    )


def _build_template_snapshot(template: AssessmentChecklistTemplate, db: Session) -> dict:
    payload = serialize_template(template, db, include_areas=True)
    return {
        "template_id": payload["template_id"],
        "version_number": payload["version_number"],
        "name": payload["name"],
        "question_count": payload["question_count"],
        "assessment_total_score": payload["assessment_total_score"],
        "risk_classification_ranges": payload.get("risk_classification_ranges") or [],
        "areas": payload.get("areas") or [],
    }


def _answer_score(penalty_factor: float | None) -> float:
    penalty = max(float(penalty_factor or 1.0), 0.0001)
    return min(QUESTION_BASE_SCORE_TOTAL, QUESTION_BASE_SCORE_TOTAL / penalty)


def compute_question_score(selected_answers: list[dict] | None) -> float:
    """Score a question from its selected answers (multi-select uses the average)."""
    if not selected_answers:
        return 0.0
    scores = [_answer_score(answer.get("penalty_factor")) for answer in selected_answers]
    return round(sum(scores) / len(scores), 4)


def classify_risk(total_score: float, ranges: list[dict]) -> str | None:
    if not ranges:
        return None
    for row in ranges:
        min_score = float(row.get("min_score", 0))
        max_score = float(row.get("max_score", 0))
        if min_score <= total_score <= max_score:
            return str(row.get("level"))
    return None


def _user_display(db: Session, user_id: str | None) -> dict | None:
    if not user_id:
        return None
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        return {"user_id": user_id, "user_name": "Unknown"}
    return {"user_id": user.user_id, "user_name": user.user_name, "user_email": user.user_email}


def get_use_case_assessment(
    db: Session,
    use_case_id: str,
    *,
    load_history: bool = True,
) -> UseCaseAssessment | None:
    query = db.query(UseCaseAssessment).options(joinedload(UseCaseAssessment.responses))
    if load_history:
        query = query.options(joinedload(UseCaseAssessment.history))
    return query.filter(UseCaseAssessment.use_case_id == use_case_id).first()


def _require_documentation_quality_for_assessment(db: Session, use_case: UseCase) -> None:
    summary = usecase_documentation_quality_service.get_documentation_quality_summary(
        db=db,
        use_case=use_case,
    )
    if not summary:
        raise ValueError(
            f"AI documentation quality analysis is required before starting an assessment "
            f"(minimum {MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT}%)."
        )
    if summary.overall_score < MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT:
        raise ValueError(
            f"AI documentation quality score must be at least {MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT}% "
            f"(current: {summary.overall_score}%)."
        )


def initiate_assessment(
    db: Session,
    use_case: UseCase,
    user_id: str,
    *,
    force_new: bool = False,
) -> UseCaseAssessment:
    existing = get_use_case_assessment(db, use_case.use_case_id)
    if existing:
        if existing.status == "IN_PROGRESS" and not force_new:
            return existing
        if existing.status == "IN_PROGRESS" and force_new:
            raise ValueError(
                "An assessment is already in progress. Cancel it or close it before starting a new one."
            )
        if existing.status == "CLOSED" and not force_new:
            return existing
        if existing.status == "CLOSED" and force_new:
            db.delete(existing)
            db.flush()

    _require_documentation_quality_for_assessment(db, use_case)

    template = _get_active_effective_template(db)
    if not template:
        pending = (
            db.query(AssessmentChecklistTemplate)
            .filter(AssessmentChecklistTemplate.status.in_(["DRAFT", "IN REVIEW"]))
            .order_by(AssessmentChecklistTemplate.modified_dt.desc())
            .first()
        )
        if pending:
            raise ValueError(
                f'Checklist "{pending.name}" is still {pending.status}. '
                "A portal admin must Activate it in Settings → AI Assessment Checklist before assessments can start."
            )
        raise ValueError(
            "No active effective assessment checklist template is available. "
            "Create and Activate one in Settings → AI Assessment Checklist."
        )

    snapshot = _build_template_snapshot(template, db)
    assessment = UseCaseAssessment(
        use_case_id=use_case.use_case_id,
        template_id=template.template_id,
        template_version_number=template.version_number,
        template_name=template.name,
        template_snapshot=snapshot,
        status="IN_PROGRESS",
        initiated_by=user_id,
        modified_by=user_id,
        next_review_date=datetime.utcnow() + timedelta(days=365),
    )
    db.add(assessment)
    db.flush()
    return assessment


def save_response(
    db: Session,
    assessment: UseCaseAssessment,
    *,
    template_item_id: int,
    area_id: int,
    sno: str,
    selected_labels: list[str],
    comment: str | None,
    user_id: str,
) -> UseCaseAssessmentResponse:
    if assessment.status != "IN_PROGRESS":
        raise ValueError("Assessment is closed and cannot be edited")

    item_meta = _find_item_in_snapshot(assessment.template_snapshot, template_item_id)
    if not item_meta:
        raise ValueError("Question not found in assessment template snapshot")

    allowed = normalize_allowed_checklist_items(item_meta.get("allowed_checklist_items"))
    label_map = {entry["label"].lower(): entry for entry in allowed}
    selected_answers = []
    for label in selected_labels:
        key = label.strip().lower()
        if key and key in label_map:
            selected_answers.append(label_map[key])

    now = datetime.utcnow()
    response = (
        db.query(UseCaseAssessmentResponse)
        .filter(
            UseCaseAssessmentResponse.assessment_id == assessment.assessment_id,
            UseCaseAssessmentResponse.template_item_id == template_item_id,
        )
        .first()
    )
    change_action = "created"
    if response:
        change_action = "updated"
        response.selected_answers = selected_answers
        response.comment = (comment or "").strip() or None
        response.last_modified_by = user_id
        response.last_modified_dt = now
        if selected_answers and not response.answered_by:
            response.answered_by = user_id
            response.answered_dt = now
    else:
        response = UseCaseAssessmentResponse(
            assessment_id=assessment.assessment_id,
            template_item_id=template_item_id,
            area_id=area_id,
            sno=sno,
            selected_answers=selected_answers,
            comment=(comment or "").strip() or None,
            answered_by=user_id if selected_answers else None,
            answered_dt=now if selected_answers else None,
            last_modified_by=user_id,
            last_modified_dt=now,
        )
        db.add(response)

    db.add(
        UseCaseAssessmentResponseHistory(
            assessment_id=assessment.assessment_id,
            template_item_id=template_item_id,
            sno=sno,
            selected_answers=selected_answers,
            comment=(comment or "").strip() or None,
            changed_by=user_id,
            change_action=change_action,
        )
    )
    assessment.modified_by = user_id
    db.flush()
    return response


def _find_item_in_snapshot(snapshot: dict, template_item_id: int) -> dict | None:
    for area in snapshot.get("areas") or []:
        for item in area.get("items") or []:
            if int(item.get("item_id")) == int(template_item_id):
                return item
    return None


def close_assessment(
    db: Session,
    assessment: UseCaseAssessment,
    user_id: str,
    *,
    overall_findings: str | None = None,
) -> UseCaseAssessment:
    if assessment.status != "IN_PROGRESS":
        raise ValueError("Assessment is already closed")

    snapshot = assessment.template_snapshot or {}
    responses_by_item = {
        row.template_item_id: row for row in assessment.responses
    }

    question_scores: list[dict] = []
    area_summaries: list[dict] = []
    total_score = 0.0

    for area in snapshot.get("areas") or []:
        area_score = 0.0
        area_question_count = 0
        for item in area.get("items") or []:
            item_id = int(item["item_id"])
            response = responses_by_item.get(item_id)
            selected = response.selected_answers if response else None
            score = compute_question_score(selected)
            question_scores.append(
                {
                    "template_item_id": item_id,
                    "area_id": area.get("area_id"),
                    "sno": item.get("sno"),
                    "assessment_item": item.get("assessment_item"),
                    "category": item.get("category"),
                    "score": score,
                    "selected_answers": selected or [],
                    "comment": response.comment if response else None,
                    "answered_by": _user_display(db, response.answered_by if response else None),
                    "answered_dt": response.answered_dt.isoformat() if response and response.answered_dt else None,
                }
            )
            area_score += score
            area_question_count += 1
        area_summaries.append(
            {
                "area_id": area.get("area_id"),
                "seq_no": area.get("seq_no"),
                "title": area.get("title"),
                "question_count": area_question_count,
                "score": round(area_score, 4),
                "max_score": round(area_question_count * QUESTION_BASE_SCORE_TOTAL, 4),
            }
        )
        total_score += area_score

    total_score = round(total_score, 4)
    risk = classify_risk(total_score, snapshot.get("risk_classification_ranges") or [])

    assessment.status = "CLOSED"
    assessment.closed_by = user_id
    assessment.closed_dt = datetime.utcnow()
    assessment.total_score = total_score
    assessment.risk_classification = risk
    assessment.overall_findings = (overall_findings or "").strip() or None
    assessment.area_summaries = area_summaries
    assessment.question_scores = question_scores
    assessment.modified_by = user_id
    db.flush()
    return assessment


def cancel_assessment(db: Session, assessment: UseCaseAssessment) -> None:
    """Delete an in-progress assessment so the use case can start fresh later."""
    if assessment.status != "IN_PROGRESS":
        raise ValueError("Only in-progress assessments can be cancelled")
    db.delete(assessment)
    db.flush()


def reset_closed_assessment(db: Session, assessment: UseCaseAssessment, user_id: str) -> UseCaseAssessment:
    """Start a new assessment cycle by replacing a closed assessment."""
    if assessment.status != "CLOSED":
        raise ValueError("Only closed assessments can be replaced with a new assessment")
    use_case_id = assessment.use_case_id
    db.delete(assessment)
    db.flush()
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise LookupError("Use case not found")
    return initiate_assessment(db, use_case, user_id, force_new=True)


def build_participants(db: Session, assessment: UseCaseAssessment) -> list[dict]:
    participants: dict[str, dict] = {}

    initiator = _user_display(db, assessment.initiated_by)
    if initiator:
        participants[initiator["user_id"]] = {
            **initiator,
            "role": "Initiator",
            "last_change_dt": assessment.initiated_dt.isoformat() if assessment.initiated_dt else None,
        }

    for response in assessment.responses:
        for uid in filter(None, [response.answered_by, response.last_modified_by]):
            user = _user_display(db, uid)
            if not user:
                continue
            last_dt = response.last_modified_dt or response.answered_dt
            iso = last_dt.isoformat() if last_dt else None
            if uid in participants:
                if iso and (not participants[uid]["last_change_dt"] or iso > participants[uid]["last_change_dt"]):
                    participants[uid]["last_change_dt"] = iso
            else:
                participants[uid] = {
                    **user,
                    "role": "Contributor",
                    "last_change_dt": iso,
                }

    if assessment.closed_by:
        closer = _user_display(db, assessment.closed_by)
        if closer:
            iso = assessment.closed_dt.isoformat() if assessment.closed_dt else None
            participants[closer["user_id"]] = {
                **closer,
                "role": "Closed by",
                "last_change_dt": iso,
            }

    return sorted(participants.values(), key=lambda row: row.get("user_name") or "")


def serialize_assessment(
    db: Session,
    assessment: UseCaseAssessment,
    use_case: UseCase | None = None,
    *,
    include_history: bool = True,
    include_participants: bool = True,
) -> dict:
    user_cache: dict[str, dict | None] = {}

    def cached_user_display(user_id: str | None) -> dict | None:
        if not user_id:
            return None
        if user_id not in user_cache:
            user_cache[user_id] = _user_display(db, user_id)
        return user_cache[user_id]

    responses = {
        row.template_item_id: {
            "response_id": row.response_id,
            "template_item_id": row.template_item_id,
            "area_id": row.area_id,
            "sno": row.sno,
            "selected_answers": row.selected_answers or [],
            "comment": row.comment,
            "answered_by": cached_user_display(row.answered_by),
            "answered_dt": row.answered_dt.isoformat() if row.answered_dt else None,
            "last_modified_by": cached_user_display(row.last_modified_by),
            "last_modified_dt": row.last_modified_dt.isoformat() if row.last_modified_dt else None,
        }
        for row in assessment.responses
    }

    history: list[dict] = []
    if include_history:
        history = [
            {
                "history_id": row.history_id,
                "template_item_id": row.template_item_id,
                "sno": row.sno,
                "selected_answers": row.selected_answers or [],
                "comment": row.comment,
                "changed_by": cached_user_display(row.changed_by),
                "changed_dt": row.changed_dt.isoformat() if row.changed_dt else None,
                "change_action": row.change_action,
            }
            for row in sorted(assessment.history, key=lambda item: item.changed_dt or datetime.min, reverse=True)
        ]

    payload: dict[str, Any] = {
        "assessment_id": assessment.assessment_id,
        "use_case_id": assessment.use_case_id,
        "template_id": assessment.template_id,
        "template_version_number": assessment.template_version_number,
        "template_name": assessment.template_name,
        "template_snapshot": assessment.template_snapshot,
        "status": assessment.status,
        "initiated_by": cached_user_display(assessment.initiated_by),
        "initiated_dt": assessment.initiated_dt.isoformat() if assessment.initiated_dt else None,
        "closed_by": cached_user_display(assessment.closed_by),
        "closed_dt": assessment.closed_dt.isoformat() if assessment.closed_dt else None,
        "next_review_date": assessment.next_review_date.isoformat() if assessment.next_review_date else None,
        "total_score": assessment.total_score,
        "max_score": compute_assessment_total_score(
            int((assessment.template_snapshot or {}).get("question_count") or 0)
        ),
        "risk_classification": assessment.risk_classification,
        "overall_findings": assessment.overall_findings,
        "area_summaries": assessment.area_summaries or [],
        "question_scores": assessment.question_scores or [],
        "ai_prefill_applied": bool(assessment.ai_prefill_applied),
        "responses": responses,
    }

    if include_participants:
        payload["participants"] = build_participants(db, assessment)
    else:
        payload["participants"] = []

    if include_history:
        payload["history"] = history
    else:
        payload["history"] = []

    if use_case:
        payload["use_case_name"] = use_case.use_case_name
        payload["technical_owner"] = use_case.technical_owner
        payload["business_owner"] = use_case.business_owner

    return payload
