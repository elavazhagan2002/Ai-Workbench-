"""Allowed values for AI assessment checklist templates."""

ASSESSMENT_CHECKLIST_STATUSES = ("DRAFT", "IN REVIEW", "EFFECTIVE", "DEPRECATED")

ASSESSMENT_ITEM_CATEGORIES = (
    "Business",
    "Governance",
    "Legal & Compliance",
    "Technical",
    "Security & Data Privacy",
    "Operations",
)

RISK_CLASSIFICATION_LEVELS = ("Critical", "High", "Medium", "Low")

ASSESSMENT_ITEM_MAX_LENGTH = 500
ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH = 200
ASSESSMENT_AREA_TITLE_MAX_LENGTH = 200
ALLOWED_CHECKLIST_ITEM_MAX_LENGTH = 200
ALLOWED_CHECKLIST_ITEMS_MAX_COUNT = 25
QUESTION_BASE_SCORE_TOTAL = 1.0
DEFAULT_PENALTY_FACTOR = 1.0
BASE_SCORE_DECIMALS = 4


def normalize_status(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    normalized = str(value).strip().upper()
    if normalized not in ASSESSMENT_CHECKLIST_STATUSES:
        return None
    return normalized


def normalize_category(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    normalized = str(value).strip()
    if normalized not in ASSESSMENT_ITEM_CATEGORIES:
        return None
    return normalized


def normalize_penalty_factor(value) -> float:
    try:
        factor = float(value)
    except (TypeError, ValueError):
        raise ValueError("Penalty factor must be a number")
    if factor < 0:
        raise ValueError("Penalty factor must be zero or greater")
    return round(factor, 4)


def count_questions(areas_payload: list[dict]) -> int:
    return sum(len(area.get("items") or []) for area in areas_payload)


def compute_assessment_total_score(question_count: int) -> float:
    return round(question_count * QUESTION_BASE_SCORE_TOTAL, 2)


def normalize_question_answers(values, fallback_penalty: float = DEFAULT_PENALTY_FACTOR) -> list[dict]:
    """Normalize answer options with label and penalty factor only."""
    if values in (None, ""):
        return []
    if not isinstance(values, list):
        return []

    parsed: list[dict] = []
    seen: set[str] = set()

    for raw in values:
        if isinstance(raw, str):
            label = str(raw).strip()[:ALLOWED_CHECKLIST_ITEM_MAX_LENGTH]
            if not label:
                continue
            penalty = normalize_penalty_factor(fallback_penalty)
        elif isinstance(raw, dict):
            label = str(raw.get("label") or raw.get("text") or "").strip()[:ALLOWED_CHECKLIST_ITEM_MAX_LENGTH]
            if not label:
                continue
            try:
                penalty = normalize_penalty_factor(raw.get("penalty_factor", fallback_penalty))
            except ValueError:
                penalty = normalize_penalty_factor(fallback_penalty)
        else:
            continue

        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        parsed.append({"label": label, "penalty_factor": penalty})

    return parsed[:ALLOWED_CHECKLIST_ITEMS_MAX_COUNT]


def normalize_allowed_checklist_items(values, fallback_penalty: float = DEFAULT_PENALTY_FACTOR) -> list[dict]:
    return normalize_question_answers(values, fallback_penalty=fallback_penalty)


def validate_question_answers(answers: list[dict], question_sno: str) -> None:
    if not answers:
        raise ValueError(f"Question {question_sno} requires at least one answer option")


def validate_template_question_scores(areas_payload: list[dict]) -> None:
    for area_data in areas_payload:
        for item_data in area_data.get("items") or []:
            answers = normalize_question_answers(item_data.get("allowed_checklist_items"))
            validate_question_answers(answers, str(item_data.get("sno", "")))


def default_risk_classification_ranges(question_count: int) -> list[dict]:
    total = compute_assessment_total_score(question_count)
    if question_count <= 0 or total <= 0:
        return [
            {"level": level, "min_score": 0.0, "max_score": 0.0}
            for level in RISK_CLASSIFICATION_LEVELS
        ]

    quarter = round(total / 4, 2)
    half = round(total / 2, 2)
    three_quarter = round(total * 0.75, 2)
    step = round(1 / (10 ** BASE_SCORE_DECIMALS), BASE_SCORE_DECIMALS)
    return [
        {"level": "Critical", "min_score": 0.0, "max_score": quarter},
        {"level": "High", "min_score": round(quarter + step, BASE_SCORE_DECIMALS), "max_score": half},
        {"level": "Medium", "min_score": round(half + step, BASE_SCORE_DECIMALS), "max_score": three_quarter},
        {"level": "Low", "min_score": round(three_quarter + step, BASE_SCORE_DECIMALS), "max_score": total},
    ]


def normalize_risk_classification_ranges(ranges, question_count: int) -> list[dict]:
    if not ranges:
        return default_risk_classification_ranges(question_count)

    if not isinstance(ranges, list):
        raise ValueError("Risk classification ranges must be a list")

    normalized: list[dict] = []
    seen_levels: set[str] = set()
    for raw in ranges:
        if not isinstance(raw, dict):
            continue
        level = str(raw.get("level", "")).strip()
        if level not in RISK_CLASSIFICATION_LEVELS:
            raise ValueError(
                f"Risk level must be one of: {', '.join(RISK_CLASSIFICATION_LEVELS)}"
            )
        if level in seen_levels:
            raise ValueError(f"Duplicate risk level: {level}")
        seen_levels.add(level)
        min_score = round(float(raw.get("min_score", 0)), 2)
        max_score = round(float(raw.get("max_score", 0)), 2)
        normalized.append({"level": level, "min_score": min_score, "max_score": max_score})

    for level in RISK_CLASSIFICATION_LEVELS:
        if level not in seen_levels:
            raise ValueError(f"Missing risk classification level: {level}")

    normalized.sort(key=lambda row: RISK_CLASSIFICATION_LEVELS.index(row["level"]))
    validate_risk_classification_ranges(normalized, question_count)
    return normalized


def validate_risk_classification_ranges(ranges: list[dict], question_count: int) -> None:
    total = compute_assessment_total_score(question_count)
    if question_count <= 0:
        return

    previous_max = -0.01
    for row in ranges:
        level = row["level"]
        min_score = round(float(row["min_score"]), 2)
        max_score = round(float(row["max_score"]), 2)
        if min_score < 0 or max_score < 0:
            raise ValueError(f"{level} range cannot contain negative scores")
        if min_score > max_score:
            raise ValueError(f"{level} minimum score cannot exceed maximum score")
        if max_score > total:
            raise ValueError(
                f"{level} maximum score ({max_score}) exceeds assessment total ({total})"
            )
        if min_score < previous_max:
            raise ValueError("Risk classification ranges cannot overlap")
        previous_max = max_score

    if round(previous_max, 2) > total:
        raise ValueError(f"Risk ranges exceed assessment total score ({total})")


def parse_checklist_import_payload(raw) -> dict:
    """Validate and normalize an assessment checklist JSON import payload."""
    if not isinstance(raw, dict):
        raise ValueError("Import file must be a JSON object")

    name = str(raw.get("name") or "").strip()
    if not name:
        raise ValueError("Template name is required")
    if len(name) > ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH:
        raise ValueError(
            f"Template name cannot exceed {ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH} characters"
        )

    areas_raw = raw.get("areas")
    if not isinstance(areas_raw, list) or not areas_raw:
        raise ValueError("At least one assessment area is required")

    areas: list[dict] = []
    seen_area_seq: set[int] = set()
    seen_question_sno: set[str] = set()

    for area_index, area_raw in enumerate(areas_raw):
        if not isinstance(area_raw, dict):
            raise ValueError(f"Area at index {area_index} must be an object")
        try:
            seq_no = int(area_raw.get("seq_no"))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Area at index {area_index} requires a numeric seq_no") from exc
        if seq_no in seen_area_seq:
            raise ValueError(f"Duplicate area seq_no: {seq_no}")
        seen_area_seq.add(seq_no)

        title = str(area_raw.get("title") or "").strip()
        if not title:
            raise ValueError(f"Area {seq_no} requires a title")
        if len(title) > ASSESSMENT_AREA_TITLE_MAX_LENGTH:
            raise ValueError(f"Area {seq_no} title exceeds maximum length")

        items_raw = area_raw.get("items")
        if not isinstance(items_raw, list) or not items_raw:
            raise ValueError(f"Area {seq_no} ({title}) must include at least one question")

        items: list[dict] = []
        for item_index, item_raw in enumerate(items_raw):
            if not isinstance(item_raw, dict):
                raise ValueError(
                    f"Question at area {seq_no}, index {item_index} must be an object"
                )
            sno = str(item_raw.get("sno") or "").strip()
            if not sno:
                raise ValueError(
                    f"Question at area {seq_no}, index {item_index} requires sno"
                )
            if sno in seen_question_sno:
                raise ValueError(f"Duplicate question sno: {sno}")
            seen_question_sno.add(sno)

            assessment_item = str(item_raw.get("assessment_item") or "").strip()
            if not assessment_item:
                raise ValueError(f"Question {sno} requires assessment_item text")
            if len(assessment_item) > ASSESSMENT_ITEM_MAX_LENGTH:
                raise ValueError(f"Question {sno} text exceeds maximum length")

            category = normalize_category(item_raw.get("category"))
            if category is None:
                raise ValueError(
                    f"Question {sno} has invalid category. "
                    f"Must be one of: {', '.join(ASSESSMENT_ITEM_CATEGORIES)}"
                )

            try:
                answers = normalize_question_answers(item_raw.get("allowed_checklist_items"))
            except ValueError as exc:
                raise ValueError(f"Question {sno}: {exc}") from exc
            validate_question_answers(answers, sno)

            items.append(
                {
                    "sno": sno,
                    "assessment_item": assessment_item,
                    "category": category,
                    "allowed_checklist_items": answers,
                }
            )

        areas.append({"seq_no": seq_no, "title": title, "items": items})

    areas.sort(key=lambda row: row["seq_no"])
    question_count = count_questions(areas)
    if question_count <= 0:
        raise ValueError("Import must include at least one question")

    if raw.get("question_count") is not None:
        try:
            declared_count = int(raw["question_count"])
        except (TypeError, ValueError) as exc:
            raise ValueError("question_count must be a number") from exc
        if declared_count != question_count:
            raise ValueError(
                f"question_count ({declared_count}) does not match "
                f"actual questions ({question_count})"
            )

    if raw.get("assessment_total_score") is not None:
        try:
            declared_total = float(raw["assessment_total_score"])
        except (TypeError, ValueError) as exc:
            raise ValueError("assessment_total_score must be a number") from exc
        expected_total = compute_assessment_total_score(question_count)
        if round(declared_total, 2) != expected_total:
            raise ValueError(
                f"assessment_total_score ({declared_total}) does not match "
                f"expected total ({expected_total})"
            )

    risk_ranges = raw.get("risk_classification_ranges")
    normalized_ranges = None
    if risk_ranges is not None:
        if not isinstance(risk_ranges, list):
            raise ValueError("risk_classification_ranges must be an array")
        normalized_ranges = normalize_risk_classification_ranges(risk_ranges, question_count)

    return {
        "name": name,
        "areas": areas,
        "risk_classification_ranges": normalized_ranges,
        "question_count": question_count,
    }
