"""
Background email dispatch helpers for request-triggered notifications.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import BackgroundTasks

from app.core.logging_config import logger
from app.utils.email import send_email

EmailContext = Mapping[str, Any] | None


def _format_context(context: EmailContext) -> str:
    if not context:
        return ""
    safe_parts = []
    for key, value in context.items():
        if value is None:
            continue
        safe_parts.append(f"{key}={value}")
    if not safe_parts:
        return ""
    return " " + " ".join(safe_parts)


def send_email_safe(
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    *,
    flow_name: str,
    context: EmailContext = None,
) -> bool:
    """
    Send a regular email while isolating background task failures from requests.
    """
    context_text = _format_context(context)
    try:
        sent = send_email(to_email, subject, body_text, body_html)
        if sent:
            logger.info(f"Background email send success flow={flow_name} to={to_email}{context_text}")
        else:
            logger.error(f"Background email send failure flow={flow_name} to={to_email}{context_text}")
        return sent
    except Exception as exc:
        logger.error(f"Background email send exception flow={flow_name} to={to_email}{context_text}: {exc}")
        return False


def queue_email(
    background_tasks: BackgroundTasks | None,
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    flow_name: str,
    context: EmailContext = None,
) -> None:
    """
    Queue a regular email for background delivery.

    A synchronous fallback is kept for non-HTTP call sites that do not have a
    BackgroundTasks instance yet.
    """
    context_text = _format_context(context)
    if background_tasks is None:
        logger.warning(f"BackgroundTasks unavailable; sending email synchronously flow={flow_name} to={to_email}{context_text}")
        send_email_safe(to_email, subject, body_text, body_html, flow_name=flow_name, context=context)
        return

    background_tasks.add_task(
        send_email_safe,
        to_email,
        subject,
        body_text,
        body_html,
        flow_name=flow_name,
        context=context,
    )
    logger.info(f"Background email task scheduled flow={flow_name} to={to_email}{context_text}")
