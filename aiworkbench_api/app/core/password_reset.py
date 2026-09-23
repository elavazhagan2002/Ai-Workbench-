"""
Redis-backed password reset token storage.

Forgot-password passcodes are verified separately. After a passcode succeeds,
the API issues a short-lived one-time reset token so the final password update
does not rely on an email-only "verified" flag.
"""
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from app.core.config import settings
from app.core.email_otp import normalize_email, redis_client

PASSWORD_RESET_TOKEN_EXPIRES_SECONDS = 600


def _now() -> int:
    return int(time.time())


def _k_token(token_hash: str) -> str:
    return f"password_reset:token:{token_hash}"


def _hash_token(token: str) -> str:
    secret = (settings.SECRET_KEY or settings.JWT_SECRET_KEY or "password-reset").encode("utf-8")
    message = f"password-reset:{token or ''}".encode()
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def issue_reset_token(email_normalized: str, user_id: str) -> str:
    """
    Store a one-time reset token and return the raw token to the API caller.
    Only the HMAC hash is persisted in Redis.
    """
    email_normalized = normalize_email(email_normalized)
    token = secrets.token_urlsafe(32)
    payload = {
        "email": email_normalized,
        "user_id": str(user_id or ""),
        "created_at": _now(),
        "expires_at": _now() + PASSWORD_RESET_TOKEN_EXPIRES_SECONDS,
    }
    redis_client.setex(
        _k_token(_hash_token(token)),
        PASSWORD_RESET_TOKEN_EXPIRES_SECONDS,
        json.dumps(payload, separators=(",", ":")),
    )
    return token


def consume_reset_token(email_normalized: str, token: str) -> dict[str, Any] | None:
    """
    Validate and consume a reset token for the email.
    Returns the stored payload on success; otherwise returns None.
    """
    email_normalized = normalize_email(email_normalized)
    token = (token or "").strip()
    if not email_normalized or not token:
        return None

    key = _k_token(_hash_token(token))
    raw = redis_client.get(key)
    if raw is None:
        return None

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        redis_client.delete(key)
        return None

    try:
        expires_at = int(payload.get("expires_at") or 0)
    except (TypeError, ValueError):
        redis_client.delete(key)
        return None
    if expires_at <= _now():
        redis_client.delete(key)
        return None

    payload_email = normalize_email(str(payload.get("email") or ""))
    if not hmac.compare_digest(payload_email, email_normalized):
        return None

    redis_client.delete(key)
    return payload
