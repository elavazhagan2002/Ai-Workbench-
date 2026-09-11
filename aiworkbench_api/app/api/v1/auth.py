"""
Authentication endpoints: Client credentials (token) + User sessions (cookies).
"""
import asyncio
import ipaddress
import json
import secrets
import string
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status

# ===== MODIFIED CODE END =====
from pydantic import BaseModel, EmailStr
from sqlalchemy import func

# ===== MODIFIED CODE START =====
from sqlalchemy.orm import Session, joinedload

from app.core import login_mfa, password_reset
from app.core import totp as totp_mfa
from app.core.authorization import get_user_permissions
from app.core.config import settings
from app.core.database import get_db
from app.core.email_otp import (
    check_send_rate_limit as _otp_check_send_rate_limit,
)
from app.core.email_otp import (
    consume_verification as _otp_consume_verification,
)
from app.core.email_otp import (
    issue_otp as _otp_issue,
)

# ===== MODIFIED CODE START =====
# Email OTP helpers for self-registration gating and OTP endpoints
from app.core.email_otp import (
    normalize_email as _normalize_email,
)
from app.core.email_otp import (
    verify_otp as _otp_verify,
)
from app.core.logging_config import logger
from app.core.password_policy import evaluate_password_strength, validate_password_policy

# ===== MODIFIED CODE END =====
# ===== NEW CODE START =====
from app.core.registration_draft import (
    delete_register_draft,
    load_register_draft,
    store_register_draft,
)
from app.core.security import (
    create_jwt_token,
    create_refresh_token,
    get_password_hash,
    verify_client_credentials,
    verify_password,
    verify_refresh_token,
)
from app.core.session import create_session, delete_session, get_user_id_from_session
from app.middleware.auth_middleware import get_current_user_id

# ===== NEW CODE END =====
from app.models import AnonymousIdea, AuditLog, Domain, OrganizationType, Role, UseCase, User, UserLoginIP
from app.utils.background_email import queue_email
from app.utils.notification_emails import (
    notify_admins_new_registration,
    send_idea_thank_you_email,
    send_registration_pending_email,
)
from app.utils.safe_http import open_http_request

router = APIRouter()

# Rate limit for self-registration (DDoS / abuse protection): per IP
_self_register_attempts: dict[str, list[float]] = {}
SELF_REGISTER_MAX_PER_IP = 5
SELF_REGISTER_WINDOW_SECONDS = 900  # 15 minutes
_auth_feedback_attempts: dict[str, list[float]] = {}
AUTH_FEEDBACK_MAX_PER_IP = 120
AUTH_FEEDBACK_WINDOW_SECONDS = 300  # 5 minutes
USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 25


class PublicStatsResponse(BaseModel):
    """Public stats for login/marketing (no auth required)."""
    domains_count: int
    use_cases_count: int


class PublicOrganizationTypeItem(BaseModel):
    """Single org type for public dropdown (no auth required)."""
    org_type_id: str
    name: str

    class Config:
        from_attributes = True


class SelfRegisterRequest(BaseModel):
    """Self-registration (password-based). Mandatory: user_name, email, organization, organization_type, password, interested_domain_id."""
    user_name: str
    email: EmailStr
    password: str
    organization: str
    organization_type: str  # name from organization_types
    interested_domain_id: str  # Domain to be assigned when admin approves
    # Anti-automation: honeypot (must be empty); form_opened_at (Unix ms); Cloudflare Turnstile token
    website: str | None = None  # Honeypot - bots often fill this; must be empty
    form_opened_at: int | None = None  # When registration form was shown (client); server checks min time
    turnstile_token: str | None = None  # Cloudflare Turnstile response token; required if TURNSTILE_SECRET_KEY is set


class SelfRegisterResponse(BaseModel):
    """Response after successful self-registration."""
    message: str



# Email OTP request/response models
class SendEmailOtpRequest(BaseModel):
    email: EmailStr


class SendEmailOtpResponse(BaseModel):
    message: str


class VerifyEmailOtpRequest(BaseModel):
    email: EmailStr
    otp: str


class VerifyEmailOtpResponse(BaseModel):

    message: str

# ===== NEW CODE START =====
class ResendPasscodeRequest(BaseModel):
    email: EmailStr


class ResendPasscodeResponse(BaseModel):
    message: str
# ===== NEW CODE END =====

class CheckEmailRequest(BaseModel):
    email: EmailStr


class CheckEmailResponse(BaseModel):
    exists: bool
# ===== NEW CODE END =====


class UsernameAvailabilityResponse(BaseModel):
    username: str
    valid: bool
    available: bool
    code: Literal["AVAILABLE", "TAKEN", "REQUIRED", "TOO_SHORT", "TOO_LONG"]
    message: str


class PasswordValidationRequest(BaseModel):
    password: str


class PasswordValidationResponse(BaseModel):
    is_valid: bool
    errors: list[str]
    strength: Literal["weak", "medium", "strong"]
    score: int
    feedback: list[str]
    checks: dict[str, bool]


def _parse_ip_address(value: str | None):
    try:
        return ipaddress.ip_address((value or "").strip())
    except ValueError:
        return None


def _trusted_proxy_networks():
    networks = []
    for item in settings.TRUSTED_PROXY_CIDRS:
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            logger.warning(f"Ignoring invalid TRUSTED_PROXY_CIDRS entry: {item}")
    return networks


def _is_trusted_proxy(host: str) -> bool:
    ip = _parse_ip_address(host)
    return bool(ip and any(ip in network for network in _trusted_proxy_networks()))


def _get_forwarded_client_ip(forwarded_for: str | None) -> str | None:
    candidates = [part.strip() for part in (forwarded_for or "").split(",") if part.strip()]
    valid_candidates = []
    for candidate in candidates:
        ip = _parse_ip_address(candidate)
        if ip:
            valid_candidates.append(str(ip))

    # Walk from the closest proxy to the original client, skipping trusted proxies.
    for candidate in reversed(valid_candidates):
        if not _is_trusted_proxy(candidate):
            return candidate

    return valid_candidates[0] if valid_candidates else None


def _get_client_ip(request: Request) -> str:
    """Client IP for rate limiting/MFA. Trust forwarded headers only from configured proxies."""
    peer_ip = request.client.host if request.client else "unknown"
    if _is_trusted_proxy(peer_ip):
        forwarded_ip = _get_forwarded_client_ip(request.headers.get("X-Forwarded-For"))
        if forwarded_ip:
            return forwarded_ip
        real_ip = _parse_ip_address(request.headers.get("X-Real-IP"))
        if real_ip:
            return str(real_ip)
    return peer_ip


def _check_self_register_rate_limit(ip: str) -> None:
    """Raise 429 if IP has exceeded self-registration rate limit."""
    now = time.time()
    if ip not in _self_register_attempts:
        _self_register_attempts[ip] = []
    times = _self_register_attempts[ip]
    # Keep only attempts within the window
    times[:] = [t for t in times if now - t < SELF_REGISTER_WINDOW_SECONDS]
    if len(times) >= SELF_REGISTER_MAX_PER_IP:
        logger.warning(f"Self-registration rate limit exceeded for IP: {ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts. Please try again later."
        )
    times.append(now)


def _check_auth_feedback_rate_limit(ip: str) -> None:
    """Lightweight throttle for live username/password feedback endpoints."""
    now = time.time()
    if ip not in _auth_feedback_attempts:
        _auth_feedback_attempts[ip] = []
    times = _auth_feedback_attempts[ip]
    times[:] = [t for t in times if now - t < AUTH_FEEDBACK_WINDOW_SECONDS]
    if len(times) >= AUTH_FEEDBACK_MAX_PER_IP:
        logger.warning(f"Auth feedback rate limit exceeded for IP: {ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many validation requests. Please try again later."
        )
    times.append(now)


def _verify_turnstile_sync(secret: str, token: str, remote_ip: str | None = None) -> bool:
    """Verify Cloudflare Turnstile token (sync, run in thread). Returns True if valid."""
    if not token or not secret:
        return False
    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with open_http_request(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            return result.get("success") is True
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, OSError) as e:
        logger.warning(f"Turnstile verify failed: {e}")
        return False


@router.get("/public-stats", response_model=PublicStatsResponse)
async def get_public_stats(db: Session = Depends(get_db)):
    """Return total domains and use cases count for login page showcase. No authentication required."""
    domains_count = db.query(Domain).count()
    use_cases_count = db.query(UseCase).count()
    return PublicStatsResponse(domains_count=domains_count, use_cases_count=use_cases_count)

class PublicDomainItem(BaseModel):
    """Domain for public dropdowns (e.g. anonymous idea submission). No auth required."""
    domain_id: str
    domain_name: str


@router.get("/public-domains", response_model=list[PublicDomainItem])
async def get_public_domains(db: Session = Depends(get_db)):
    """Return all domains (id, name) for anonymous idea submission. No authentication required."""
    domains = db.query(Domain).order_by(Domain.domain_name).all()
    return [PublicDomainItem(domain_id=d.domain_id, domain_name=d.domain_name) for d in domains]


@router.get("/public-organization-types", response_model=list[PublicOrganizationTypeItem])
async def get_public_organization_types(db: Session = Depends(get_db)):
    """Return organization types for self-registration form. No authentication required."""
    types = db.query(OrganizationType).order_by(OrganizationType.name).all()
    return [PublicOrganizationTypeItem(org_type_id=t.org_type_id, name=t.name) for t in types]


class AnonymousIdeaSubmitRequest(BaseModel):
    """Anonymous idea submission (no registration)."""
    domain_id: str
    idea_text: str
    submitted_by_email: str | None = None
    submitted_by_organization: str | None = None


class AnonymousIdeaSubmitResponse(BaseModel):
    """Response after submitting an anonymous idea."""
    message: str
    idea_id: str


# Rate limit for anonymous idea submission
_anonymous_idea_attempts: dict[str, list[float]] = {}
ANONYMOUS_IDEA_MAX_PER_IP = 10
ANONYMOUS_IDEA_WINDOW_SECONDS = 900  # 15 minutes


def _check_anonymous_idea_rate_limit(ip: str) -> None:
    """Raise 429 if IP exceeded anonymous idea rate limit."""
    now = time.time()
    if ip not in _anonymous_idea_attempts:
        _anonymous_idea_attempts[ip] = []
    times = _anonymous_idea_attempts[ip]
    times[:] = [t for t in times if now - t < ANONYMOUS_IDEA_WINDOW_SECONDS]
    if len(times) >= ANONYMOUS_IDEA_MAX_PER_IP:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many submissions. Please try again later."
        )
    times.append(now)


@router.post("/anonymous-ideas", response_model=AnonymousIdeaSubmitResponse)
async def submit_anonymous_idea(
    body: AnonymousIdeaSubmitRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Submit an idea anonymously (no registration). Rate limited per IP."""
    ip = _get_client_ip(request)
    _check_anonymous_idea_rate_limit(ip)
    idea_text = (body.idea_text or "").strip()
    if not idea_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idea description is required."
        )
    if len(idea_text) > 5000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idea description must be at most 5000 characters."
        )
    domain = db.query(Domain).filter(Domain.domain_id == body.domain_id).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid domain."
        )
    email = (body.submitted_by_email or "").strip()[:255] or None
    org = (body.submitted_by_organization or "").strip()[:200] or None
    idea = AnonymousIdea(
        domain_id=body.domain_id,
        idea_text=idea_text,
        submitted_by_email=email,
        submitted_by_organization=org,
        status="new",
    )
    db.add(idea)
    db.commit()
    db.refresh(idea)
    logger.info(f"Anonymous idea submitted: {idea.idea_id} for domain {body.domain_id}")
    send_idea_thank_you_email(email, domain, idea.idea_id, background_tasks=background_tasks)
    return AnonymousIdeaSubmitResponse(
        message="Thank you. Your idea has been submitted.",
        idea_id=idea.idea_id,
    )


#email-helper
@router.post("/send-email-otp", response_model=SendEmailOtpResponse)
async def send_email_otp(body: SendEmailOtpRequest, background_tasks: BackgroundTasks):
    email_normalized = _normalize_email(str(body.email))

    try:
        _otp_check_send_rate_limit(email_normalized)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many OTP requests. Please try again later.",
        )

    otp = _otp_issue(email_normalized)
    subject = "Email Verification"
    body_text = (
        f"Your verification code is: {otp}\n\n"
        "This code expires in 5 minutes.\n"
    )

    queue_email(
        background_tasks,
        to_email=str(body.email),
        subject=subject,
        body_text=body_text,
        flow_name="email_otp",
        context={"otp_purpose": "email_verification"},
    )

    return SendEmailOtpResponse(message="Verification code sent.")


# ===== MODIFIED CODE START =====
@router.post("/verify-email-otp", response_model=VerifyEmailOtpResponse)
async def verify_email_otp(
    body: VerifyEmailOtpRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Verify passcode (OTP) and, on success, create the user from the temporary Redis draft.
    """
    email_normalized = _normalize_email(str(body.email))
    result = _otp_verify(email_normalized, body.otp)

    if result == "verified":
        draft = load_register_draft(email_normalized)
        if not draft:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Registration draft not found or expired. Please register again.",
            )

        existing_email = (
            db.query(User.user_id)
            .filter(func.lower(User.user_email) == email_normalized)
            .first()
        )
        if existing_email:
            delete_register_draft(email_normalized)
            _otp_consume_verification(email_normalized)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

        name_trimmed = (draft.get("user_name") or "").strip()[:25]
        if not name_trimmed:
            delete_register_draft(email_normalized)
            _otp_consume_verification(email_normalized)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid registration draft. Please register again.",
            )

        password_hash = str(draft.get("password_hash") or "").strip()
        if not password_hash:
            delete_register_draft(email_normalized)
            _otp_consume_verification(email_normalized)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid registration draft. Please register again.",
            )

        existing_name = db.query(User.user_id).filter(User.user_name == name_trimmed).first()
        if existing_name:
            delete_register_draft(email_normalized)
            _otp_consume_verification(email_normalized)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This user name is already taken. Please choose another.",
            )

        # Assign "general_user" role by default for new registrations
        user_role = db.query(Role).filter(Role.role_name == "general_user").first()
        if not user_role:
            # Fallback for DBs not yet migrated
            user_role = db.query(Role).filter(Role.role_name == "User").first()
        role_id = user_role.role_id if user_role else None
        if not user_role:
            logger.warning("User role not found; creating self-registered user without role")

        new_user = User(
            user_name=name_trimmed,
            user_email=email_normalized,
            user_pwd=password_hash,
            role_id=role_id,
            organization=str(draft.get("organization") or "").strip()[:100],
            organization_type=str(draft.get("organization_type") or "").strip()[:100] or None,
            interested_domain_id=str(draft.get("interested_domain_id") or "").strip() or None,
            user_image=None,
            is_active=False,  # requires admin approval
            registration_status="pending",
            created_by=None,
            modified_by=None,
        )

        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        interested_domain_name = None
        if new_user.interested_domain_id:
            interested_domain = db.query(Domain).filter(Domain.domain_id == new_user.interested_domain_id).first()
            interested_domain_name = interested_domain.domain_name if interested_domain else None

        logger.info(f"Queueing registration pending email to {new_user.user_email}")
        send_registration_pending_email(new_user, interested_domain_name, background_tasks=background_tasks)

        delete_register_draft(email_normalized)
        _otp_consume_verification(email_normalized)

        logger.info(
            f"Registration completed for {new_user.user_email} (user_id={new_user.user_id}), pending approval"
        )
        notify_admins_new_registration(db, new_user, interested_domain_name, background_tasks=background_tasks)
        return VerifyEmailOtpResponse(
            message="Registration successful. Awaiting admin approval."
        )

    if result == "too_many_attempts":
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many OTP verification attempts. Please request a new code.",
        )

    if result == "expired":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP expired. Please request a new code.",
        )

    if result == "not_found":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP not found. Please request a new code.",
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid OTP.",
    )
# ===== MODIFIED CODE END =====

# ===== NEW CODE START =====
@router.post("/resend-passcode", response_model=ResendPasscodeResponse)
async def resend_passcode(body: ResendPasscodeRequest, background_tasks: BackgroundTasks):
    """
    Resend verification passcode for active registration (draft must exist).
    Reuses existing OTP rate limiting and email sending.
    """
    email_normalized = _normalize_email(str(body.email))

    # Safety: Verify registration draft exists (prevents abuse)
    draft = load_register_draft(email_normalized)
    if not draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration session expired. Please register again.",
        )

    try:
        _otp_check_send_rate_limit(email_normalized)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many OTP requests. Please try again later.",
        )

    otp = _otp_issue(email_normalized)
    subject = "Your AI Workbench Passcode"
    body_text = (
        f"Your verification passcode is: {otp}\\n\\n"
        "This passcode will expire in 5 minutes.\\n"

    )

    queue_email(
        background_tasks,
        to_email=str(body.email),
        subject=subject,
        body_text=body_text,
        flow_name="registration_passcode_resend",
        context={"otp_purpose": "registration"},
    )

    return ResendPasscodeResponse(message="Passcode resent successfully")
# ===== NEW CODE END =====
#email-helper

# ===== NEW CODE START =====
@router.post("/check-email", response_model=CheckEmailResponse)
async def check_email(body: CheckEmailRequest, db: Session = Depends(get_db)):
    """
    Check if an email already exists in the users table.
    """
    email_normalized = _normalize_email(str(body.email))
    exists = (
        db.query(User.user_id)
        .filter(func.lower(User.user_email) == email_normalized)
        .first()
        is not None
    )
    return CheckEmailResponse(exists=exists)
# ===== NEW CODE END =====


def _build_password_validation_response(password: str) -> PasswordValidationResponse:
    validation = validate_password_policy(password)
    strength = evaluate_password_strength(password)
    return PasswordValidationResponse(
        is_valid=validation["is_valid"],
        errors=validation["errors"],
        strength=strength["strength"],
        score=strength["score"],
        feedback=strength["feedback"],
        checks=validation["checks"],
    )


def _normalize_username(username: str) -> str:
    return (username or "").strip()


@router.get("/check-username", response_model=UsernameAvailabilityResponse)
async def check_username(
    request: Request,
    username: str = Query(default=""),
    db: Session = Depends(get_db)
):
    """
    Check whether a username is available for self-registration.
    """
    _check_auth_feedback_rate_limit(_get_client_ip(request))

    username_normalized = _normalize_username(username)
    if not username_normalized:
        return UsernameAvailabilityResponse(
            username=username_normalized,
            valid=False,
            available=False,
            code="REQUIRED",
            message="Username is required",
        )
    if len(username_normalized) < USERNAME_MIN_LENGTH:
        return UsernameAvailabilityResponse(
            username=username_normalized,
            valid=False,
            available=False,
            code="TOO_SHORT",
            message=f"Username must be at least {USERNAME_MIN_LENGTH} characters",
        )
    if len(username_normalized) > USERNAME_MAX_LENGTH:
        return UsernameAvailabilityResponse(
            username=username_normalized,
            valid=False,
            available=False,
            code="TOO_LONG",
            message=f"Username must be at most {USERNAME_MAX_LENGTH} characters",
        )

    exists = db.query(User.user_id).filter(User.user_name == username_normalized).first() is not None
    return UsernameAvailabilityResponse(
        username=username_normalized,
        valid=True,
        available=not exists,
        code="TAKEN" if exists else "AVAILABLE",
        message="This username is already taken" if exists else "Username is available",
    )


@router.post("/validate-password", response_model=PasswordValidationResponse)
async def validate_password(body: PasswordValidationRequest, request: Request):
    """
    Validate password policy and strength without storing anything.
    """
    _check_auth_feedback_rate_limit(_get_client_ip(request))
    return _build_password_validation_response(body.password)


@router.post("/self-register", response_model=SelfRegisterResponse)
async def self_register(
    body: SelfRegisterRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Self-registration. Stores a temporary registration draft and emails a passcode.
    User is created only after passcode verification; admin must approve before login.
    Rate limited per IP to protect against DDoS/abuse.
    """

    ip = _get_client_ip(request)
    _check_self_register_rate_limit(ip)


    secret = (settings.TURNSTILE_SECRET_KEY or "").strip()
    if secret:
        if not (body.turnstile_token and body.turnstile_token.strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Security check failed. Please complete the captcha and try again."
            )
        ok = await asyncio.to_thread(
            _verify_turnstile_sync, secret, body.turnstile_token.strip(), ip
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Security check failed. Please try again."
            )

    # Anti-automation: honeypot (bots often fill every field)
    if body.website is not None and (body.website.strip() or ""):
        logger.warning(f"Self-registration rejected: honeypot filled (IP={ip})")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid request. Please submit the form again."
        )

    # Anti-automation: minimum time on form (reject if submitted too quickly or without client timestamp)
    if body.form_opened_at is None:
        logger.warning(f"Self-registration rejected: missing form_opened_at (IP={ip})")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please use the registration form on the login page and try again."
        )
    now_ms = int(time.time() * 1000)
    opened = body.form_opened_at
    if opened > now_ms + 60_000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid request.")
    if now_ms - opened > 3600_000:  # 1 hour - form too old
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This form has expired. Please open the registration form again and try again."
        )
    if now_ms - opened < 5000:  # 5 seconds minimum
        logger.warning(f"Self-registration rejected: form filled too fast (IP={ip})")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please take your time filling the form and try again."
        )

    # Validate name length (matches User model)
    username_normalized = _normalize_username(body.user_name)
    if len(username_normalized) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User name is required")
    if len(username_normalized) < USERNAME_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Username must be at least {USERNAME_MIN_LENGTH} characters"
        )
    if len(username_normalized) > USERNAME_MAX_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Username must be at most {USERNAME_MAX_LENGTH} characters"
        )
    if len(body.organization.strip()) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization is required")
    if len(body.organization) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization must be at most 100 characters")

    password_feedback = _build_password_validation_response(body.password)
    if not password_feedback.is_valid:
        detail = password_feedback.model_dump()
        detail["message"] = "Password does not meet security requirements"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    # Validate organization type exists
    org_type = db.query(OrganizationType).filter(OrganizationType.name == body.organization_type.strip()).first()
    if not org_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid organization type. Please select from the list."
        )

    # Validate interested domain exists
    domain = db.query(Domain).filter(Domain.domain_id == body.interested_domain_id).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid domain. Please select from the list."
        )

    # ===== MODIFIED CODE START =====
    email_normalized = _normalize_email(str(body.email))
    existing = (
        db.query(User.user_id)
        .filter(func.lower(User.user_email) == email_normalized)
        .first()
    )
    # ===== MODIFIED CODE END =====
    if existing:
        # ===== MODIFIED CODE START =====
        logger.warning(f"Self-registration rejected: email already registered - {email_normalized}")
        # ===== MODIFIED CODE END =====
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    name_trimmed = username_normalized
    existing_name = db.query(User).filter(User.user_name == name_trimmed).first()
    if existing_name:
        logger.warning(f"Self-registration rejected: user name already exists - {name_trimmed}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This user name is already taken. Please choose another."
        )

    # ===== MODIFIED CODE START =====
    draft = {
        "user_name": username_normalized,
        "email": email_normalized,
        "password_hash": get_password_hash(body.password),
        "organization": body.organization.strip()[:100],
        "organization_type": org_type.name,
        "interested_domain_id": body.interested_domain_id,
    }

    store_register_draft(email_normalized, draft, ttl_seconds=600)

    try:
        _otp_check_send_rate_limit(email_normalized)
    except ValueError:
        delete_register_draft(email_normalized)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many OTP requests. Please try again later.",
        )

    passcode = _otp_issue(email_normalized)
    subject = "Your AI Workbench Passcode"
    body_text = (
        f"Your verification passcode is: {passcode}\n\n"
        "This passcode will expire in 5 minutes.\n"
    )

    queue_email(
        background_tasks,
        to_email=str(body.email),
        subject=subject,
        body_text=body_text,
        flow_name="registration_otp",
        context={"otp_purpose": "registration"},
    )

    logger.info(f"Self-registration draft stored and passcode queued for {email_normalized} (pending verification)")
    return SelfRegisterResponse(
        message="Passcode sent to email"
    )
    # ===== MODIFIED CODE END =====

# Rate limit for forgot-password: avoid sending multiple emails for same address
_forgot_password_last_sent: dict[str, float] = {}
FORGOT_PASSWORD_COOLDOWN_SECONDS = 300  # 5 minutes

# Rate limit for sign-in: limit attempts per email to reduce brute-force
_signin_attempt_times: dict[str, list[float]] = {}
SIGNIN_MAX_ATTEMPTS = 10
SIGNIN_WINDOW_SECONDS = 300  # 5 minutes


# Request/Response Models
class ClientLoginRequest(BaseModel):
    """Client credentials for frontend authentication."""
    client_id: str
    client_secret: str | None = None  # Optional so we return 401 instead of 422 when missing


class ClientLoginResponse(BaseModel):
    """Response with JWT tokens for API access."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class SignInRequest(BaseModel):
    """User sign-in request."""
    email: EmailStr
    password: str


class VerifyLoginPasscodeRequest(BaseModel):
    """Login MFA passcode verification request."""
    challenge_id: str
    passcode: str


class ResendLoginPasscodeRequest(BaseModel):
    """Login MFA passcode resend request."""
    challenge_id: str


class ResendLoginPasscodeResponse(BaseModel):
    message: str


class RefreshTokenRequest(BaseModel):
    """Refresh token request."""
    refresh_token: str


class UserResponse(BaseModel):
    """User information response."""
    user_id: str
    user_image: str | None = None
    user_name: str
    user_email: str
    organization: str | None = None
    organization_type: str | None = None
    role_id: str | None = None
    role: dict | None = None
    permissions: list[str] = []
    totp_enabled: bool = False

    class Config:
        from_attributes = True


class SignInSuccessResponse(BaseModel):
    status: Literal["LOGIN_SUCCESS"] = "LOGIN_SUCCESS"
    user: UserResponse
    message: str
    totp_setup_suggested: bool = False


class SignInMfaRequiredResponse(BaseModel):
    status: Literal["MFA_REQUIRED"] = "MFA_REQUIRED"
    message: str
    challenge_id: str
    method: Literal["email_passcode", "totp"] = "email_passcode"
    methods: list[Literal["email_passcode", "totp"]] = ["email_passcode"]
    default_method: Literal["email_passcode", "totp"] = "email_passcode"


class SwitchLoginMfaMethodRequest(BaseModel):
    challenge_id: str
    method: Literal["email_passcode", "totp"]


class SwitchLoginMfaMethodResponse(BaseModel):
    message: str
    method: Literal["email_passcode", "totp"]
    methods: list[Literal["email_passcode", "totp"]]
    challenge_id: str


class TotpSetupResponse(BaseModel):
    secret: str
    otpauth_url: str
    qr_data_uri: str
    issuer: str = totp_mfa.TOTP_ISSUER


class TotpConfirmRequest(BaseModel):
    passcode: str


class TotpDisableRequest(BaseModel):
    password: str
    passcode: str


class TotpActionResponse(BaseModel):
    message: str
    totp_enabled: bool
    user: UserResponse


class ProfileUpdate(BaseModel):
    """Profile update (current user only: name, organization, photo)."""
    user_name: str | None = None
    organization: str | None = None
    user_image: str | None = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str
    confirm_password: str


class ChangePasswordResponse(BaseModel):
    message: str


class VerifyCurrentPasswordRequest(BaseModel):
    password: str


class VerifyCurrentPasswordResponse(BaseModel):
    valid: bool = True


def get_user_role_dict(user: User) -> dict | None:
    """Get user role as dictionary."""
    try:
        if user.role:
            return {
                "role_id": user.role.role_id,
                "role_name": user.role.role_name,
                "role_description": user.role.role_description
            }
    except Exception as e:
        logger.warning(f"Error accessing user role: {str(e)}")
    return None


@router.post("/client-login", response_model=ClientLoginResponse)
async def client_login(
    request: ClientLoginRequest,
    db: Session = Depends(get_db)
):
    """
    Authenticate frontend client using client credentials.
    Returns JWT access token and refresh token for API access (not user-specific).
    """
    logger.info(f"Client login attempt: {request.client_id}")

    if not request.client_secret or not request.client_secret.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Client credentials required (client_secret missing or empty)"
        )

    # Verify client credentials
    if not verify_client_credentials(request.client_id, request.client_secret):
        logger.warning(f"Invalid client credentials: {request.client_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid client credentials"
        )

    # Create JWT access token
    token_data = {
        "client_id": request.client_id,
        "type": "client_access"
    }
    access_token = create_jwt_token(token_data)

    # Create JWT refresh token
    refresh_token = create_refresh_token(token_data)

    expires_in = settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60  # Convert to seconds

    logger.info(f"Client authenticated successfully: {request.client_id}")

    return ClientLoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=expires_in
    )


def _signin_rate_limit_check(email: str) -> None:
    """Raise HTTP 429 if too many failed sign-in attempts for this email in the window."""
    now = time.time()
    key = email.lower().strip()
    if key not in _signin_attempt_times:
        _signin_attempt_times[key] = []
    times = _signin_attempt_times[key]
    cutoff = now - SIGNIN_WINDOW_SECONDS
    _signin_attempt_times[key] = [t for t in times if t > cutoff]
    if len(_signin_attempt_times[key]) >= SIGNIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-in attempts. Please try again later."
        )


def _signin_rate_limit_record_failure(email: str) -> None:
    """Record a failed sign-in attempt for rate limiting."""
    now = time.time()
    key = email.lower().strip()
    if key not in _signin_attempt_times:
        _signin_attempt_times[key] = []
    _signin_attempt_times[key].append(now)


def _add_auth_audit(db: Session, user_id: str | None, action: str, details: dict) -> None:
    db.add(AuditLog(
        type="auth",
        action=action,
        user_id=user_id,
        details=details,
    ))


def _queue_login_mfa_email(
    background_tasks: BackgroundTasks,
    to_email: str,
    passcode: str,
    ip_address: str,
    challenge_id: str,
) -> None:
    subject = "Login Verification Code"
    body_text = (
        f"Your login verification code is: {passcode}\n\n"
        "This code will expire in 5 minutes.\n\n"
        "This was requested because your account is being signed in from a new IP, device, or network.\n"
        f"IP address: {ip_address}\n\n"
        "If this was not you, contact your administrator immediately.\n"
    )
    queue_email(
        background_tasks,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        flow_name="login_mfa",
        context={"challenge_id": challenge_id, "ip_address": ip_address},
    )


def _get_trusted_login_ip(db: Session, user_id: str, ip_address: str) -> UserLoginIP | None:
    return (
        db.query(UserLoginIP)
        .filter(UserLoginIP.user_id == user_id, UserLoginIP.ip_address == ip_address)
        .first()
    )


def _touch_trusted_login_ip(trusted_ip: UserLoginIP) -> None:
    now = datetime.utcnow()
    trusted_ip.last_seen_at = now
    trusted_ip.updated_at = now


def _trust_login_ip(db: Session, user_id: str, ip_address: str, verified_via_passcode: bool = True) -> tuple[UserLoginIP, bool]:
    trusted_ip = _get_trusted_login_ip(db, user_id, ip_address)
    if trusted_ip:
        _touch_trusted_login_ip(trusted_ip)
        if verified_via_passcode and not trusted_ip.verified_via_passcode:
            trusted_ip.verified_via_passcode = True
        return trusted_ip, False

    now = datetime.utcnow()
    trusted_ip = UserLoginIP(
        user_id=user_id,
        ip_address=ip_address,
        first_seen_at=now,
        last_seen_at=now,
        verified_via_passcode=verified_via_passcode,
        created_at=now,
        updated_at=now,
    )
    db.add(trusted_ip)
    return trusted_ip, True


def _load_user_role(user: User, db: Session) -> User:
    try:
        if user.role_id:
            user_with_role = db.query(User).options(joinedload(User.role)).filter(User.user_id == user.user_id).first()
            if user_with_role:
                return user_with_role
    except Exception as e:
        logger.warning(f"Could not load user role relationship: {str(e)}")
    return user


def _build_user_response(db: Session, user: User) -> UserResponse:
    user = _load_user_role(user, db)
    permissions = get_user_permissions(db, user)
    role = get_user_role_dict(user)
    return UserResponse(
        user_id=user.user_id,
        user_image=user.user_image,
        user_name=user.user_name,
        user_email=user.user_email,
        organization=getattr(user, "organization", None),
        organization_type=getattr(user, "organization_type", None),
        role_id=user.role_id,
        role=role,
        permissions=permissions,
        totp_enabled=totp_mfa.user_totp_enabled(user),
    )


def _complete_signin_success(
    db: Session,
    user: User,
    response: Response,
    normalized_email: str,
    ip_address: str,
) -> SignInSuccessResponse:
    user_response = _build_user_response(db, user)
    session_id = create_session(user.user_id, expires_hours=settings.SESSION_EXPIRE_HOURS)

    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=session_id,
        max_age=settings.SESSION_EXPIRE_HOURS * 60 * 60,
        httponly=settings.SESSION_COOKIE_HTTPONLY,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite=settings.SESSION_COOKIE_SAMESITE,
        path="/"
    )

    _add_auth_audit(
        db,
        user.user_id,
        "login",
        {"email": normalized_email, "ip_address": ip_address},
    )
    db.commit()

    logger.info(f"User signed in successfully: {user.user_email}")
    return SignInSuccessResponse(
        user=user_response,
        message="Sign-in successful",
        totp_setup_suggested=totp_mfa.user_totp_setup_suggested(user),
    )


@router.post("/signin", response_model=SignInSuccessResponse | SignInMfaRequiredResponse)
async def signin(
    body: SignInRequest,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    User sign-in endpoint. Requires JWT token in Authorization header (client-login first).
    Creates a session and sets a secure HTTP-only cookie.
    Rate-limited per email (failed attempts only) to reduce brute-force.
    """
    normalized_email = body.email.strip().lower()
    logger.info(f"User sign-in attempt: {normalized_email}")

    _signin_rate_limit_check(normalized_email)

    user = db.query(User).filter(User.user_email == normalized_email).first()
    if not user:
        _signin_rate_limit_record_failure(normalized_email)
        logger.warning(f"Sign-in failed: User not found - {normalized_email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    password_valid = False
    try:
        password_valid = verify_password(body.password, user.user_pwd)
    except Exception as exc:
        logger.debug("Password verification failed for %s: %s", normalized_email, exc)
    if not password_valid and user.user_pwd == body.password:
        password_valid = True
        user.user_pwd = get_password_hash(body.password)
        db.commit()
        logger.info(f"Migrated password to hash for user: {normalized_email}")

    if not password_valid:
        _signin_rate_limit_record_failure(normalized_email)
        logger.warning(f"Sign-in failed: Invalid credentials for email: {body.email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    if getattr(user, "is_active", True) is False:
        _signin_rate_limit_record_failure(normalized_email)
        logger.warning(f"Sign-in failed: Account deactivated - {normalized_email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is deactivated. Contact your administrator."
        )

    ip_address = _get_client_ip(request)
    trusted_ip = _get_trusted_login_ip(db, user.user_id, ip_address)
    if trusted_ip:
        _touch_trusted_login_ip(trusted_ip)
        return _complete_signin_success(db, user, response, normalized_email, ip_address)

    totp_enabled = totp_mfa.user_totp_enabled(user)
    default_method: Literal["email_passcode", "totp"] = "totp" if totp_enabled else "email_passcode"
    available_methods: list[Literal["email_passcode", "totp"]] = (
        ["totp", "email_passcode"] if totp_enabled else ["email_passcode"]
    )
    challenge_issue = login_mfa.create_login_challenge(
        user.user_id,
        user.user_email,
        ip_address,
        method=default_method,
    )
    if challenge_issue.status == "too_many_resends":
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login verification passcode requests. Please try again later.",
        )
    if not challenge_issue.challenge:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create login verification challenge.",
        )

    active_method = str(challenge_issue.challenge.get("method") or default_method)
    if active_method not in ("email_passcode", "totp"):
        active_method = default_method

    if active_method == "email_passcode" and challenge_issue.status == "issued":
        _add_auth_audit(
            db,
            user.user_id,
            "login_mfa_passcode_sent",
            {
                "email": normalized_email,
                "ip_address": ip_address,
                "challenge_id": challenge_issue.challenge["challenge_id"],
            },
        )
        db.commit()
        _queue_login_mfa_email(
            background_tasks,
            user.user_email,
            challenge_issue.passcode or "",
            ip_address,
            challenge_issue.challenge["challenge_id"],
        )
    elif challenge_issue.status == "cooldown":
        logger.info(
            f"Login MFA challenge already sent for user={user.user_id} ip={ip_address}; "
            f"cooldown_remaining={challenge_issue.cooldown_remaining}s"
        )
    elif active_method == "totp":
        _add_auth_audit(
            db,
            user.user_id,
            "login_mfa_totp_challenged",
            {
                "email": normalized_email,
                "ip_address": ip_address,
                "challenge_id": challenge_issue.challenge["challenge_id"],
            },
        )
        db.commit()

    message = (
        "Enter the 6-digit code from your authenticator app."
        if active_method == "totp"
        else "A verification passcode has been sent to your registered email."
    )
    return SignInMfaRequiredResponse(
        message=message,
        challenge_id=challenge_issue.challenge["challenge_id"],
        method=active_method,  # type: ignore[arg-type]
        methods=available_methods,
        default_method=active_method,  # type: ignore[arg-type]
    )


@router.post("/verify-login-passcode", response_model=SignInSuccessResponse)
async def verify_login_passcode(
    body: VerifyLoginPasscodeRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Verify a login MFA passcode and create the final session on success.
    """
    challenge = login_mfa.load_login_challenge(body.challenge_id)
    current_ip = _get_client_ip(request)

    if not challenge:
        _add_auth_audit(
            db,
            None,
            "login_mfa_failed",
            {"challenge_id": body.challenge_id, "reason": "challenge_not_found", "ip_address": current_ip},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Login verification challenge not found or expired.",
        )

    user_id = str(challenge.get("user_id") or "")
    challenge_ip = str(challenge.get("ip_address") or "")
    if challenge_ip != current_ip:
        _add_auth_audit(
            db,
            user_id or None,
            "login_mfa_failed",
            {
                "challenge_id": challenge.get("challenge_id"),
                "reason": "ip_mismatch",
                "challenge_ip": challenge_ip,
                "request_ip": current_ip,
            },
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login verification challenge does not match this IP address.",
        )

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user or getattr(user, "is_active", True) is False:
        _add_auth_audit(
            db,
            user_id or None,
            "login_mfa_failed",
            {
                "challenge_id": body.challenge_id,
                "reason": "user_inactive_or_missing",
                "ip_address": current_ip,
            },
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is not active. Contact your administrator.",
        )

    challenge_method = str(challenge.get("method") or "email_passcode")
    if challenge_method == "totp":
        secret = totp_mfa.decrypt_secret(getattr(user, "totp_secret", None))
        if not totp_mfa.user_totp_enabled(user) or not totp_mfa.verify_code(secret, body.passcode):
            verification = login_mfa.record_login_challenge_failure(challenge)
            failure_details = {
                "challenge_id": body.challenge_id,
                "reason": verification.status,
                "method": "totp",
                "ip_address": current_ip,
                "remaining_attempts": verification.remaining_attempts,
            }
            _add_auth_audit(db, user.user_id, "login_mfa_failed", failure_details)
            db.commit()
            if verification.status == "too_many_attempts":
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many invalid verification attempts. Please sign in again.",
                )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid verification passcode.",
            )
        login_mfa.consume_login_challenge(body.challenge_id, challenge)
    else:
        verification = login_mfa.verify_login_challenge(body.challenge_id, body.passcode)
        if verification.status != "verified":
            failure_details = {
                "challenge_id": body.challenge_id,
                "reason": verification.status,
                "method": "email_passcode",
                "ip_address": current_ip,
                "remaining_attempts": verification.remaining_attempts,
            }
            _add_auth_audit(db, user.user_id, "login_mfa_failed", failure_details)
            db.commit()

            if verification.status == "invalid":
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid verification passcode.",
                )
            if verification.status == "too_many_attempts":
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many invalid verification attempts. Please sign in again.",
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Login verification challenge not found or expired.",
            )

    normalized_email = _normalize_email(user.user_email)
    _add_auth_audit(
        db,
        user.user_id,
        "login_mfa_verified",
        {
            "email": normalized_email,
            "ip_address": current_ip,
            "challenge_id": body.challenge_id,
            "method": challenge_method,
        },
    )

    _, created = _trust_login_ip(db, user.user_id, current_ip, verified_via_passcode=True)
    if created:
        _add_auth_audit(
            db,
            user.user_id,
            "login_new_ip_trusted",
            {"email": normalized_email, "ip_address": current_ip},
        )

    return _complete_signin_success(db, user, response, normalized_email, current_ip)


@router.post("/resend-login-passcode", response_model=ResendLoginPasscodeResponse)
async def resend_login_passcode(
    body: ResendLoginPasscodeRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Resend/rotate the passcode for an active login MFA challenge.
    """
    challenge = login_mfa.load_login_challenge(body.challenge_id)
    current_ip = _get_client_ip(request)

    if not challenge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Login verification challenge not found or expired.",
        )

    user_id = str(challenge.get("user_id") or "")
    challenge_ip = str(challenge.get("ip_address") or "")
    if challenge_ip != current_ip:
        _add_auth_audit(
            db,
            user_id or None,
            "login_mfa_failed",
            {
                "challenge_id": body.challenge_id,
                "reason": "resend_ip_mismatch",
                "challenge_ip": challenge_ip,
                "request_ip": current_ip,
            },
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login verification challenge does not match this IP address.",
        )

    resend = login_mfa.ensure_email_passcode(challenge)
    if resend.status == "cooldown":
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Please wait {resend.cooldown_remaining} seconds before requesting another passcode.",
        )
    if resend.status == "too_many_resends":
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification passcode requests. Please sign in again.",
        )
    if resend.status != "issued" or not resend.challenge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Login verification challenge not found or expired.",
        )

    email = str(resend.challenge.get("email") or "")
    _add_auth_audit(
        db,
        user_id or None,
        "login_mfa_resend",
        {
            "email": email,
            "ip_address": current_ip,
            "challenge_id": body.challenge_id,
        },
    )
    db.commit()
    _queue_login_mfa_email(
        background_tasks,
        email,
        resend.passcode or "",
        current_ip,
        body.challenge_id,
    )
    return ResendLoginPasscodeResponse(message="A new verification passcode has been sent.")


def _load_session_user(request: Request, db: Session) -> User:
    user_id = get_current_user_id(request)
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user or getattr(user, "is_active", True) is False:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is not active. Contact your administrator.",
        )
    return user


@router.post("/switch-login-mfa-method", response_model=SwitchLoginMfaMethodResponse)
async def switch_login_mfa_method(
    body: SwitchLoginMfaMethodRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    challenge = login_mfa.load_login_challenge(body.challenge_id)
    current_ip = _get_client_ip(request)
    if not challenge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Login verification challenge not found or expired.",
        )

    user_id = str(challenge.get("user_id") or "")
    if str(challenge.get("ip_address") or "") != current_ip:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login verification challenge does not match this IP address.",
        )

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Login verification challenge not found or expired.",
        )

    totp_enabled = totp_mfa.user_totp_enabled(user)
    methods: list[Literal["email_passcode", "totp"]] = (
        ["totp", "email_passcode"] if totp_enabled else ["email_passcode"]
    )
    if body.method == "totp" and not totp_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Authenticator app is not enabled for this account.",
        )

    if body.method == "totp":
        updated = login_mfa.set_challenge_method_totp(challenge)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Login verification challenge not found or expired.",
            )
        _add_auth_audit(
            db,
            user.user_id,
            "login_mfa_method_switched",
            {"method": "totp", "challenge_id": body.challenge_id, "ip_address": current_ip},
        )
        db.commit()
        return SwitchLoginMfaMethodResponse(
            message="Enter the 6-digit code from your authenticator app.",
            method="totp",
            methods=methods,
            challenge_id=body.challenge_id,
        )

    issued = login_mfa.ensure_email_passcode(challenge)
    if issued.status == "cooldown":
        return SwitchLoginMfaMethodResponse(
            message=f"A verification passcode was already sent. Please wait {issued.cooldown_remaining} seconds to resend.",
            method="email_passcode",
            methods=methods,
            challenge_id=body.challenge_id,
        )
    if issued.status == "too_many_resends":
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification passcode requests. Please sign in again.",
        )
    if issued.status != "issued" or not issued.challenge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Login verification challenge not found or expired.",
        )

    _add_auth_audit(
        db,
        user.user_id,
        "login_mfa_method_switched",
        {"method": "email_passcode", "challenge_id": body.challenge_id, "ip_address": current_ip},
    )
    db.commit()
    if issued.passcode:
        _queue_login_mfa_email(
            background_tasks,
            user.user_email,
            issued.passcode,
            current_ip,
            body.challenge_id,
        )
    return SwitchLoginMfaMethodResponse(
        message="A verification passcode has been sent to your registered email.",
        method="email_passcode",
        methods=methods,
        challenge_id=body.challenge_id,
    )


@router.post("/mfa/totp/setup", response_model=TotpSetupResponse)
async def setup_totp(request: Request, db: Session = Depends(get_db)):
    user = _load_session_user(request, db)
    if totp_mfa.user_totp_enabled(user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Authenticator app is already enabled.",
        )

    secret = totp_mfa.generate_secret()
    user.totp_secret = totp_mfa.encrypt_secret(secret)
    user.totp_enabled = False
    user.modified_by = user.user_id
    otpauth_url = totp_mfa.provisioning_uri(secret, user.user_email)
    _add_auth_audit(db, user.user_id, "totp_setup_started", {"email": user.user_email})
    db.commit()
    return TotpSetupResponse(
        secret=secret,
        otpauth_url=otpauth_url,
        qr_data_uri=totp_mfa.qr_data_uri(otpauth_url),
    )


@router.post("/mfa/totp/confirm", response_model=TotpActionResponse)
async def confirm_totp(body: TotpConfirmRequest, request: Request, db: Session = Depends(get_db)):
    user = _load_session_user(request, db)
    if totp_mfa.user_totp_enabled(user):
        return TotpActionResponse(
            message="Authenticator app is already enabled.",
            totp_enabled=True,
            user=_build_user_response(db, user),
        )

    secret = totp_mfa.decrypt_secret(getattr(user, "totp_secret", None))
    if not totp_mfa.verify_code(secret, body.passcode):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authenticator code. Please try again.",
        )

    user.totp_enabled = True
    user.totp_prompt_seen = True
    user.preferred_mfa_method = "totp"
    user.totp_confirmed_at = datetime.utcnow()
    user.modified_by = user.user_id
    _add_auth_audit(db, user.user_id, "totp_enabled", {"email": user.user_email})
    db.commit()
    db.refresh(user)
    return TotpActionResponse(
        message="Authenticator app enabled.",
        totp_enabled=True,
        user=_build_user_response(db, user),
    )


@router.post("/mfa/totp/skip", response_model=TotpActionResponse)
async def skip_totp(request: Request, db: Session = Depends(get_db)):
    user = _load_session_user(request, db)
    if not totp_mfa.user_totp_enabled(user):
        user.totp_secret = None
        user.totp_enabled = False
        user.preferred_mfa_method = "email"
    user.totp_prompt_seen = True
    user.modified_by = user.user_id
    _add_auth_audit(db, user.user_id, "totp_skipped", {"email": user.user_email})
    db.commit()
    db.refresh(user)
    return TotpActionResponse(
        message="You can enable an authenticator later from your account menu.",
        totp_enabled=totp_mfa.user_totp_enabled(user),
        user=_build_user_response(db, user),
    )


@router.post("/mfa/totp/disable", response_model=TotpActionResponse)
async def disable_totp(body: TotpDisableRequest, request: Request, db: Session = Depends(get_db)):
    user = _load_session_user(request, db)
    if not totp_mfa.user_totp_enabled(user):
        return TotpActionResponse(
            message="Authenticator app is not enabled.",
            totp_enabled=False,
            user=_build_user_response(db, user),
        )

    password_valid = False
    try:
        password_valid = verify_password(body.password, user.user_pwd)
    except Exception:
        password_valid = False
    secret = totp_mfa.decrypt_secret(getattr(user, "totp_secret", None))
    if not password_valid or not totp_mfa.verify_code(secret, body.passcode):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password or authenticator code is incorrect.",
        )

    user.totp_secret = None
    user.totp_enabled = False
    user.preferred_mfa_method = "email"
    user.totp_confirmed_at = None
    user.modified_by = user.user_id
    _add_auth_audit(db, user.user_id, "totp_disabled", {"email": user.user_email})
    db.commit()
    db.refresh(user)
    return TotpActionResponse(
        message="Authenticator app disabled. Email verification will be used on unknown networks.",
        totp_enabled=False,
        user=_build_user_response(db, user),
    )


@router.post("/refresh", response_model=ClientLoginResponse)
async def refresh_token(
    request: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """
    Refresh JWT access token using refresh token.
    """
    logger.info("Token refresh attempt")

    # Verify refresh token
    payload = verify_refresh_token(request.refresh_token)

    if not payload:
        logger.warning("Invalid or expired refresh token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )

    # Extract client_id from refresh token
    client_id = payload.get("client_id")
    if not client_id:
        logger.warning("Refresh token missing client_id")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )

    # Create new access token
    token_data = {
        "client_id": client_id,
        "type": "client_access"
    }
    access_token = create_jwt_token(token_data)

    # Optionally create new refresh token (rotate refresh token)
    refresh_token = create_refresh_token(token_data)

    expires_in = settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60  # Convert to seconds

    logger.info(f"Token refreshed successfully for client: {client_id}")

    return ClientLoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=expires_in
    )


@router.post("/signout")
async def signout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    User sign-out endpoint.
    Deletes the session and clears the cookie.
    """
    # Get session ID from cookie
    session_id = request.cookies.get(settings.SESSION_COOKIE_NAME)

    if session_id:
        # Delete session
        delete_session(session_id)

        # Get user ID for audit log
        user_id = get_user_id_from_session(session_id)
        if user_id:
            audit_log = AuditLog(
                type="auth",
                action="logout",
                user_id=user_id,
                details={}
            )
            db.add(audit_log)
            db.commit()

    # Clear cookie
    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME,
        path="/",
        samesite=settings.SESSION_COOKIE_SAMESITE
    )

    logger.info("User signed out")
    return {"message": "Sign-out successful"}


class ForgotPasswordRequest(BaseModel):
    """Forgot password request."""
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str


class VerifyForgotPasswordPasscodeRequest(BaseModel):
    """Forgot-password passcode verification request."""
    email: EmailStr
    passcode: str


class VerifyForgotPasswordPasscodeResponse(BaseModel):
    message: str
    reset_token: str
    expires_in: int


class ResetPasswordRequest(BaseModel):
    """Final password reset request after passcode verification."""
    email: EmailStr
    reset_token: str
    new_password: str


class ResetPasswordResponse(BaseModel):
    message: str


def _forgot_password_otp_key(email_normalized: str) -> str:
    return f"forgot_password:{_normalize_email(email_normalized)}"


def _forgot_password_generic_message() -> str:
    return "If an account with that email exists, a temporary password has been sent."


def _generate_temporary_password(length: int = 12) -> str:
    length = max(8, length)
    required = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice("!@#$%^&*()-_=+[]{};:,.?/"),
    ]
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()-_=+[]{};:,.?/"
    remaining = [secrets.choice(alphabet) for _ in range(length - len(required))]
    chars = required + remaining
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def _queue_forgot_password_temporary_password_email(
    background_tasks: BackgroundTasks,
    to_email: str,
    temporary_password: str,
) -> None:
    subject = "AI Workbench Temporary Password"
    body_text = (
        "A temporary password has been generated for your account.\n\n"
        f"Temporary password: {temporary_password}\n\n"
        "Please sign in using this temporary password and change it immediately.\n\n"
        "If you did not request a password reset, contact your system administrator immediately.\n"
    )
    queue_email(
        background_tasks,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        flow_name="forgot_password_temporary_password",
        context={"purpose": "forgot_password"},
    )


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(
    request_data: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Send a temporary password via email.
    The existing password is replaced immediately when a valid request is processed.
    """
    email_lower = _normalize_email(str(request_data.email))
    logger.info(f"Forgot password request for email: {email_lower}")

    # Rate limit: avoid sending multiple emails for same address
    now = time.time()
    if email_lower in _forgot_password_last_sent:
        elapsed = now - _forgot_password_last_sent[email_lower]
        if elapsed < FORGOT_PASSWORD_COOLDOWN_SECONDS:
            logger.info(f"Forgot password rate-limited for {email_lower} (cooldown {int(FORGOT_PASSWORD_COOLDOWN_SECONDS - elapsed)}s remaining)")
            return ForgotPasswordResponse(message=_forgot_password_generic_message())

    # Find user by email
    user = db.query(User).filter(func.lower(User.user_email) == email_lower).first()

    if not user:
        logger.warning(f"Forgot password request for non-existent email: {request_data.email}")
        return ForgotPasswordResponse(message=_forgot_password_generic_message())

    # Only active users can receive password reset (deactivated users cannot sign in)
    if getattr(user, "is_active", True) is False:
        logger.info(f"Forgot password skipped for deactivated account: {request_data.email}")
        return ForgotPasswordResponse(message=_forgot_password_generic_message())

    temporary_password = _generate_temporary_password()
    user.user_pwd = get_password_hash(temporary_password)

    audit_log = AuditLog(
        type="auth",
        action="forgot_password_temporary_password_sent",
        user_id=user.user_id,
        details={"email": user.user_email, "temporary_password_sent": True}
    )
    db.add(audit_log)
    db.commit()

    _forgot_password_last_sent[email_lower] = now
    _queue_forgot_password_temporary_password_email(background_tasks, user.user_email, temporary_password)
    logger.info(f"Temporary password email queued for {user.user_email}")
    return ForgotPasswordResponse(message=_forgot_password_generic_message())


@router.post("/forgot-password/verify-passcode", response_model=VerifyForgotPasswordPasscodeResponse)
async def verify_forgot_password_passcode(
    request_data: VerifyForgotPasswordPasscodeRequest,
    db: Session = Depends(get_db),
):
    """
    Verify the forgot-password passcode and issue a short-lived reset token.
    """
    email_lower = _normalize_email(str(request_data.email))
    otp_key = _forgot_password_otp_key(email_lower)
    result = _otp_verify(otp_key, request_data.passcode)

    if result == "verified":
        user = db.query(User).filter(func.lower(User.user_email) == email_lower).first()
        if not user or getattr(user, "is_active", True) is False:
            _otp_consume_verification(otp_key)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired passcode. Please request a new code.",
            )

        reset_token = password_reset.issue_reset_token(email_lower, user.user_id)
        _otp_consume_verification(otp_key)

        db.add(AuditLog(
            type="auth",
            action="forgot_password_passcode_verified",
            user_id=user.user_id,
            details={"email": user.user_email},
        ))
        db.commit()

        return VerifyForgotPasswordPasscodeResponse(
            message="Passcode verified. You can now set a new password.",
            reset_token=reset_token,
            expires_in=password_reset.PASSWORD_RESET_TOKEN_EXPIRES_SECONDS,
        )

    if result == "too_many_attempts":
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many passcode verification attempts. Please request a new code.",
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid or expired passcode. Please request a new code.",
    )


@router.post("/reset-password", response_model=ResetPasswordResponse)
async def reset_password(
    request_data: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Set a user-chosen password after a forgot-password passcode has been verified.
    """
    email_lower = _normalize_email(str(request_data.email))

    password_feedback = _build_password_validation_response(request_data.new_password)
    if not password_feedback.is_valid:
        detail = password_feedback.model_dump()
        detail["message"] = "Password does not meet security requirements"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    token_payload = password_reset.consume_reset_token(email_lower, request_data.reset_token)
    if not token_payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset session expired. Please request a new passcode.",
        )

    user_id = str(token_payload.get("user_id") or "")
    user = (
        db.query(User)
        .filter(User.user_id == user_id, func.lower(User.user_email) == email_lower)
        .first()
    )
    if not user or getattr(user, "is_active", True) is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset session expired. Please request a new passcode.",
        )

    user.user_pwd = get_password_hash(request_data.new_password)
    db.add(AuditLog(
        type="auth",
        action="forgot_password_reset",
        user_id=user.user_id,
        details={"email": user.user_email, "password_reset": True},
    ))
    db.commit()
    _forgot_password_last_sent.pop(email_lower, None)

    logger.info(f"Password reset completed for {user.user_email}")
    return ResetPasswordResponse(message="Password updated successfully. Please sign in with your new password.")


@router.get("/user", response_model=UserResponse)
async def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Get current authenticated user from session.
    """
    # Get session ID from cookie
    session_id = request.cookies.get(settings.SESSION_COOKIE_NAME)

    if not session_id:
        logger.warning("Get current user failed: No session cookie")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    # Get user ID from session
    user_id = get_user_id_from_session(session_id)

    if not user_id:
        logger.warning("Get current user failed: Invalid or expired session")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid"
        )

    # Get user from database
    user = db.query(User).filter(User.user_id == user_id).first()

    if not user:
        logger.warning(f"Get current user failed: User not found - {user_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Get permissions and role
    permissions = get_user_permissions(db, user)
    role = get_user_role_dict(user)

    return UserResponse(
        user_id=user.user_id,
        user_image=user.user_image,
        user_name=user.user_name,
        user_email=user.user_email,
        organization=getattr(user, "organization", None),
        role_id=user.role_id,
        role=role,
        permissions=permissions,
        totp_enabled=totp_mfa.user_totp_enabled(user),
    )


@router.patch("/user", response_model=UserResponse)
async def update_profile(
    data: ProfileUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Update current user profile (user_name, organization, user_image only)."""
    session_id = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user_id = get_user_id_from_session(session_id)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if data.user_name is not None:
        user.user_name = data.user_name[:25] if len(data.user_name) > 25 else data.user_name
    if data.organization is not None:
        user.organization = data.organization[:100] if len(data.organization) > 100 else data.organization
    if data.user_image is not None:
        user.user_image = data.user_image
    user.modified_by = user_id
    db.commit()
    db.refresh(user)
    permissions = get_user_permissions(db, user)
    role = get_user_role_dict(user)
    return UserResponse(
        user_id=user.user_id,
        user_image=user.user_image,
        user_name=user.user_name,
        user_email=user.user_email,
        organization=getattr(user, "organization", None),
        organization_type=getattr(user, "organization_type", None),
        role_id=user.role_id,
        role=role,
        permissions=permissions,
        totp_enabled=totp_mfa.user_totp_enabled(user),
    )


@router.post("/change-password", response_model=ChangePasswordResponse)
async def change_password(
    data: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Change password for the currently signed-in user."""
    session_id = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = get_user_id_from_session(session_id)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if getattr(user, "is_active", True) is False:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is deactivated.")

    old_password = (data.old_password or "").strip()
    new_password = data.new_password or ""
    confirm_password = data.confirm_password or ""

    if not old_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is required.")
    if new_password != confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password and confirm password do not match.")

    old_password_valid = False
    try:
        old_password_valid = verify_password(old_password, user.user_pwd)
    except Exception:
        old_password_valid = False
    if not old_password_valid and user.user_pwd == old_password:
        old_password_valid = True
        user.user_pwd = get_password_hash(old_password)

    if not old_password_valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect.")

    if old_password == new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different from current password.")

    password_feedback = _build_password_validation_response(new_password)
    if not password_feedback.is_valid:
        detail = password_feedback.model_dump()
        detail["message"] = "Password does not meet security requirements"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    user.user_pwd = get_password_hash(new_password)
    user.modified_by = user.user_id
    db.add(AuditLog(
        type="auth",
        action="password_changed",
        user_id=user.user_id,
        details={"email": user.user_email}
    ))
    db.commit()

    return ChangePasswordResponse(message="Password changed successfully.")


@router.post("/verify-current-password", response_model=VerifyCurrentPasswordResponse)
async def verify_current_password(
    data: VerifyCurrentPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Verify the user's current password (e.g. on blur in change-password UI). Does not change the password or invalidate the session."""
    session_id = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = get_user_id_from_session(session_id)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if getattr(user, "is_active", True) is False:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is deactivated.")

    password = (data.password or "").strip()
    if not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is required.")

    old_password_valid = False
    try:
        old_password_valid = verify_password(password, user.user_pwd)
    except Exception:
        old_password_valid = False
    if not old_password_valid and user.user_pwd == password:
        old_password_valid = True

    if not old_password_valid:
        # 400 so clients do not treat this like an expired session (401).
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")

    return VerifyCurrentPasswordResponse(valid=True)
