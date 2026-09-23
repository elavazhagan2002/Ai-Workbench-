"""
Session management for user authentication.
Uses secure HTTP-only cookies to store session IDs.
"""
import secrets
from datetime import datetime, timedelta

from app.core.logging_config import logger

# In-memory session store (in production, use Redis or database)
# Format: {session_id: {"user_id": str, "created_at": datetime, "expires_at": datetime}}
_sessions: dict[str, dict] = {}


def create_session(user_id: str, expires_hours: int = 24) -> str:
    """
    Create a new session for a user.

    Args:
        user_id: User ID
        expires_hours: Session expiration in hours (default 24)

    Returns:
        Session ID string
    """
    session_id = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=expires_hours)

    _sessions[session_id] = {
        "user_id": user_id,
        "created_at": datetime.utcnow(),
        "expires_at": expires_at
    }

    logger.debug(f"Created session for user: {user_id} | Session ID: {session_id[:8]}...")
    return session_id


def get_session(session_id: str) -> dict | None:
    """
    Get session data by session ID.

    Args:
        session_id: Session ID

    Returns:
        Session data dict or None if not found/expired
    """
    if not session_id:
        return None

    session = _sessions.get(session_id)
    if not session:
        return None

    # Check if session expired
    if datetime.utcnow() > session["expires_at"]:
        logger.debug(f"Session expired: {session_id[:8]}...")
        del _sessions[session_id]
        return None

    return session


def delete_session(session_id: str) -> None:
    """
    Delete a session.

    Args:
        session_id: Session ID to delete
    """
    if session_id in _sessions:
        user_id = _sessions[session_id].get("user_id")
        del _sessions[session_id]
        logger.debug(f"Deleted session for user: {user_id} | Session ID: {session_id[:8]}...")


def cleanup_expired_sessions() -> None:
    """Remove expired sessions from memory."""
    now = datetime.utcnow()
    expired = [
        sid for sid, session in _sessions.items()
        if now > session["expires_at"]
    ]
    for sid in expired:
        del _sessions[sid]
    if expired:
        logger.debug(f"Cleaned up {len(expired)} expired sessions")


def get_user_id_from_session(session_id: str) -> str | None:
    """
    Get user ID from session ID.

    Args:
        session_id: Session ID

    Returns:
        User ID or None if session invalid/expired
    """
    session = get_session(session_id)
    if session:
        return session.get("user_id")
    return None
