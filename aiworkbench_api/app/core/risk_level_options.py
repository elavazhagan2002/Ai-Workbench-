"""Allowed risk likelihood and impact levels."""

RISK_LEVELS = ("low", "medium", "high", "critical")


def normalize_risk_level(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    normalized = str(value).strip().lower()
    if normalized not in RISK_LEVELS:
        return None
    return normalized
