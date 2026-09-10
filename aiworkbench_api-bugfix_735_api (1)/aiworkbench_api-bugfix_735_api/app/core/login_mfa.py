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

from redis.exceptions import RedisError

from app.core.config import settings
from app.core.email_otp import redis_client
from app.core.logging_config import logger


class _MemoryRedisFallback:
    def __init__(self):
        self._data = {}

    def get(self, key):
        entry = self._data.get(key)
        if entry is None:
            return None
        expires_at = entry.get("expires_at")
        if expires_at is not None and expires_at <= time.time():
            self._data.pop(key, None)
            return None
        return entry["value"]

    def setex(self, key, ttl_seconds, value):
        self._data[key] = {"value": value, "expires_at": time.time() + max(int(ttl_seconds), 0)}
        return True

    def delete(self, *keys):
        for key in keys:
            self._data.pop(key, None)
        return True

    def ttl(self, key):
        entry = self._data.get(key)
        if entry is None:
            return -2
        remaining = int(entry["expires_at"] - time.time())
        return max(remaining, -1)

    def pipeline(self):
        class _Pipeline:
            def __init__(self, store):
                self._store = store
                self._ops = []

            def setex(self, key, ttl_seconds, value):
                self._ops.append(("setex", key, ttl_seconds, value))
                return self

            def execute(self):
                for op, key, ttl_seconds, value in self._ops:
                    if op == "setex":
                        self._store.setex(key, ttl_seconds, value)
                self._ops.clear()
                return []

        return _Pipeline(self)


try:
    redis_client.ping()
except Exception:
    redis_client = _MemoryRedisFallback()


LOGIN_MFA_PASSCODE_LENGTH = 6
LOGIN_MFA_EXPIRES_SECONDS = 300
LOGIN_MFA_MAX_VERIFY_ATTEMPTS = 5
LOGIN_MFA_RESEND_COOLDOWN_SECONDS = 30
LOGIN_MFA_MAX_RESENDS = 3


IssueStatus = Literal["issued", "cooldown", "too_many_resends", "not_found", "expired", "unavailable"]
VerifyStatus = Literal["verified", "invalid", "expired", "not_found", "too_many_attempts"]


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
    try:
        ttl = redis_client.ttl(_k_challenge(challenge_id))
    except RedisError as exc:
        logger.warning("Redis unavailable while reading login MFA TTL: %s", exc)
        return -3
    try:
        return int(ttl)
    except (TypeError, ValueError):
        return -2


def _save_challenge(challenge: dict[str, Any], ttl_seconds: int) -> None:
    challenge_id = str(challenge["challenge_id"])
    user_id = str(challenge["user_id"])
    ip_address = str(challenge["ip_address"])
    payload = json.dumps(challenge, separators=(",", ":"))
    try:
        pipe = redis_client.pipeline()
        pipe.setex(_k_challenge(challenge_id), ttl_seconds, payload)
        pipe.setex(_k_user_ip(user_id, ip_address), ttl_seconds, challenge_id)
        pipe.execute()
    except RedisError as exc:
        logger.warning("Redis unavailable while saving login MFA challenge: %s", exc)
        raise


def load_login_challenge(challenge_id: str) -> dict[str, Any] | None:
    challenge_id = (challenge_id or "").strip()
    if not challenge_id:
        return None

    try:
        raw = redis_client.get(_k_challenge(challenge_id))
    except RedisError as exc:
        logger.warning("Redis unavailable while loading login MFA challenge: %s", exc)
        return None
    if raw is None:
        return None

    ttl = _ttl_for(challenge_id)
    if ttl <= 0:
        consume_login_challenge(challenge_id)
        return None

    try:
        challenge = json.loads(raw)
    except json.JSONDecodeError:
        try:
            redis_client.delete(_k_challenge(challenge_id))
        except RedisError as exc:
            logger.warning("Redis unavailable while deleting invalid login MFA challenge: %s", exc)
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
        try:
            raw = redis_client.get(_k_challenge(challenge_id))
        except RedisError as exc:
            logger.warning("Redis unavailable while consuming login MFA challenge: %s", exc)
            return
        if raw:
            try:
                challenge = json.loads(raw)
            except json.JSONDecodeError:
                challenge = None

    keys = [_k_challenge(challenge_id)]
    if challenge:
        keys.append(_k_user_ip(str(challenge.get("user_id") or ""), str(challenge.get("ip_address") or "")))
    try:
        redis_client.delete(*keys)
    except RedisError as exc:
        logger.warning("Redis unavailable while deleting login MFA challenge keys: %s", exc)


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
    challenge["passcode_hash"] = _hash_passcode(passcode)
    challenge["last_sent_at"] = now
    challenge["resend_count"] = resend_count + 1
    challenge["expires_at"] = now + LOGIN_MFA_EXPIRES_SECONDS
    _save_challenge(challenge, LOGIN_MFA_EXPIRES_SECONDS)
    return LoginMfaIssue(status="issued", challenge=challenge, passcode=passcode)


def create_login_challenge(user_id: str, email: str, ip_address: str) -> LoginMfaIssue:
    try:
        existing_challenge_id = redis_client.get(_k_user_ip(user_id, ip_address))
    except RedisError as exc:
        logger.warning("Redis unavailable while creating login MFA challenge: %s", exc)
        return LoginMfaIssue(status="unavailable")

    if existing_challenge_id:
        existing = load_login_challenge(existing_challenge_id)
        if existing:
            return _rotate_challenge_passcode(existing)

    now = _now()
    challenge_id = str(uuid.uuid4())
    passcode = _generate_passcode()
    challenge = {
        "challenge_id": challenge_id,
        "user_id": user_id,
        "email": (email or "").strip().lower(),
        "ip_address": ip_address,
        "passcode_hash": _hash_passcode(passcode),
        "created_at": now,
        "expires_at": now + LOGIN_MFA_EXPIRES_SECONDS,
        "attempts": 0,
        "last_sent_at": now,
        "resend_count": 0,
    }
    try:
        _save_challenge(challenge, LOGIN_MFA_EXPIRES_SECONDS)
    except RedisError as exc:
        logger.warning("Redis unavailable while saving newly created login MFA challenge: %s", exc)
        return LoginMfaIssue(status="unavailable")
    return LoginMfaIssue(status="issued", challenge=challenge, passcode=passcode)


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
