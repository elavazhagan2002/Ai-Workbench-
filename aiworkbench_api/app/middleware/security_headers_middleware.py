"""Attach standard security headers to every API response."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.security_headers import build_api_security_headers


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Apply OWASP-recommended security headers without overwriting route-specific values."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._default_headers = build_api_security_headers()

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        for name, value in self._default_headers.items():
            if name.lower() not in {k.lower() for k in response.headers}:
                response.headers[name] = value

        return response
