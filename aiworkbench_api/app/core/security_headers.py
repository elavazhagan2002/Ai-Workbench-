"""Shared HTTP security header values for API responses."""

from __future__ import annotations

from app.core.config import settings

HSTS_MAX_AGE_SECONDS = 31_536_000  # 1 year

API_CONTENT_SECURITY_POLICY = (
    "default-src 'none'; "
    "frame-ancestors 'none'; "
    "base-uri 'none'; "
    "form-action 'none'; "
    "object-src 'none'"
)


def build_api_security_headers(*, include_hsts: bool | None = None) -> dict[str, str]:
    """Return security headers suitable for JSON API responses."""
    if include_hsts is None:
        include_hsts = settings.ENVIRONMENT == "production"

    headers = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
        "Content-Security-Policy": API_CONTENT_SECURITY_POLICY,
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "Pragma": "no-cache",
    }

    if include_hsts:
        headers["Strict-Transport-Security"] = f"max-age={HSTS_MAX_AGE_SECONDS}; includeSubDomains"

    return headers
