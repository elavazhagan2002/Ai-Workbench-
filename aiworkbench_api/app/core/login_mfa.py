"""
Redis-backed login MFA challenge storage.

This is intentionally separate from the registration OTP/draft flow.
"""
import hashlib
import hmac
import json
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from app.core.config import settings
from app.core.email_otp import redis_client

LOGIN_MFA_PASSCODE_LENGTH = 6
LOGIN_MFA_EXPIRES_SECONDS = 300
LOGIN_MFA_MAX_VERIFY_ATTEMPTS = 5
LOGIN_MFA_RESEND_COOLDOWN_SECONDS = 30
LOGIN_MFA_MAX_RESENDS = 3


IssueStatus = Literal["issued", "cooldown", "too_many_resends", "not_found", "expired"]
VerifyStatus = Literal["verified", "invalid", "expired", "not_found", "too_many_attempts"]
LoginMfaMethod = Literal["email_passcode", "totp"]


@dataclass
class LoginMfaIssue:
    status: IssueStatus
    challenge: dict[str, Any] | None = None
    passcode: str | None = None
    cooldown_remaining: int = 0


@dataclass
class LoginMfaVerify:
    status: VerifyStatus
    challenge: dict[str, Any] | None = None
    remaining_attempts: int = 0


def _now() -> int:
    return int(time.time())


def _k_challenge(challenge_id: str) -> str:
    return f"login_mfa:challenge:{challenge_id}"


def _ip_key_part(ip_address: str) -> str:
    return hashlib.sha256((ip_address or "unknown").encode("utf-8")).hexdigest()


def _k_user_ip(user_id: str, ip_address: str) -> str:
    return f"login_mfa:user:{user_id}:{_ip_key_part(ip_address)}"


def _generate_passcode() -> str:
    return f"{secrets.randbelow(10 ** LOGIN_MFA_PASSCODE_LENGTH):0{LOGIN_MFA_PASSCODE_LENGTH}d}"


def _hash_passcode(passcode: str) -> str:
    secret = (settings.SECRET_KEY or settings.JWT_SECRET_KEY or "login-mfa").encode("utf-8")
    message = f"login-mfa:{passcode or ''}".encode()
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def _ttl_for(challenge_id: str) -> int:
    ttl = redis_client.ttl(_k_challenge(challenge_id))
    try:
        return int(ttl)
    except (TypeError, ValueError):
        return -2


def _save_challenge(challenge: dict[str, Any], ttl_seconds: int) -> None:
    challenge_id = str(challenge["challenge_id"])
    user_id = str(challenge["user_id"])
    ip_address = str(challenge["ip_address"])
    payload = json.dumps(challenge, separators=(",", ":"))
    pipe = redis_client.pipeline()
    pipe.setex(_k_challenge(challenge_id), ttl_seconds, payload)
    pipe.setex(_k_user_ip(user_id, ip_address), ttl_seconds, challenge_id)
    pipe.execute()


def load_login_challenge(challenge_id: str) -> dict[str, Any] | None:
    challenge_id = (challenge_id or "").strip()
    if not challenge_id:
        return None

    raw = redis_client.get(_k_challenge(challenge_id))
    if raw is None:
        return None

    ttl = _ttl_for(challenge_id)
    if ttl <= 0:
        consume_login_challenge(challenge_id)
        return None

    try:
        challenge = json.loads(raw)
    except json.JSONDecodeError:
        redis_client.delete(_k_challenge(challenge_id))
        return None

    if int(challenge.get("expires_at") or 0) <= _now():
        consume_login_challenge(challenge_id, challenge)
        return None

    return challenge


def consume_login_challenge(challenge_id: str, challenge: dict[str, Any] | None = None) -> None:
    challenge_id = (challenge_id or "").strip()
    if not challenge_id:
        return

    if challenge is None:
        raw = redis_client.get(_k_challenge(challenge_id))
        if raw:
            try:
                challenge = json.loads(raw)
            except json.JSONDecodeError:
                challenge = None

    keys = [_k_challenge(challenge_id)]
    if challenge:
        keys.append(_k_user_ip(str(challenge.get("user_id") or ""), str(challenge.get("ip_address") or "")))
    redis_client.delete(*keys)


def _rotate_challenge_passcode(challenge: dict[str, Any]) -> LoginMfaIssue:
    now = _now()
    challenge_id = str(challenge.get("challenge_id") or "")
    ttl = _ttl_for(challenge_id)
    if ttl <= 0:
        consume_login_challenge(challenge_id, challenge)
        return LoginMfaIssue(status="expired", challenge=challenge)

    last_sent_at = int(challenge.get("last_sent_at") or 0)
    cooldown_remaining = LOGIN_MFA_RESEND_COOLDOWN_SECONDS - (now - last_sent_at)
    if cooldown_remaining > 0:
        return LoginMfaIssue(
            status="cooldown",
            challenge=challenge,
            cooldown_remaining=cooldown_remaining,
        )

    resend_count = int(challenge.get("resend_count") or 0)
    if resend_count >= LOGIN_MFA_MAX_RESENDS:
        return LoginMfaIssue(status="too_many_resends", challenge=challenge)

    passcode = _generate_passcode()
    challenge["method"] = "email_passcode"
    challenge["passcode_hash"] = _hash_passcode(passcode)
    challenge["last_sent_at"] = now
    challenge["resend_count"] = resend_count + 1
    challenge["expires_at"] = now + LOGIN_MFA_EXPIRES_SECONDS
    _save_challenge(challenge, LOGIN_MFA_EXPIRES_SECONDS)
    return LoginMfaIssue(status="issued", challenge=challenge, passcode=passcode)


def create_login_challenge(
    user_id: str,
    email: str,
    ip_address: str,
    method: LoginMfaMethod = "email_passcode",
) -> LoginMfaIssue:
    existing_challenge_id = redis_client.get(_k_user_ip(user_id, ip_address))
    if existing_challenge_id:
        existing = load_login_challenge(existing_challenge_id)
        if existing:
            existing_method = existing.get("method") or "email_passcode"
            if method == "totp" and existing_method == "totp":
                return LoginMfaIssue(status="issued", challenge=existing)
            if method == "email_passcode":
                return ensure_email_passcode(existing)
            consume_login_challenge(str(existing.get("challenge_id") or ""), existing)

    now = _now()
    challenge_id = str(uuid.uuid4())
    challenge: dict[str, Any] = {
        "challenge_id": challenge_id,
        "user_id": user_id,
        "email": (email or "").strip().lower(),
        "ip_address": ip_address,
        "method": method,
        "passcode_hash": "",
        "created_at": now,
        "expires_at": now + LOGIN_MFA_EXPIRES_SECONDS,
        "attempts": 0,
        "last_sent_at": 0,
        "resend_count": 0,
    }
    passcode = None
    if method == "email_passcode":
        passcode = _generate_passcode()
        challenge["passcode_hash"] = _hash_passcode(passcode)
        challenge["last_sent_at"] = now
    _save_challenge(challenge, LOGIN_MFA_EXPIRES_SECONDS)
    return LoginMfaIssue(status="issued", challenge=challenge, passcode=passcode)


def ensure_email_passcode(challenge: dict[str, Any]) -> LoginMfaIssue:
    """Issue or rotate an email passcode on an existing challenge."""
    now = _now()
    challenge_id = str(challenge.get("challenge_id") or "")
    ttl = _ttl_for(challenge_id)
    if ttl <= 0:
        consume_login_challenge(challenge_id, challenge)
        return LoginMfaIssue(status="expired", challenge=challenge)

    already_email = (challenge.get("method") or "email_passcode") == "email_passcode" and bool(challenge.get("passcode_hash"))
    if already_email:
        return _rotate_challenge_passcode(challenge)

    passcode = _generate_passcode()
    challenge["method"] = "email_passcode"
    challenge["passcode_hash"] = _hash_passcode(passcode)
    challenge["last_sent_at"] = now
    challenge["expires_at"] = now + LOGIN_MFA_EXPIRES_SECONDS
    _save_challenge(challenge, LOGIN_MFA_EXPIRES_SECONDS)
    return LoginMfaIssue(status="issued", challenge=challenge, passcode=passcode)


def set_challenge_method_totp(challenge: dict[str, Any]) -> dict[str, Any] | None:
    challenge_id = str(challenge.get("challenge_id") or "")
    ttl = _ttl_for(challenge_id)
    if ttl <= 0:
        consume_login_challenge(challenge_id, challenge)
        return None
    challenge["method"] = "totp"
    _save_challenge(challenge, ttl)
    return challenge


def record_login_challenge_failure(challenge: dict[str, Any]) -> LoginMfaVerify:
    challenge_id = str(challenge.get("challenge_id") or "")
    attempts = int(challenge.get("attempts") or 0) + 1
    challenge["attempts"] = attempts
    remaining_attempts = max(0, LOGIN_MFA_MAX_VERIFY_ATTEMPTS - attempts)
    if attempts >= LOGIN_MFA_MAX_VERIFY_ATTEMPTS:
        consume_login_challenge(challenge_id, challenge)
        return LoginMfaVerify(
            status="too_many_attempts",
            challenge=challenge,
            remaining_attempts=remaining_attempts,
        )
    ttl = _ttl_for(challenge_id)
    if ttl <= 0:
        consume_login_challenge(challenge_id, challenge)
        return LoginMfaVerify(status="expired", challenge=challenge)
    _save_challenge(challenge, ttl)
    return LoginMfaVerify(status="invalid", challenge=challenge, remaining_attempts=remaining_attempts)


def resend_login_challenge(challenge_id: str) -> LoginMfaIssue:
    challenge = load_login_challenge(challenge_id)
    if not challenge:
        return LoginMfaIssue(status="not_found")
    return _rotate_challenge_passcode(challenge)


def verify_login_challenge(challenge_id: str, passcode: str) -> LoginMfaVerify:
    challenge = load_login_challenge(challenge_id)
    if not challenge:
        return LoginMfaVerify(status="not_found")

    challenge_id = str(challenge["challenge_id"])
    attempts = int(challenge.get("attempts") or 0)
    if attempts >= LOGIN_MFA_MAX_VERIFY_ATTEMPTS:
        consume_login_challenge(challenge_id, challenge)
        return LoginMfaVerify(status="too_many_attempts", challenge=challenge)

    passcode_hash = _hash_passcode((passcode or "").strip())
    if hmac.compare_digest(str(challenge.get("passcode_hash") or ""), passcode_hash):
        consume_login_challenge(challenge_id, challenge)
        return LoginMfaVerify(status="verified", challenge=challenge)

    attempts += 1
    challenge["attempts"] = attempts
    remaining_attempts = max(0, LOGIN_MFA_MAX_VERIFY_ATTEMPTS - attempts)
    if attempts >= LOGIN_MFA_MAX_VERIFY_ATTEMPTS:
        consume_login_challenge(challenge_id, challenge)
        return LoginMfaVerify(
            status="too_many_attempts",
            challenge=challenge,
            remaining_attempts=remaining_attempts,
        )

    ttl = _ttl_for(challenge_id)
    if ttl <= 0:
        consume_login_challenge(challenge_id, challenge)
        return LoginMfaVerify(status="expired", challenge=challenge)

    _save_challenge(challenge, ttl)
    return LoginMfaVerify(
        status="invalid",
        challenge=challenge,
        remaining_attempts=remaining_attempts,
    )
