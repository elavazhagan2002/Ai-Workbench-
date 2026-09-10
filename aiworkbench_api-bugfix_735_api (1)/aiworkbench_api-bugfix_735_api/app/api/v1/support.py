"""
Support contact endpoints.
"""
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, field_validator

from app.core.config import settings
from app.core.logging_config import logger
from app.utils.background_email import queue_email

router = APIRouter()

SUCCESS_MESSAGE = (
    "Your request has reached the Sciagen support desk. "
    "Our team will review it and get back to you within 24 hours."
)


def _sanitize_single_line(value: object, field_name: str, max_length: int, required: bool) -> str | None:
    text = "" if value is None else str(value)
    normalized = " ".join(text.strip().split())
    if not normalized:
        if required:
            raise ValueError(f"{field_name} is required")
        return None
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} must be at most {max_length} characters")
    return normalized


def _sanitize_message(value: object) -> str:
    text = "" if value is None else str(value)
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise ValueError("message is required")
    if len(normalized) < 10:
        raise ValueError("message must be at least 10 characters")
    if len(normalized) > 3000:
        raise ValueError("message must be at most 3000 characters")
    return normalized


def _resolve_support_recipient() -> str:
    for candidate in (
        settings.SUPPORT_CONTACT_EMAIL,
        settings.SMTP_FROM_EMAIL,
        settings.SMTP_USER,
    ):
        recipient = (candidate or "").strip()
        if recipient:
            return recipient

    logger.error("Support contact email recipient could not be resolved from configuration")
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Support email configuration is unavailable.",
    )


class ContactSupportRequest(BaseModel):
    full_name: str
    email: EmailStr
    company: str | None = None
    phone: str | None = None
    service_area: str
    subject: str
    message: str

    @field_validator("full_name", mode="before")
    @classmethod
    def validate_full_name(cls, value: object) -> str:
        return _sanitize_single_line(value, "full_name", 100, True)

    @field_validator("email", mode="before")
    @classmethod
    def validate_email(cls, value: object) -> str:
        email = _sanitize_single_line(value, "email", 255, True)
        if email is None:
            raise ValueError("email is required")
        return email

    @field_validator("company", mode="before")
    @classmethod
    def validate_company(cls, value: object) -> str | None:
        return _sanitize_single_line(value, "company", 150, False)

    @field_validator("phone", mode="before")
    @classmethod
    def validate_phone(cls, value: object) -> str | None:
        return _sanitize_single_line(value, "phone", 30, False)

    @field_validator("service_area", mode="before")
    @classmethod
    def validate_service_area(cls, value: object) -> str:
        return _sanitize_single_line(value, "service_area", 100, True)

    @field_validator("subject", mode="before")
    @classmethod
    def validate_subject(cls, value: object) -> str:
        return _sanitize_single_line(value, "subject", 150, True)

    @field_validator("message", mode="before")
    @classmethod
    def validate_message(cls, value: object) -> str:
        return _sanitize_message(value)


class ContactSupportResponse(BaseModel):
    success: bool
    message: str


@router.post("/contact", response_model=ContactSupportResponse)
async def submit_contact_support(
    body: ContactSupportRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(
        f"Contact support submission received from {body.email} "
        f"for service area '{body.service_area}' from IP {client_ip}"
    )

    recipient_email = _resolve_support_recipient()
    logger.info(f"Contact support recipient resolved to {recipient_email}")

    company = body.company or "-"
    phone = body.phone or "-"

    internal_subject = f"[Sciagen Support Desk] New Contact Request - {body.service_area} - {body.subject}"
    internal_body = (
        "A new contact request has been submitted through the Sciagen AI Governance Workbench support form.\n\n"
        "Contact Snapshot\n"
        "----------------\n"
        f"Full Name     : {body.full_name}\n"
        f"Email         : {body.email}\n"
        f"Company       : {company}\n"
        f"Phone         : {phone}\n"
        f"Service Area  : {body.service_area}\n"
        f"Subject       : {body.subject}\n\n"
        "Message\n"
        "-------\n"
        f"{body.message}\n\n"
        "Routing Notes\n"
        "-------------\n"
        f"Assigned Inbox : {recipient_email}\n"
        f"Reply To       : {body.email}\n"
        "Source         : Contact Support Page\n"
        "Platform       : AI Governance Workbench\n\n"
        "This request was submitted by a user seeking assistance from the Sciagen team.\n"
        "Please review and follow up with the user appropriately.\n"
    )

    queue_email(
        background_tasks,
        to_email=recipient_email,
        subject=internal_subject,
        body_text=internal_body,
        flow_name="support_contact_internal",
        context={"submitter_email": body.email, "service_area": body.service_area, "client_ip": client_ip},
    )
    logger.info(f"Internal support email queued for submitter {body.email}")

    acknowledgement_subject = "Your request is with us - Sciagen Support"
    acknowledgement_body = (
        f"Hello {body.full_name},\n\n"
        "Thank you for reaching out to Sciagen.\n\n"
        "Your message has been received and routed to the appropriate team. "
        "A member of our team will review your request and get back to you as soon as possible, "
        "typically within 24 hours.\n\n"
        "Request Summary\n"
        "---------------\n"
        f"Service Area : {body.service_area}\n"
        f"Subject      : {body.subject}\n\n"
        "Message\n"
        "-------\n"
        f"{body.message}\n\n"
        "We appreciate your interest and patience.\n"
        "A real person from the Sciagen team will follow up with you shortly.\n\n"
        "Regards,\n"
        "Sciagen Support Team\n"
        "AI Governance Workbench\n"
    )

    queue_email(
        background_tasks,
        to_email=str(body.email),
        subject=acknowledgement_subject,
        body_text=acknowledgement_body,
        flow_name="support_contact_acknowledgement",
        context={"service_area": body.service_area, "client_ip": client_ip},
    )

    return ContactSupportResponse(success=True, message=SUCCESS_MESSAGE)
