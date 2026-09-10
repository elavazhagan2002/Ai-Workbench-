"""AI category codes and labels for use cases."""

AI_CATEGORY_OPTIONS = {
    "P": "Predictive AI",
    "G": "Generative AI",
    "A": "Autonomous AI",
    "S": "Decision-Support",
}

AI_CATEGORY_CODES = tuple(AI_CATEGORY_OPTIONS.keys())

# Legacy codes from the previous taxonomy
LEGACY_AI_CATEGORY_MIGRATION = {
    "C": "P",  # Classical ML -> Predictive AI
    "D": "A",  # Deep Learning -> Autonomous AI
    "G": "G",  # Generative AI
    "H": "S",  # Hybrid -> Decision-Support
}


def normalize_ai_category(value: str | None) -> str | None:
    """Return a supported category code, migrating legacy values when needed."""
    if value is None:
        return None

    normalized = str(value).strip().upper()
    if not normalized:
        return None
    if normalized in AI_CATEGORY_OPTIONS:
        return normalized
    if normalized in LEGACY_AI_CATEGORY_MIGRATION:
        return LEGACY_AI_CATEGORY_MIGRATION[normalized]
    return None


def ai_category_label(value: str | None) -> str | None:
    """Resolve a category code (including legacy codes) to its display label."""
    if value is None:
        return None
    normalized = normalize_ai_category(value)
    if normalized:
        return AI_CATEGORY_OPTIONS[normalized]
    return None
