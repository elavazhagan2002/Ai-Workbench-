"""
Authenticator-app TOTP helpers for login MFA.

Secrets are encrypted at rest. A pending secret is stored until the user
confirms a live code; only then is TOTP treated as enabled.
"""
from __future__ import annotations

import base64
import hashlib
import io
from typing import Any

import pyotp
import qrcode
from cryptography.fernet import Fernet, InvalidToken
from qrcode.image.svg import SvgPathImage

from app.core.config import settings
from app.core.logging_config import logger

TOTP_ISSUER = "SCIAGEN"
TOTP_VALID_WINDOW = 1
TOTP_DIGITS = 6


def _fernet() -> Fernet:
    digest = hashlib.sha256((settings.SECRET_KEY or "sciagen-totp").encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def generate_secret() -> str:
    return pyotp.random_base32()


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt((secret or "").encode("utf-8")).decode("ascii")


def decrypt_secret(payload: str | None) -> str | None:
    raw = (payload or "").strip()
    if not raw:
        return None
    try:
        return _fernet().decrypt(raw.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        logger.warning("Failed to decrypt a stored TOTP secret")
        return None


def provisioning_uri(secret: str, email: str) -> str:
    totp = pyotp.TOTP(secret, digits=TOTP_DIGITS)
    account = (email or "user").strip() or "user"
    return totp.provisioning_uri(name=account, issuer_name=TOTP_ISSUER)


def qr_data_uri(otpauth_url: str) -> str:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=6, border=2)
    qr.add_data(otpauth_url)
    qr.make(fit=True)
    image = qr.make_image(image_factory=SvgPathImage)
    buffer = io.BytesIO()
    image.save(buffer)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def verify_code(secret: str | None, code: str) -> bool:
    normalized = "".join(ch for ch in (code or "") if ch.isdigit())
    if not secret or len(normalized) != TOTP_DIGITS:
        return False
    try:
        totp = pyotp.TOTP(secret, digits=TOTP_DIGITS)
        return bool(totp.verify(normalized, valid_window=TOTP_VALID_WINDOW))
    except Exception:
        logger.debug("TOTP verification raised", exc_info=True)
        return False


def user_totp_enabled(user: Any) -> bool:
    return bool(getattr(user, "totp_enabled", False) and getattr(user, "totp_secret", None))


def user_totp_setup_suggested(user: Any) -> bool:
    if user_totp_enabled(user):
        return False
    return not bool(getattr(user, "totp_prompt_seen", False))
