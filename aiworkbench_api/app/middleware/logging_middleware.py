"""
Request/Response logging middleware.
"""
import json
import time
from collections.abc import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.logging_config import logger


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware to log all HTTP requests and responses.
    Excludes sensitive information from logs.
    """

    # Paths that should not be logged in detail
    EXCLUDED_PATHS = ["/docs", "/redoc", "/openapi.json", "/api/health"]

    # Paths that should never log request body (credentials / free-text support requests)
    NO_BODY_LOG_PATHS = [
        "/api/auth/signin",
        "/api/auth/client-login",
        "/api/auth/forgot-password",
        "/api/auth/forgot-password/verify-passcode",
        "/api/auth/reset-password",
        "/api/support/contact",
    ]

    # Headers to exclude from logging (sensitive)
    # Note: We'll log Authorization header presence (masked) for debugging
    SENSITIVE_HEADERS = {"cookie", "x-api-key", "x-api-secret"}

    # Request body fields to exclude from logging (sensitive)
    SENSITIVE_FIELDS = {
        "password", "pwd", "passwd", "pass", "user_password", "user_pwd",
        "secret", "client_secret", "api_secret", "secret_key",
        "token", "api_key", "access_token", "refresh_token", "auth_token",
        "apikey", "apisecret", "private_key", "privatekey", "private_key_data"
    }

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request and log details."""
        start_time = time.time()

        # Get request details
        method = request.method
        path = request.url.path
        query_params = dict(request.query_params)
        client_ip = request.client.host if request.client else "unknown"

        # Read request body if available (but never for auth endpoints)
        request_body = None
        should_log_body = path not in self.NO_BODY_LOG_PATHS

        if should_log_body and request.method in ["POST", "PUT", "PATCH"]:
            try:
                body = await request.body()
                if body:
                    # Try to parse as JSON
                    try:
                        request_body = json.loads(body.decode())
                        # Sanitize sensitive fields
                        request_body = self._sanitize_data(request_body)
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        request_body = "<non-json-body>"
            except Exception as e:
                logger.debug(f"Error reading request body: {str(e)}")
        elif path in self.NO_BODY_LOG_PATHS:
            request_body = "<auth-request-body-redacted>"

        # Get headers (excluding sensitive ones, but show Authorization header presence for debugging)
        headers = {}
        for k, v in request.headers.items():
            k_lower = k.lower()
            if k_lower == "authorization":
                # Log only presence of header; never log any token characters
                if v.startswith("Bearer "):
                    headers[k] = "Bearer ***"
                else:
                    headers[k] = "***REDACTED***"
            elif k_lower not in self.SENSITIVE_HEADERS:
                headers[k] = v

        # Log request
        should_log_detail = path not in self.EXCLUDED_PATHS
        if should_log_detail:
            logger.info(
                f"Request: {method} {path} | "
                f"IP: {client_ip} | "
                f"Query: {query_params if query_params else 'None'} | "
                f"Headers: {headers}"
            )
            if request_body:
                logger.debug(f"Request body: {json.dumps(request_body, default=str)}")
        else:
            logger.debug(f"Request: {method} {path} | IP: {client_ip}")

        # Process request
        try:
            response = await call_next(request)
        except Exception as e:
            logger.error(f"Request error: {method} {path} | Error: {str(e)}", exc_info=True)
            raise

        # Calculate processing time
        process_time = time.time() - start_time

        # Get response details
        status_code = response.status_code

        # Log response
        if should_log_detail:
            logger.info(
                f"Response: {method} {path} | "
                f"Status: {status_code} | "
                f"Time: {process_time:.3f}s"
            )
        else:
            logger.debug(
                f"Response: {method} {path} | "
                f"Status: {status_code} | "
                f"Time: {process_time:.3f}s"
            )

        # Add processing time header
        response.headers["X-Process-Time"] = str(process_time)

        return response

    def _sanitize_data(self, data: dict) -> dict:
        """
        Remove sensitive fields from data for logging.

        Args:
            data: Data dictionary to sanitize

        Returns:
            Sanitized data dictionary
        """
        if not isinstance(data, dict):
            return data

        sanitized = {}
        for key, value in data.items():
            key_lower = key.lower()
            # Check if key contains sensitive field name
            if any(sensitive in key_lower for sensitive in self.SENSITIVE_FIELDS):
                sanitized[key] = "***REDACTED***"
            elif isinstance(value, dict):
                sanitized[key] = self._sanitize_data(value)
            elif isinstance(value, list):
                sanitized[key] = [
                    self._sanitize_data(item) if isinstance(item, dict) else item
                    for item in value
                ]
            else:
                sanitized[key] = value

        return sanitized
