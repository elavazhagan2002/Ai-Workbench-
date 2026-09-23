"""Business logic for AI assessment checklist templates."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.assessment_checklist_options import (
    ASSESSMENT_AREA_TITLE_MAX_LENGTH,
    ASSESSMENT_ITEM_MAX_LENGTH,
    ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH,
    DEFAULT_PENALTY_FACTOR,
    QUESTION_BASE_SCORE_TOTAL,
    compute_assessment_total_score,
    default_risk_classification_ranges,
    normalize_allowed_checklist_items,
    normalize_category,
    normalize_risk_classification_ranges,
    normalize_status,
    validate_question_answers,
    validate_template_question_scores,
)
from app.models import (
    AssessmentChecklistArea,
    AssessmentChecklistItem,
    AssessmentChecklistTemplate,
    User,
)


def get_next_version_number(db: Session) -> int:
    current = db.query(AssessmentChecklistTemplate.version_number).order_by(
        AssessmentChecklistTemplate.version_number.desc()
    ).first()
    return (current[0] if current else 0) + 1


def _count_template_questions(template: AssessmentChecklistTemplate, db: Session | None = None) -> int:
    if template.areas:
        return sum(len(area.items) for area in template.areas)
    if db is not None:
        return (
            db.query(AssessmentChecklistItem)
            .join(AssessmentChecklistArea, AssessmentChecklistItem.area_id == AssessmentChecklistArea.area_id)
            .filter(AssessmentChecklistArea.template_id == template.template_id)
            .count()
        )
    return 0


def _copy_areas(source: AssessmentChecklistTemplate, target: AssessmentChecklistTemplate) -> None:
    for area in sorted(source.areas, key=lambda row: row.seq_no):
        new_area = AssessmentChecklistArea(
            template_id=target.template_id,
            seq_no=area.seq_no,
            title=area.title,
        )
        target.areas.append(new_area)
        for item in sorted(area.items, key=lambda row: row.sno):
            new_area.items.append(
                AssessmentChecklistItem(
                    sno=item.sno,
                    assessment_item=item.assessment_item,
                    category=item.category,
                    base_score=QUESTION_BASE_SCORE_TOTAL,
                    allowed_checklist_items=normalize_allowed_checklist_items(
                        item.allowed_checklist_items,
                        fallback_penalty=item.penalty_factor if item.penalty_factor is not None else DEFAULT_PENALTY_FACTOR,
                    ),
                )
            )


def replace_template_areas(template: AssessmentChecklistTemplate, areas_payload: list[dict]) -> None:
    validate_template_question_scores(areas_payload)
    template.areas.clear()
    for area_data in sorted(areas_payload, key=lambda row: row["seq_no"]):
        area = AssessmentChecklistArea(
            template_id=template.template_id,
            seq_no=int(area_data["seq_no"]),
            title=str(area_data["title"]).strip()[:ASSESSMENT_AREA_TITLE_MAX_LENGTH],
        )
        template.areas.append(area)
        for item_data in sorted(area_data.get("items") or [], key=lambda row: row["sno"]):
            category = normalize_category(item_data.get("category"))
            if category is None:
                raise ValueError(f"Invalid assessment item category: {item_data.get('category')}")
            answers = normalize_allowed_checklist_items(item_data.get("allowed_checklist_items"))
            area.items.append(
                AssessmentChecklistItem(
                    sno=str(item_data["sno"]).strip(),
                    assessment_item=str(item_data["assessment_item"]).strip()[:ASSESSMENT_ITEM_MAX_LENGTH],
                    category=category,
                    base_score=QUESTION_BASE_SCORE_TOTAL,
                    allowed_checklist_items=answers,
                )
            )


def apply_risk_classification_ranges(
    template: AssessmentChecklistTemplate,
    ranges_payload: list[dict] | None,
    *,
    revalidate_existing: bool = False,
) -> None:
    question_count = _count_template_questions(template)
    if ranges_payload is not None:
        template.risk_classification_ranges = normalize_risk_classification_ranges(ranges_payload, question_count)
    elif revalidate_existing and template.risk_classification_ranges:
        template.risk_classification_ranges = normalize_risk_classification_ranges(
            template.risk_classification_ranges,
            question_count,
        )
    elif not template.risk_classification_ranges:
        template.risk_classification_ranges = default_risk_classification_ranges(question_count)


def create_template_from_scratch(
    db: Session,
    *,
    name: str,
    user_id: str,
    areas_payload: list[dict],
    risk_classification_ranges: list[dict] | None = None,
) -> AssessmentChecklistTemplate:
    if db.query(AssessmentChecklistTemplate.template_id).first():
        raise ValueError("Initial template must be created before additional templates can be cloned.")

    template = AssessmentChecklistTemplate(
        version_number=get_next_version_number(db),
        name=name.strip()[:ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH],
        status="DRAFT",
        is_active=False,
        source_template_id=None,
        created_by=user_id,
        modified_by=user_id,
    )
    db.add(template)
    db.flush()
    replace_template_areas(template, areas_payload)
    apply_risk_classification_ranges(template, risk_classification_ranges)
    return template


def clone_template(
    db: Session,
    *,
    source_template_id: str,
    name: str,
    user_id: str,
) -> AssessmentChecklistTemplate:
    source = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == source_template_id)
        .first()
    )
    if not source:
        raise LookupError("Source template not found")

    template = AssessmentChecklistTemplate(
        version_number=get_next_version_number(db),
        name=name.strip()[:ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH],
        status="DRAFT",
        is_active=False,
        source_template_id=source.template_id,
        created_by=user_id,
        modified_by=user_id,
        risk_classification_ranges=source.risk_classification_ranges,
    )
    db.add(template)
    db.flush()
    _copy_areas(source, template)
    apply_risk_classification_ranges(template, None, revalidate_existing=True)
    return template


def create_template_from_import(
    db: Session,
    *,
    name: str,
    user_id: str,
    areas_payload: list[dict],
    risk_classification_ranges: list[dict] | None = None,
) -> AssessmentChecklistTemplate:
    """Create a new DRAFT template from a validated import payload."""
    template = AssessmentChecklistTemplate(
        version_number=get_next_version_number(db),
        name=name.strip()[:ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH],
        status="DRAFT",
        is_active=False,
        source_template_id=None,
        created_by=user_id,
        modified_by=user_id,
    )
    db.add(template)
    db.flush()
    replace_template_areas(template, areas_payload)
    apply_risk_classification_ranges(template, risk_classification_ranges)
    return template


def activate_template(db: Session, template_id: str, user_id: str) -> AssessmentChecklistTemplate:
    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise LookupError("Template not found")
    if template.status not in {"DRAFT", "IN REVIEW", "EFFECTIVE"}:
        raise ValueError("Only DRAFT or IN REVIEW templates can be activated")
    if _count_template_questions(template, db) < 1:
        raise ValueError("Add at least one question before activating the checklist.")

    previously_active = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.is_active.is_(True))
        .all()
    )
    for row in previously_active:
        if row.template_id != template.template_id:
            row.is_active = False
            if row.status == "EFFECTIVE":
                row.status = "DEPRECATED"
            row.modified_by = user_id

    template.is_active = True
    template.status = "EFFECTIVE"
    template.modified_by = user_id
    return template


def deprecate_template(db: Session, template_id: str, user_id: str) -> AssessmentChecklistTemplate:
    template = (
        db.query(AssessmentChecklistTemplate)
        .filter(AssessmentChecklistTemplate.template_id == template_id)
        .first()
    )
    if not template:
        raise LookupError("Template not found")
    if template.status == "DEPRECATED":
        raise ValueError("Template is already deprecated")
    if not template.is_active:
        raise ValueError("Only the active template can be deprecated")
    template.is_active = False
    template.status = "DEPRECATED"
    template.modified_by = user_id
    return template


def serialize_template(template: AssessmentChecklistTemplate, db: Session, include_areas: bool = True) -> dict:
    creator_name = None
    if template.created_by:
        creator = db.query(User).filter(User.user_id == template.created_by).first()
        creator_name = creator.user_name if creator else None

    question_count = _count_template_questions(template, db) if include_areas else _count_template_questions(template, db)
    assessment_total_score = compute_assessment_total_score(question_count)
    risk_ranges = template.risk_classification_ranges
    if include_areas and not risk_ranges and question_count > 0:
        risk_ranges = default_risk_classification_ranges(question_count)

    payload = {
        "template_id": template.template_id,
        "version_number": template.version_number,
        "name": template.name,
        "status": template.status,
        "is_active": bool(template.is_active),
        "source_template_id": template.source_template_id,
        "created_by": template.created_by,
        "created_by_name": creator_name,
        "created_dt": template.created_dt.isoformat() if template.created_dt else None,
        "modified_by": template.modified_by,
        "modified_dt": template.modified_dt.isoformat() if template.modified_dt else None,
        "question_count": question_count,
        "assessment_total_score": assessment_total_score,
        "risk_classification_ranges": risk_ranges or [],
    }

    if include_areas:
        payload["areas"] = [
            {
                "area_id": area.area_id,
                "seq_no": area.seq_no,
                "title": area.title,
                "items": [
                    {
                        "item_id": item.item_id,
                        "sno": item.sno,
                        "assessment_item": item.assessment_item,
                        "category": item.category,
                        "allowed_checklist_items": normalize_allowed_checklist_items(
                            item.allowed_checklist_items,
                            fallback_penalty=item.penalty_factor if item.penalty_factor is not None else DEFAULT_PENALTY_FACTOR,
                        ),
                    }
                    for item in sorted(area.items, key=lambda row: row.sno)
                ],
            }
            for area in sorted(template.areas, key=lambda row: row.seq_no)
        ]

    return payload


def validate_status_update(current_status: str, new_status: str) -> str:
    normalized = normalize_status(new_status)
    if normalized is None:
        raise ValueError("Invalid template status")
    if template_is_locked(current_status) and normalized != current_status:
        raise ValueError("Only DRAFT or IN REVIEW templates can change status manually")
    return normalized


def template_is_locked(status: str) -> bool:
    return status in {"EFFECTIVE", "DEPRECATED"}


def _find_template_item(
    template: AssessmentChecklistTemplate, item_id: int
) -> tuple[AssessmentChecklistArea | None, AssessmentChecklistItem | None]:
    for area in template.areas:
        for item in area.items:
            if item.item_id == item_id:
                return area, item
    return None, None


def _find_template_area(template: AssessmentChecklistTemplate, area_id: int) -> AssessmentChecklistArea | None:
    for area in template.areas:
        if area.area_id == area_id:
            return area
    return None


def _apply_item_payload(item: AssessmentChecklistItem, item_payload: dict) -> None:
    category = normalize_category(item_payload.get("category"))
    if category is None:
        raise ValueError(f"Invalid assessment item category: {item_payload.get('category')}")
    answers = normalize_allowed_checklist_items(item_payload.get("allowed_checklist_items"))
    validate_question_answers(answers, str(item_payload.get("sno", item.sno)))
    item.sno = str(item_payload["sno"]).strip()
    item.assessment_item = str(item_payload["assessment_item"]).strip()[:ASSESSMENT_ITEM_MAX_LENGTH]
    item.category = category
    item.base_score = QUESTION_BASE_SCORE_TOTAL
    item.allowed_checklist_items = answers


def update_template_item(
    template: AssessmentChecklistTemplate,
    item_id: int,
    item_payload: dict,
) -> AssessmentChecklistItem:
    _, item = _find_template_item(template, item_id)
    if not item:
        raise LookupError("Question not found")
    _apply_item_payload(item, item_payload)
    return item


def add_template_area(template: AssessmentChecklistTemplate, title: str) -> AssessmentChecklistArea:
    next_seq = max((area.seq_no for area in template.areas), default=0) + 1
    area = AssessmentChecklistArea(
        template_id=template.template_id,
        seq_no=next_seq,
        title=str(title).strip()[:ASSESSMENT_AREA_TITLE_MAX_LENGTH] or f"Area {next_seq}",
    )
    template.areas.append(area)
    return area


def add_template_item(
    template: AssessmentChecklistTemplate,
    area_id: int,
    item_payload: dict,
) -> AssessmentChecklistItem:
    area = _find_template_area(template, area_id)
    if not area:
        raise LookupError("Assessment area not found")
    category = normalize_category(item_payload.get("category")) or "Governance"
    answers = normalize_allowed_checklist_items(item_payload.get("allowed_checklist_items") or [])
    sno = str(item_payload.get("sno") or f"{area.seq_no}.{len(area.items) + 1}").strip()
    if answers:
        validate_question_answers(answers, sno)
    item = AssessmentChecklistItem(
        sno=sno,
        assessment_item=str(item_payload.get("assessment_item", "")).strip()[:ASSESSMENT_ITEM_MAX_LENGTH],
        category=category,
        base_score=QUESTION_BASE_SCORE_TOTAL,
        allowed_checklist_items=answers,
    )
    area.items.append(item)
    return item


def update_template_settings(
    template: AssessmentChecklistTemplate,
    *,
    name: str | None = None,
    status: str | None = None,
    risk_classification_ranges: list[dict] | None = None,
    area_titles: list[dict] | None = None,
) -> None:
    if name is not None:
        template.name = name.strip()[:ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH]
    if status is not None:
        template.status = validate_status_update(template.status, status)
    if area_titles:
        for row in area_titles:
            area = _find_template_area(template, int(row["area_id"]))
            if not area:
                raise LookupError(f"Assessment area not found: {row.get('area_id')}")
            area.title = str(row["title"]).strip()[:ASSESSMENT_AREA_TITLE_MAX_LENGTH]
    if risk_classification_ranges is not None:
        apply_risk_classification_ranges(template, risk_classification_ranges)
    elif area_titles is not None:
        apply_risk_classification_ranges(template, None, revalidate_existing=True)
