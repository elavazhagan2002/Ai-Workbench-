# ===== NEW CODE START =====
"""
Redis-backed temporary storage for self-registration drafts.

Used by `app/api/v1/auth.py` to defer user creation until passcode verification.
"""

from __future__ import annotations

import json
from typing import TypedDict

from app.core.email_otp import normalize_email, redis_client
from app.core.logging_config import logger

REGISTER_DRAFT_TTL_SECONDS = 600  # 10 minutes


class RegisterDraft(TypedDict):
    user_name: str
    email: str
    password_hash: str
    organization: str
    organization_type: str
    interested_domain_id: str


def _k_register_draft(email_normalized: str) -> str:
    return f"register_draft:{email_normalized}"


def store_register_draft(email: str, draft: RegisterDraft, ttl_seconds: int = REGISTER_DRAFT_TTL_SECONDS) -> None:
    email_normalized = normalize_email(email)
    key = _k_register_draft(email_normalized)
    redis_client.setex(key, int(ttl_seconds), json.dumps(draft))


def load_register_draft(email: str) -> RegisterDraft | None:
    email_normalized = normalize_email(email)
    key = _k_register_draft(email_normalized)
    raw = redis_client.get(key)
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        return data  # type: ignore[return-value]
    except Exception as e:
        logger.warning(f"Failed to decode register draft for {email_normalized}: {e}")
        return None


def delete_register_draft(email: str) -> None:
    email_normalized = normalize_email(email)
    key = _k_register_draft(email_normalized)
    redis_client.delete(key)
