"""Validation helpers for impacted stakeholder entries on use cases."""

from app.core.field_limits import IMPACTED_STAKEHOLDER_MAX_LENGTH, IMPACTED_STAKEHOLDERS_MAX_COUNT


def normalize_impacted_stakeholders(value) -> list[str] | None:
    """Normalize free-text impacted stakeholder values entered like tags."""
    if value in (None, ""):
        return None
    if not isinstance(value, list):
        raise ValueError("impacted_stakeholders must be a list of strings.")

    normalized: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if not text:
            continue
        text = text[:IMPACTED_STAKEHOLDER_MAX_LENGTH]
        if text in normalized:
            continue
        normalized.append(text)
        if len(normalized) >= IMPACTED_STAKEHOLDERS_MAX_COUNT:
            break
    return normalized or None
