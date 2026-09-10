"""
Email utility for sending emails (SMTP or Microsoft Graph).
"""
import html
import json
import re
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request

from app.core.config import settings
from app.core.logging_config import logger
from app.utils.safe_http import open_http_request

# Simple in-process token cache
_graph_token_cache: dict[str, float | str] = {"token": "", "expires_at": 0.0}

AI_WORKBENCH_WEBSITE_URL = "https://aiworkbench.sciagen.ai"
SCIAGEN_COMPANY_NAME = "Sciagen Pvt. Ltd."
DEFAULT_SMTP_FROM_EMAIL = "noreply@aiworkbench.com"
SCIAGEN_LOGO_URL = (
    "https://cdn.prod.website-files.com/693bff0eb9cf7572773efa4f/"
    "696e476272bca1234a926411_Screenshot%202026-01-19%20at%208.31.15%E2%80%AFPM-p-500.png"
)


def _configured_contact_email() -> str:
    provider = (settings.EMAIL_PROVIDER or "").strip().lower()
    configured_smtp_from_email = (settings.SMTP_FROM_EMAIL or "").strip()
    smtp_from_email_candidates = (
        [configured_smtp_from_email]
        if configured_smtp_from_email and configured_smtp_from_email != DEFAULT_SMTP_FROM_EMAIL
        else []
    )
    graph_first = [
        settings.MS_SENDER_USER_ID,
        *smtp_from_email_candidates,
        settings.SMTP_FROM,
        settings.SMTP_USER,
        settings.ADMIN_EMAIL,
        DEFAULT_SMTP_FROM_EMAIL,
    ]
    smtp_first = [
        *smtp_from_email_candidates,
        settings.SMTP_FROM,
        settings.SMTP_USER,
        settings.MS_SENDER_USER_ID,
        settings.ADMIN_EMAIL,
        DEFAULT_SMTP_FROM_EMAIL,
    ]

    for candidate in graph_first if provider == "microsoft_graph" else smtp_first:
        email = (candidate or "").strip()
        if email and "@" in email:
            return email
    return "noreply@aiworkbench.com"


def _text_body_to_html(body_text: str) -> str:
    text = (body_text or "").strip().replace("\\n", "\n")
    if not text:
        return "<p>Please review this notification from AI Governance Workbench.</p>"

    sections: list[str] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [line.rstrip() for line in block.splitlines()]
        meaningful_lines = [line.strip() for line in lines if line.strip()]
        if not meaningful_lines:
            continue

        if all(line.startswith("- ") for line in meaningful_lines):
            items = "".join(
                f"<li>{html.escape(line[2:].strip(), quote=True)}</li>"
                for line in meaningful_lines
            )
            sections.append(f"<ul>{items}</ul>")
            continue

        escaped_lines = [html.escape(line, quote=True) for line in lines]
        sections.append(f"<p>{'<br>'.join(escaped_lines)}</p>")

    return "\n".join(sections)


def _extract_body_html(body_html: str) -> str:
    match = re.search(r"<body[^>]*>(.*?)</body>", body_html or "", flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else (body_html or "").strip()


def _append_brand_footer_text(body_text: str, contact_email: str) -> str:
    content = (body_text or "").strip().replace("\\n", "\n")
    footer = (
        f"Visit AI Governance Workbench: {AI_WORKBENCH_WEBSITE_URL}\n\n"
        "Thanks and regards,\n"
        f"{SCIAGEN_COMPANY_NAME}\n"
        f"Website: {AI_WORKBENCH_WEBSITE_URL}\n"
        f"Contact email: {contact_email}"
    )
    return f"{content}\n\n{footer}\n" if content else f"{footer}\n"


def _build_branded_email_html(subject: str, body_text: str, body_html: str | None, contact_email: str) -> str:
    content_html = _extract_body_html(body_html) if body_html else _text_body_to_html(body_text)
    safe_subject = html.escape((subject or "AI Governance Workbench").strip(), quote=True)
    safe_contact_email = html.escape(contact_email, quote=True)
    safe_website_url = html.escape(AI_WORKBENCH_WEBSITE_URL, quote=True)
    safe_logo_url = html.escape(SCIAGEN_LOGO_URL, quote=True)
    safe_company_name = html.escape(SCIAGEN_COMPANY_NAME, quote=True)

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {{
            margin: 0;
            padding: 0;
            background-color: #f4f7fb;
            color: #172033;
            font-family: Arial, Helvetica, sans-serif;
            line-height: 1.6;
        }}
        .email-shell {{
            width: 100%;
            padding: 28px 12px;
            background-color: #f4f7fb;
        }}
        .email-card {{
            max-width: 640px;
            margin: 0 auto;
            background-color: #ffffff;
            border: 1px solid #dbe5f0;
            border-radius: 8px;
            overflow: hidden;
        }}
        .email-header {{
            background-color: #071c2f;
            color: #ffffff;
            padding: 24px 28px;
        }}
        .eyebrow {{
            margin: 0 0 8px;
            color: #5ed2e7;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }}
        .email-title {{
            margin: 0;
            font-size: 24px;
            line-height: 1.25;
            font-weight: 700;
        }}
        .email-content {{
            padding: 28px;
            font-size: 15px;
        }}
        .email-content p {{
            margin: 0 0 16px;
        }}
        .email-content ul {{
            margin: 0 0 18px 22px;
            padding: 0;
        }}
        .email-content li {{
            margin: 0 0 8px;
        }}
        .reference-box {{
            margin: 24px 0 0;
            padding: 18px;
            background-color: #eef9fc;
            border: 1px solid #c8edf4;
            border-radius: 8px;
        }}
        .reference-box p {{
            margin: 0 0 14px;
            color: #1d4b5a;
            font-size: 14px;
        }}
        .highlight-box {{
            margin: 18px 0;
            padding: 15px;
            background-color: #ffffff;
            border: 2px solid #066b86;
            border-radius: 8px;
            color: #071c2f;
            font-size: 18px;
            font-weight: 700;
            text-align: center;
        }}
        .warning-box {{
            margin: 18px 0;
            padding: 14px;
            background-color: #fff7df;
            border-left: 4px solid #d08700;
            border-radius: 8px;
            color: #4f3a05;
        }}
        .cta-link {{
            display: inline-block;
            padding: 11px 16px;
            background-color: #066b86;
            border-radius: 8px;
            color: #ffffff !important;
            font-size: 14px;
            font-weight: 700;
            text-decoration: none;
        }}
        .email-footer {{
            padding: 24px 28px 28px;
            background-color: #071c2f;
            color: #e8f0f7;
            text-align: center;
        }}
        .logo-frame {{
            display: inline-block;
            padding: 10px 14px;
            background-color: #ffffff;
            border-radius: 8px;
            animation: sciagenLogoFloat 3.5s ease-in-out infinite;
        }}
        .sciagen-logo {{
            display: block;
            width: 184px;
            max-width: 100%;
            height: auto;
            border: 0;
        }}
        .footer-signoff {{
            margin: 16px 0 8px;
            font-size: 14px;
        }}
        .footer-links {{
            margin: 0;
            font-size: 13px;
            color: #c8d8e6;
        }}
        .footer-links a {{
            color: #7de3f2 !important;
            text-decoration: none;
        }}
        @keyframes sciagenLogoFloat {{
            0%, 100% {{ transform: translateY(0); }}
            50% {{ transform: translateY(-4px); }}
        }}
        @media screen and (max-width: 520px) {{
            .email-header,
            .email-content,
            .email-footer {{
                padding-left: 18px;
                padding-right: 18px;
            }}
            .email-title {{
                font-size: 21px;
            }}
            .sciagen-logo {{
                width: 160px;
            }}
        }}
    </style>
</head>
<body>
    <div class="email-shell">
        <div class="email-card">
            <div class="email-header">
                <p class="eyebrow">AI Governance Workbench Notification</p>
                <h1 class="email-title">{safe_subject}</h1>
            </div>
            <div class="email-content">
                {content_html}
                <div class="reference-box">
                    <p>&#127760; For reference, you can visit the AI Governance Workbench website using the secure link below.</p>
                    <a class="cta-link" href="{safe_website_url}" target="_blank" rel="noopener">Visit AI Workbench</a>
                </div>
            </div>
            <div class="email-footer">
                <div class="logo-frame">
                    <img class="sciagen-logo" src="{safe_logo_url}" alt="Sciagen logo">
                </div>
                <p class="footer-signoff">Thanks and regards,<br><strong>{safe_company_name}</strong></p>
                <p class="footer-links">
                    Website: <a href="{safe_website_url}" target="_blank" rel="noopener">{safe_website_url}</a><br>
                    Contact email: <a href="mailto:{safe_contact_email}">{safe_contact_email}</a>
                </p>
            </div>
        </div>
    </div>
</body>
</html>
"""


def _prepare_email_message(subject: str, body_text: str, body_html: str | None = None) -> tuple[str, str]:
    contact_email = _configured_contact_email()
    prepared_text = _append_brand_footer_text(body_text, contact_email)
    prepared_html = _build_branded_email_html(subject, body_text, body_html, contact_email)
    return prepared_text, prepared_html


def _is_graph_configured() -> bool:
    return all(
        (
            (settings.MS_TENANT_ID or "").strip(),
            (settings.MS_CLIENT_ID or "").strip(),
            (settings.MS_CLIENT_SECRET or "").strip(),
            (settings.MS_SENDER_USER_ID or "").strip(),
            (settings.MS_GRAPH_SCOPE or "").strip(),
            (settings.MS_AUTHORITY_HOST or "").strip(),
            (settings.MS_GRAPH_BASE_URL or "").strip(),
        )
    )


def _is_smtp_configured() -> bool:
    return bool(_smtp_credentials()[0] and _smtp_credentials()[1])


def _smtp_credentials() -> tuple[str, str]:
    return (
        (settings.SMTP_USER or "").strip(),
        "".join((settings.SMTP_PASSWORD or "").split()),
    )


def _http_post_form(url: str, form_data: dict[str, str], timeout: int = 15) -> tuple[int, str]:
    payload = urlencode(form_data).encode("utf-8")
    req = Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with open_http_request(req, timeout=timeout) as resp:
            return int(resp.status), resp.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", errors="replace")


def _http_post_json(url: str, body: dict, headers: dict[str, str], timeout: int = 15) -> tuple[int, str]:
    payload = json.dumps(body).encode("utf-8")
    req = Request(url, data=payload, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with open_http_request(req, timeout=timeout) as resp:
            return int(resp.status), resp.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", errors="replace")


def _get_graph_access_token() -> str | None:
    # Return cached token if still valid (60s buffer)
    token = str(_graph_token_cache.get("token") or "")
    expires_at = float(_graph_token_cache.get("expires_at") or 0.0)
    if token and time.time() < (expires_at - 60):
        return token

    tenant = (settings.MS_TENANT_ID or "").strip()
    client_id = (settings.MS_CLIENT_ID or "").strip()
    client_secret = (settings.MS_CLIENT_SECRET or "").strip()
    scope = (settings.MS_GRAPH_SCOPE or "").strip()
    authority = (settings.MS_AUTHORITY_HOST or "").strip().rstrip("/")

    if not tenant or not client_id or not client_secret or not scope or not authority:
        logger.error("Microsoft Graph configuration missing required values.")
        return None

    token_url = f"{authority}/{tenant}/oauth2/v2.0/token"

    try:
        status_code, body = _http_post_form(
            token_url,
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": scope,
                "grant_type": "client_credentials",
            },
        )
        if status_code != 200:
            logger.error(f"Graph token request failed: status={status_code}, body={body}")
            return None

        parsed = json.loads(body)
        access_token = parsed.get("access_token")
        expires_in = int(parsed.get("expires_in", 3600))
        if not access_token:
            logger.error(f"Graph token response missing access_token: {body}")
            return None

        _graph_token_cache["token"] = access_token
        _graph_token_cache["expires_at"] = time.time() + expires_in
        return access_token

    except Exception as exc:
        logger.error(f"Failed to obtain Graph access token: {exc}")
        return None


def _send_email_via_graph(
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> bool:
    sender = (settings.MS_SENDER_USER_ID or "").strip()
    base_url = (settings.MS_GRAPH_BASE_URL or "").strip().rstrip("/")

    if not sender or not base_url:
        logger.error("Microsoft Graph sender/base URL is not configured.")
        return False

    access_token = _get_graph_access_token()
    if not access_token:
        return False

    content_type = "HTML" if body_html else "Text"
    content_value = body_html if body_html else body_text

    payload = {
        "message": {
            "subject": subject,
            "body": {
                "contentType": content_type,
                "content": content_value,
            },
            "toRecipients": [{"emailAddress": {"address": to_email}}],
        },
        "saveToSentItems": True,
    }

    send_url = f"{base_url}/users/{quote(sender, safe='')}/sendMail"

    try:
        status_code, body = _http_post_json(
            send_url,
            payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
        )

        # Graph sendMail typically returns 202 Accepted
        if status_code not in (200, 202):
            logger.error(f"Graph sendMail failed: status={status_code}, body={body}")
            return False

        logger.info(f"Email sent successfully via Graph to {to_email}")
        return True

    except Exception as exc:
        logger.error(f"Failed to send Graph email to {to_email}: {exc}")
        return False


def _send_email_via_smtp(
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> bool:
    if not _is_smtp_configured():
        logger.warning("SMTP configuration missing (SMTP_USER/SMTP_PASSWORD). Email sending disabled.")
        return False

    try:
        smtp_user, smtp_password = _smtp_credentials()
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = to_email
        msg["Subject"] = subject

        msg.attach(MIMEText(body_text, "plain"))
        if body_html:
            msg.attach(MIMEText(body_html, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(msg)

        logger.info(f"Email sent successfully via SMTP to {to_email}")
        return True

    except Exception as exc:
        logger.error(f"Failed to send SMTP email to {to_email}: {exc}")
        return False


def send_email(
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> bool:
    """
    Keep existing public API; route internally by EMAIL_PROVIDER.
    """
    body_text, body_html = _prepare_email_message(subject, body_text, body_html)

    provider = (settings.EMAIL_PROVIDER or "").strip().lower()
    if not provider:
        provider = "microsoft_graph" if _is_graph_configured() else "smtp"

    if provider == "microsoft_graph":
        return _send_email_via_graph(to_email, subject, body_text, body_html)

    # If provider is SMTP but SMTP is not configured, fall back to Graph when available.
    if provider == "smtp" and not _is_smtp_configured() and _is_graph_configured():
        logger.info("SMTP not configured; falling back to Microsoft Graph email provider.")
        return _send_email_via_graph(to_email, subject, body_text, body_html)

    return _send_email_via_smtp(to_email, subject, body_text, body_html)

