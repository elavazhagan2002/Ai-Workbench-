"""
Authentication middleware: JWT client token (Authorization header).
User session (cookie) is validated in get_current_user_id per-request.

Flow:
- All API endpoints (except public paths) require JWT access token
- User-specific endpoints also require session cookie (validated in get_current_user_id)
- signin endpoint requires JWT token but creates session cookie
"""

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.config import settings
from app.core.logging_config import logger
from app.core.security import verify_jwt_token
from app.core.session import get_user_id_from_session

# Paths that don't require JWT authentication
# signin and forgot-password require JWT (client-login first).
PUBLIC_PATHS = [
    "/",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/health",
    "/api/public",  # Marketing/landing data used before authentication
    "/api/auth/client-login",  # Handshake endpoint - no JWT required
    "/api/auth/refresh",  # Refresh endpoint - uses refresh token, not access token
    "/api/auth/public-stats",  # Login page showcase - domains/use cases counts
    "/api/auth/public-domains",  # Anonymous idea form - domain dropdown
    "/api/auth/public-organization-types",  # Self-registration form dropdown
    "/api/auth/check-username",  # Live username availability check
    "/api/auth/validate-password",  # Live password policy/strength feedback
    "/api/auth/self-register",  # Self-registration (rate limited)
    "/api/auth/anonymous-ideas",  # Anonymous idea submission (POST, rate limited)
    "/api/support/contact",  # Public contact support form
]


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware to validate JWT client token (Authorization header) for all API calls.
    User session is validated in get_current_user_id when routes need it.
    """

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        """Validate JWT client token for protected paths."""
        path = request.url.path

        # Skip authentication for public paths
        if any(path.startswith(public_path) for public_path in PUBLIC_PATHS):
            return await call_next(request)

        # Validate JWT client token (required for all API calls)
        authorization: str | None = request.headers.get("Authorization")
        jwt_token: str | None = None

        if authorization and authorization.startswith("Bearer "):
            jwt_token = authorization.split(" ")[1]

        if not jwt_token:
            logger.warning(f"Unauthorized access attempt: {path} | No JWT token provided")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Client authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Verify JWT token
        payload = verify_jwt_token(jwt_token)
        if not payload:
            logger.warning(f"Invalid or expired JWT token: {path}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired JWT token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Verify it's a client access token
        if payload.get("type") != "client_access":
            logger.warning(f"Invalid token type: {path}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
                headers={"WWW-Authenticate": "Bearer"},
            )

        logger.debug(f"Client-authenticated request: {path}")
        return await call_next(request)


def get_current_user_id(request: Request) -> str:
    """
    Get current user ID from session cookie.
    Use in user-specific routes (domains, audit, etc.).
    Reads cookie directly to avoid request.state propagation issues across middleware.
    """
    session_id = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not session_id:
        logger.warning(f"User endpoint without session cookie: {request.url.path}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User authentication required. Please sign in."
        )
    user_id = get_user_id_from_session(session_id)
    if not user_id:
        logger.warning(f"Invalid or expired session: {request.url.path}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid. Please sign in again."
        )
    return user_id
