"""
Redis-backed Email OTP service.

This module exposes functions used by `app/api/v1/auth.py`.
Function names and signatures must remain unchanged for compatibility.
"""



import secrets

import redis

from app.core.config import settings
from app.core.logging_config import logger

OTP_LENGTH = 6
OTP_EXPIRES_SECONDS = 300
OTP_MAX_VERIFY_ATTEMPTS = 5
OTP_SEND_MAX_PER_WINDOW = 3
OTP_SEND_WINDOW_SECONDS = 600
VERIFIED_EXPIRES_SECONDS = 600
_ATTEMPT_TTL_GRACE_SECONDS = 60


redis_client = redis.Redis(
    host=settings.REDIS_HOST,
    port=settings.REDIS_PORT,
    db=settings.REDIS_DB,
    password=settings.REDIS_PASSWORD,
    decode_responses=True,
    socket_connect_timeout=2,
    socket_timeout=2,
    retry_on_timeout=True,
)

# ===== NEW CODE START =====
# Redis connection validation (non-fatal)
try:
    redis_client.ping()
    logger.info("Redis connection successful (email OTP)")
except Exception as e:
    logger.warning(f"Redis connection failed (email OTP): {e}")
# ===== NEW CODE END =====


def _k_otp(email_normalized: str) -> str:
    return f"otp:{email_normalized}"


def _k_attempt(email_normalized: str) -> str:
    return f"otp_attempt:{email_normalized}"


def _k_send(email_normalized: str) -> str:
    return f"otp_send:{email_normalized}"


def _k_verified(email_normalized: str) -> str:
    return f"verified:{email_normalized}"


def _generate_otp() -> str:
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"
# ===== NEW CODE END =====


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def check_send_rate_limit(email_normalized: str) -> None:
    """
    Max 3 OTP sends per email per 10 minutes.
    Uses Redis INCR with a TTL window.
    """
    # ===== MODIFIED CODE START =====
    email_normalized = normalize_email(email_normalized)
    key = _k_send(email_normalized)
    count = int(redis_client.incr(key))
    if count == 1:
        redis_client.expire(key, OTP_SEND_WINDOW_SECONDS)
    if count > OTP_SEND_MAX_PER_WINDOW:
        raise ValueError("OTP send rate limit exceeded")
    # ===== MODIFIED CODE END =====


def issue_otp(email_normalized: str) -> str:
    """
    Generates a secure 6-digit OTP and stores it in Redis with TTL.
    Also resets the attempt counter for this email.
    """
    # ===== MODIFIED CODE START =====
    email_normalized = normalize_email(email_normalized)
    otp = _generate_otp()
    otp_key = _k_otp(email_normalized)
    attempt_key = _k_attempt(email_normalized)

    pipe = redis_client.pipeline()
    pipe.setex(otp_key, OTP_EXPIRES_SECONDS, otp)
    # Keep attempts key slightly longer than OTP so we can distinguish "expired" vs "not_found"
    pipe.setex(attempt_key, OTP_EXPIRES_SECONDS + _ATTEMPT_TTL_GRACE_SECONDS, 0)
    pipe.execute()
    return otp
    # ===== MODIFIED CODE END =====


def revoke_otp(email_normalized: str) -> None:
    """Deletes OTP + attempts keys for the email."""
    # ===== MODIFIED CODE START =====
    email_normalized = normalize_email(email_normalized)
    redis_client.delete(_k_otp(email_normalized), _k_attempt(email_normalized))
    # ===== MODIFIED CODE END =====


def verify_otp(email_normalized: str, otp: str) -> str:
    """
    Verification order:
    1) Check OTP exists
    2) Check expiration (via TTL)
    3) Track attempts
    4) Compare via secrets.compare_digest
    5) On success: delete OTP + attempts, set verified flag (TTL 10 min)
    6) On failure: increment attempts
    """
    # ===== MODIFIED CODE START =====
    email_normalized = normalize_email(email_normalized)
    otp_input = (otp or "").strip()

    otp_key = _k_otp(email_normalized)
    attempt_key = _k_attempt(email_normalized)
    verified_key = _k_verified(email_normalized)

    pipe = redis_client.pipeline()
    pipe.get(otp_key)
    pipe.ttl(otp_key)
    pipe.get(attempt_key)
    stored_otp, ttl, attempts_raw = pipe.execute()

    if stored_otp is None:
        # If attempts key exists, an OTP likely existed but expired (TTL cleanup already removed otp:{email})
        return "expired" if redis_client.exists(attempt_key) else "not_found"

    # TTL should always be present; if not, treat as expired/misconfigured and cleanup.
    if ttl is None or int(ttl) <= 0:
        redis_client.delete(otp_key, attempt_key)
        return "expired"

    attempts = int(attempts_raw or 0)
    if attempts >= OTP_MAX_VERIFY_ATTEMPTS:
        redis_client.delete(otp_key, attempt_key)
        return "too_many_attempts"

    if secrets.compare_digest(str(stored_otp), otp_input):
        success_pipe = redis_client.pipeline()
        success_pipe.delete(otp_key, attempt_key)
        success_pipe.setex(verified_key, VERIFIED_EXPIRES_SECONDS, "1")
        success_pipe.execute()
        return "verified"

    new_attempts = int(redis_client.incr(attempt_key))
    if new_attempts == 1:
        # Safety: if the attempts key didn't exist (unexpected), align its TTL to the OTP window.
        redis_client.expire(attempt_key, OTP_EXPIRES_SECONDS + _ATTEMPT_TTL_GRACE_SECONDS)
    if new_attempts >= OTP_MAX_VERIFY_ATTEMPTS:
        redis_client.delete(otp_key, attempt_key)
        return "too_many_attempts"
    return "invalid"
    # ===== MODIFIED CODE END =====


def is_verified(email_normalized: str) -> bool:
    # ===== MODIFIED CODE START =====
    email_normalized = normalize_email(email_normalized)
    return redis_client.get(_k_verified(email_normalized)) is not None
    # ===== MODIFIED CODE END =====


def consume_verification(email_normalized: str) -> None:
    """Remove verified flag after successful registration to prevent reuse."""
    # ===== MODIFIED CODE START =====
    email_normalized = normalize_email(email_normalized)
    redis_client.delete(_k_verified(email_normalized))
    # ===== MODIFIED CODE END =====


def remaining_verify_attempts(email_normalized: str) -> int:
    # ===== MODIFIED CODE START =====
    email_normalized = normalize_email(email_normalized)
    if redis_client.get(_k_otp(email_normalized)) is None:
        return 0
    attempts_raw = redis_client.get(_k_attempt(email_normalized))
    attempts = int(attempts_raw or 0)
    return max(0, OTP_MAX_VERIFY_ATTEMPTS - attempts)
    # ===== MODIFIED CODE END =====
