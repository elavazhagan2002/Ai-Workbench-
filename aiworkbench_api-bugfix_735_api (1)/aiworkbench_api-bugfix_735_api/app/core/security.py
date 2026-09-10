"""
Security utilities for password hashing, client credentials, and JWT tokens.
User authentication is now session-based (see app.core.session).

Password hashing uses PBKDF2-HMAC-SHA256 from the Python standard library.
Hashes are portable across machines/OS (no native bcrypt binary dependency).
Stored format: pbkdf2_sha256$<iterations>$<salt_b64>$<digest_b64>
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Any

import jwt
from jwt.exceptions import PyJWTError

from .config import settings
from .logging_config import logger

# Portable password hash parameters (stdlib only; identical on every machine).
_PBKDF2_ALGORITHM = "sha256"
_PBKDF2_PREFIX = "pbkdf2_sha256"
_PBKDF2_ITERATIONS = 260_000
_PBKDF2_SALT_BYTES = 16
_PBKDF2_DKLEN = 32


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _pbkdf2_digest(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac(
        _PBKDF2_ALGORITHM,
        password.encode("utf-8"),
        salt,
        iterations,
        dklen=_PBKDF2_DKLEN,
    )


def get_password_hash(password: str) -> str:
    """
    Hash a password with PBKDF2-HMAC-SHA256 (stdlib; machine-independent).

    Args:
        password: Plain text password to hash

    Returns:
        Encoded hash string including algorithm, iterations, salt, and digest

    Raises:
        ValueError: If password is empty or hashing fails
    """
    if not password:
        raise ValueError("Password cannot be empty")

    try:
        salt = secrets.token_bytes(_PBKDF2_SALT_BYTES)
        digest = _pbkdf2_digest(password, salt, _PBKDF2_ITERATIONS)
        return (
            f"{_PBKDF2_PREFIX}${_PBKDF2_ITERATIONS}$"
            f"{_b64encode(salt)}${_b64encode(digest)}"
        )
    except Exception as e:
        logger.error(f"Unexpected password hashing error: {e}")
        raise ValueError("Failed to hash password. Please try again.") from e


def _verify_pbkdf2_password(plain_password: str, hashed_password: str) -> bool:
    try:
        algorithm, iterations_s, salt_b64, digest_b64 = hashed_password.split("$", 3)
    except ValueError:
        return False

    if algorithm != _PBKDF2_PREFIX:
        return False

    try:
        iterations = int(iterations_s)
        if iterations < 1:
            return False
        salt = _b64decode(salt_b64)
        expected = _b64decode(digest_b64)
        actual = _pbkdf2_digest(plain_password, salt, iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _verify_legacy_bcrypt_password(plain_password: str, hashed_password: str) -> bool:
    """Optional fallback for older bcrypt hashes until passwords are reset."""
    try:
        import bcrypt  # type: ignore
    except Exception:
        logger.warning("Legacy bcrypt hash found but bcrypt package is unavailable")
        return False

    try:
        password_bytes = plain_password.encode("utf-8")
        if len(password_bytes) > 72:
            password_bytes = password_bytes[:72]
        return bcrypt.checkpw(password_bytes, hashed_password.encode("utf-8"))
    except Exception as e:
        logger.error(f"Legacy bcrypt verification error: {e}")
        return False


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a stored hash (PBKDF2, or legacy bcrypt)."""
    if not plain_password or not hashed_password:
        return False

    try:
        if hashed_password.startswith(f"{_PBKDF2_PREFIX}$"):
            return _verify_pbkdf2_password(plain_password, hashed_password)
        if hashed_password.startswith(("$2a$", "$2b$", "$2y$")):
            return _verify_legacy_bcrypt_password(plain_password, hashed_password)
        logger.warning("Unsupported password hash format")
        return False
    except Exception as e:
        logger.error(f"Password verification error: {e}")
        return False


def verify_client_credentials(client_id: str, client_secret: str) -> bool:
    """
    Verify client credentials for frontend authentication.

    Args:
        client_id: Client ID
        client_secret: Client secret

    Returns:
        True if credentials are valid
    """
    is_valid = (
        client_id == settings.CLIENT_ID and
        client_secret == settings.CLIENT_SECRET
    )
    if not is_valid:
        logger.warning(f"Invalid client credentials attempt for client_id: {client_id}")
    return is_valid


def create_jwt_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """
    Create a JWT token.

    Args:
        data: Data to encode in the token
        expires_delta: Optional expiration time delta. If not provided, uses default from settings.

    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()

    now = datetime.utcnow()

    expire = now + expires_delta if expires_delta else now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)

    # JWT expects integer timestamps (seconds since epoch)
    to_encode.update({
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp())
    })

    encoded_jwt = jwt.encode(
        to_encode,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt


def create_refresh_token(data: dict[str, Any]) -> str:
    """
    Create a JWT refresh token with longer expiration.

    Args:
        data: Data to encode in the token

    Returns:
        Encoded JWT refresh token string
    """
    to_encode = data.copy()
    now = datetime.utcnow()
    expire = now + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)

    # JWT expects integer timestamps (seconds since epoch)
    to_encode.update({
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp()),
        "type": "refresh"
    })

    encoded_jwt = jwt.encode(
        to_encode,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt


def verify_jwt_token(token: str) -> dict[str, Any] | None:
    """
    Verify and decode a JWT token.

    Args:
        token: JWT token string

    Returns:
        Decoded token payload if valid, None otherwise
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except PyJWTError as e:
        logger.debug(f"JWT token verification failed: {str(e)}")
        return None


def verify_refresh_token(token: str) -> dict[str, Any] | None:
    """
    Verify and decode a JWT refresh token.

    Args:
        token: JWT refresh token string

    Returns:
        Decoded token payload if valid and is a refresh token, None otherwise
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        # Verify it's a refresh token
        if payload.get("type") != "refresh":
            logger.warning("Token is not a refresh token")
            return None
        return payload
    except PyJWTError as e:
        logger.debug(f"JWT refresh token verification failed: {str(e)}")
        return None
