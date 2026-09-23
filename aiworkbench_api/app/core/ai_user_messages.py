"""User-facing messages for AI service failures."""

from __future__ import annotations

AI_SERVICES_UNAVAILABLE_MESSAGE = (
    "AI services are unavailable at this point. Please try again later."
)
AI_STRUCTURED_OUTPUT_FAILED_MESSAGE = (
    "The AI model did not return a usable checklist response. Try AI Pre-fill again. "
    "If this continues, increase Max tokens in Admin Settings → LLM Settings."
)
AI_CONTENT_FILTER_MESSAGE = (
    "The AI provider blocked this request. Try AI Pre-fill again after reviewing "
    "the use case documentation for sensitive content."
)
AI_CONNECTION_DROPPED_MESSAGE = (
    "The AI provider closed the connection before finishing. Try AI Pre-fill again."
)
AI_PROVIDER_TIMEOUT_MESSAGE = (
    "The AI provider timed out before finishing. Try AI Pre-fill again."
)

_USER_SAFE_AI_ERROR_DETAILS = frozenset(
    {
        "The AI provider returned text that exceeded the allowed field length. "
        "Please shorten the source text and try again.",
        AI_STRUCTURED_OUTPUT_FAILED_MESSAGE,
        AI_CONTENT_FILTER_MESSAGE,
        AI_CONNECTION_DROPPED_MESSAGE,
        AI_PROVIDER_TIMEOUT_MESSAGE,
    }
)

_TECHNICAL_AI_ERROR_MARKERS = (
    "http ",
    "api key",
    "openai",
    "provider",
    "llm",
    "incorrect api",
    "verify the configured",
    "timed out contacting",
    "rejected the request",
    "connectivity",
    "misconfigured",
    "unexpected error while",
)


def user_facing_ai_error_detail(*, detail: str, status_code: int) -> str:
    """Return a safe client-facing message while preserving actionable validation errors."""
    normalized = detail.strip()
    if not normalized:
        return AI_SERVICES_UNAVAILABLE_MESSAGE
    if normalized in _USER_SAFE_AI_ERROR_DETAILS:
        return normalized
    if status_code == 400:
        return normalized

    lowered = normalized.lower()
    if any(marker in lowered for marker in _TECHNICAL_AI_ERROR_MARKERS):
        return AI_SERVICES_UNAVAILABLE_MESSAGE
    if status_code >= 500 or status_code in {401, 402, 403, 429, 502, 503, 504}:
        return AI_SERVICES_UNAVAILABLE_MESSAGE
    return AI_SERVICES_UNAVAILABLE_MESSAGE
