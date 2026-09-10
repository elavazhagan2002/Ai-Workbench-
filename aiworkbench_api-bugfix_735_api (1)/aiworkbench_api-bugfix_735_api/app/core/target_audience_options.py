"""Allowed target audience type values for use cases."""

TARGET_AUDIENCE_TYPE_OPTIONS = (
    "Internal users",
    "Customers",
    "Partners",
    "Public",
)


def normalize_target_audience_types(value) -> list[str] | None:
    """Normalize and validate a list of target audience types."""
    if value in (None, ""):
        return None
    if not isinstance(value, list):
        raise ValueError("target_audience_type must be a list of audience type values.")

    normalized: list[str] = []
    for item in value:
        if item in (None, ""):
            continue
        if item not in TARGET_AUDIENCE_TYPE_OPTIONS:
            raise ValueError(
                f"Each target_audience_type value must be one of: {', '.join(TARGET_AUDIENCE_TYPE_OPTIONS)}"
            )
        if item not in normalized:
            normalized.append(item)
    return normalized or None
