"""
Notification email templates for workflow events.
"""
from __future__ import annotations

import html
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.logging_config import logger
from app.models import Domain, Role, UseCase, User
from app.services.notification_service import (
    create_notification,
    create_notifications_for_admins,
    create_notifications_for_users,
    dismiss_stale_use_case_action_notifications,
    governor_user_ids,
    notify_assigner_and_domain_owner,
    stakeholder_recipient_ids,
    use_case_edit_link,
    use_case_stakeholder_ids,
)
from app.utils.background_email import queue_email


def _display_name(user: User | None) -> str:
    if not user:
        return "Unknown user"
    return (getattr(user, "user_name", None) or getattr(user, "user_email", None) or "Unknown user").strip()


def _email(value: str | None) -> str:
    return (value or "").strip()


def _is_usable_email(value: str | None) -> bool:
    email = _email(value)
    return bool(email and "@" in email)


def _format_dt(value: datetime | None = None) -> str:
    current = value or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return current.strftime("%B %d, %Y")


def _never_raise(fn):
    """Keep workflow APIs intact if email or inbox writes fail."""

    def wrapped(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:
            logger.exception("Notification flow failed: %s", fn.__name__)
            return None

    return wrapped


def get_active_admin_emails(db: Session) -> list[str]:
    admin_role = db.query(Role).filter(Role.role_name == "portal_admin").first()
    if not admin_role:
        admin_role = db.query(Role).filter(Role.role_name == "Admin").first()
    if not admin_role:
        logger.warning("Admin notification skipped: Admin role not found")
        return []

    admins = (
        db.query(User)
        .filter(User.role_id == admin_role.role_id, User.is_active.is_(True))
        .all()
    )

    seen: set[str] = set()
    emails: list[str] = []
    for admin in admins:
        email = _email(getattr(admin, "user_email", None)).lower()
        if not _is_usable_email(email) or email in seen:
            continue
        seen.add(email)
        emails.append(email)
    return emails


def get_governor_emails(db: Session, domain_id: str | None) -> list[str]:
    ids = governor_user_ids(db, domain_id)
    if not ids:
        return []
    users = db.query(User).filter(User.user_id.in_(ids), User.is_active.is_(True)).all()
    seen: set[str] = set()
    emails: list[str] = []
    for user in users:
        email = _email(getattr(user, "user_email", None)).lower()
        if not _is_usable_email(email) or email in seen:
            continue
        seen.add(email)
        emails.append(email)
    return emails


def _notify_governors(
    db: Session,
    domain_id: str | None,
    subject: str,
    body_text: str,
    *,
    background_tasks: BackgroundTasks | None = None,
    flow_name: str,
    context: Mapping[str, object] | None = None,
) -> None:
    recipients = get_governor_emails(db, domain_id)
    if not recipients:
        logger.warning(f"Governor notification skipped: no recipients for {subject!r}")
        return
    email_context = {"governor_recipient_count": len(recipients)}
    if context:
        email_context.update(context)
    _send_many(
        recipients,
        subject,
        body_text,
        background_tasks=background_tasks,
        flow_name=flow_name,
        context=email_context,
    )


def _send_many(
    recipients: Iterable[str],
    subject: str,
    body_text: str,
    *,
    background_tasks: BackgroundTasks | None = None,
    flow_name: str = "notification",
    context: Mapping[str, object] | None = None,
) -> None:
    queued_count = 0
    email_context = {"subject": subject}
    if context:
        email_context.update(context)
    for recipient in recipients:
        if not _is_usable_email(recipient):
            continue
        queue_email(
            background_tasks,
            to_email=recipient,
            subject=subject,
            body_text=body_text,
            flow_name=flow_name,
            context=email_context,
        )
        queued_count += 1
    logger.info(f"Notification email queued_count={queued_count} subject={subject!r} flow={flow_name}")


def _notify_admins(
    db: Session,
    subject: str,
    body_text: str,
    *,
    background_tasks: BackgroundTasks | None = None,
    flow_name: str,
    context: Mapping[str, object] | None = None,
) -> None:
    recipients = get_active_admin_emails(db)
    if not recipients:
        logger.warning(f"Admin notification skipped: no active admin recipients for {subject!r}")
        return
    email_context = {"admin_recipient_count": len(recipients)}
    if context:
        email_context.update(context)
    _send_many(
        recipients,
        subject,
        body_text,
        background_tasks=background_tasks,
        flow_name=flow_name,
        context=email_context,
    )


def send_welcome_email(
    user: User,
    approved_at: datetime | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    recipient = _email(getattr(user, "user_email", None))
    if not _is_usable_email(recipient):
        logger.warning(f"Welcome email skipped: invalid recipient for user {getattr(user, 'user_id', None)}")
        return

    name = _display_name(user)
    access_date = _format_dt(approved_at)
    subject = "Welcome to AI Governance Workbench"
    body_text = f"""Dear {name},

Warm greetings from Sciagen!

We are delighted to welcome you to the AI Governance Workbench. Your account request has been approved, and you can now sign in with your registered email address.

At Sciagen, AI Governance Workbench helps teams bring structure, accountability, and visibility to governed AI initiatives. It gives you a secure place to collaborate on domains, use cases, risk reviews, documentation, and audit-ready governance activities.

As you begin this new chapter, here is what you can expect:

- A collaborative workspace for governed AI initiatives
- Access to domains assigned by your administrator
- Opportunities to contribute to AI use cases and reviews
- Support for responsible, transparent, and well-documented AI delivery

Your AI Governance Workbench access begins on {access_date}.

If you have any questions or need assistance, please contact your administrator.

Once again, welcome to Sciagen. We look forward to achieving great things together.

Warm regards,
AI Governance Workbench Team
Sciagen Pvt. Ltd.

"Innovation starts with people - and today, that includes you."
"""

    queue_email(
        background_tasks,
        to_email=recipient,
        subject=subject,
        body_text=body_text,
        flow_name="welcome",
        context={"user_id": getattr(user, "user_id", None), "approved_at": access_date},
    )


def notify_admins_new_registration(
    db: Session,
    user: User,
    interested_domain_name: str | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    subject = "New Registration Pending Approval"
    body_text = f"""Hello Admin,

A new user has completed email verification and is waiting for access approval in AI Governance Workbench.

Name: {_display_name(user)}
Email: {getattr(user, "user_email", "")}
Organization: {getattr(user, "organization", None) or "Not provided"}
Organization type: {getattr(user, "organization_type", None) or "Not provided"}
Interested domain: {interested_domain_name or getattr(user, "interested_domain_id", None) or "Not provided"}
Status: Pending approval

Please review this request from the admin pending registrations panel. You can approve the user to grant access or reject the request if access should not be granted.

Regards,
AI Governance Workbench Notifications
"""
    _notify_admins(
        db,
        subject,
        body_text,
        background_tasks=background_tasks,
        flow_name="admin_new_registration",
        context={
            "user_id": getattr(user, "user_id", None),
            "interested_domain": interested_domain_name or getattr(user, "interested_domain_id", None),
        },
    )
    create_notifications_for_admins(
        db,
        actor_user_id=getattr(user, "user_id", None),
        type="registration_pending",
        title="New registration pending approval",
        message=(
            f"{_display_name(user)} ({getattr(user, 'user_email', '')}) is waiting for access approval."
        ),
        severity="critical",
        entity_type="user",
        entity_id=getattr(user, "user_id", None),
        link="#/settings",
        actions=["open"],
        payload={
            "interested_domain": interested_domain_name or getattr(user, "interested_domain_id", None),
        },
    )


def send_registration_pending_email(
    user: User,
    interested_domain_name: str | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    recipient = _email(getattr(user, "user_email", None))
    if not _is_usable_email(recipient):
        logger.warning(f"Registration pending email skipped: invalid recipient for user {getattr(user, 'user_id', None)}")
        return

    name = _display_name(user)
    domain_name = interested_domain_name or "your selected domain"
    subject = "Registration Received - Awaiting Admin Approval"
    body_text = f"""Dear {name},

Welcome to AI Governance Workbench.

Your registration has been submitted successfully and is now waiting for admin approval.

You are one step away from accessing Sciagen's AI Governance Workbench.

Requested domain: {domain_name}
Current status: Pending admin approval

Once an administrator approves your request, you will receive a welcome email and can sign in with your registered email address.

Thank you for choosing Sciagen. We are excited to have you with us.

Warm regards,
AI Governance Workbench Team
Sciagen Pvt. Ltd.
"""
    safe_name = html.escape(name, quote=True)
    safe_domain_name = html.escape(domain_name, quote=True)
    body_html = f"""
<p>Dear {safe_name},</p>
<p>Welcome to AI Governance Workbench.</p>
<div style="margin: 20px 0; padding: 18px; background-color: #eef9fc; border: 1px solid #bde8f1; border-radius: 8px;">
    <p style="margin: 0 0 8px; color: #066b86; font-size: 13px; font-weight: 700; text-transform: uppercase;">Initial Welcome</p>
    <p style="margin: 0; color: #071c2f; font-size: 20px; font-weight: 700;">You are one step away from Sciagen.</p>
    <p style="margin: 10px 0 0; color: #1d4b5a;">Your registration is successful and is now waiting for admin approval.</p>
</div>
<div style="margin: 20px 0; padding: 16px; background-color: #f7fbff; border: 1px solid #dbe5f0; border-radius: 8px;">
    <p style="margin: 0 0 8px;"><strong style="color: #066b86;">Requested domain:</strong> {safe_domain_name}</p>
    <p style="margin: 0;"><strong style="color: #d08700;">Current status:</strong> Pending admin approval</p>
</div>
<p>Once an administrator approves your request, you will receive a welcome email and can sign in with your registered email address.</p>
<p>Thank you for choosing Sciagen. We are excited to have you with us.</p>
<p>Warm regards,<br>AI Governance Workbench Team<br>Sciagen Pvt. Ltd.</p>
"""

    queue_email(
        background_tasks,
        to_email=recipient,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        flow_name="registration_pending",
        context={
            "user_id": getattr(user, "user_id", None),
            "interested_domain": interested_domain_name or getattr(user, "interested_domain_id", None),
        },
    )


def send_idea_thank_you_email(
    to_email: str | None,
    domain: Domain | None,
    idea_id: str,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    recipient = _email(to_email)
    if not _is_usable_email(recipient):
        return

    domain_name = getattr(domain, "domain_name", None) or "the selected domain"
    subject = "Thank You for Sharing Your AI Workbench Idea"
    note_text = "NOTE: This is an automated message, please do not reply. If you have any questions, please contact your administrator."
    body_text = f"""Dear Contributor,

Thank you for sharing your idea with the AI Governance Workbench team.

We have received your submission for {domain_name}. Our administrators will review it and decide whether it should be qualified into a governed AI use case.

Reference ID: {idea_id}

Your input helps Sciagen identify valuable AI opportunities and improve how ideas move into responsible, well-governed execution.

{note_text}

Warm regards,
AI Governance Workbench Team
Sciagen Pvt. Ltd.
"""
    safe_domain_name = html.escape(domain_name, quote=True)
    safe_idea_id = html.escape(str(idea_id), quote=True)
    safe_note_text = html.escape(note_text, quote=True)
    body_html = f"""
<p>Dear Contributor,</p>
<p>Thank you for sharing your idea with the AI Governance Workbench team.</p>
<p>We have received your submission for {safe_domain_name}. Our administrators will review it and decide whether it should be qualified into a governed AI use case.</p>
<p>Reference ID: <strong>{safe_idea_id}</strong></p>
<p>Your input helps Sciagen identify valuable AI opportunities and improve how ideas move into responsible, well-governed execution.</p>
<div class="warning-box"><strong>{safe_note_text}</strong></div>
<p>Warm regards,<br>AI Governance Workbench Team<br>Sciagen Pvt. Ltd.</p>
"""

    queue_email(
        background_tasks,
        to_email=recipient,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        flow_name="anonymous_idea_thank_you",
        context={"idea_id": idea_id, "domain_id": getattr(domain, "domain_id", None)},
    )


def notify_admins_new_domain(
    db: Session,
    domain: Domain,
    created_by: User | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    subject = "New Domain Created in AI Governance Workbench"
    body_text = f"""Hello Admin,

A new domain has been created in AI Governance Workbench.

Domain name: {getattr(domain, "domain_name", "")}
Short name: {getattr(domain, "domain_short_name", "")}
Owner user ID: {getattr(domain, "owner_id", None) or "Not assigned"}
Created by: {_display_name(created_by)}
Created date: {_format_dt(getattr(domain, "created_dt", None))}

Please review domain ownership and access assignments if any follow-up is needed.

Regards,
AI Governance Workbench Notifications
"""
    _notify_admins(
        db,
        subject,
        body_text,
        background_tasks=background_tasks,
        flow_name="admin_new_domain",
        context={
            "domain_id": getattr(domain, "domain_id", None),
            "created_by_user_id": getattr(created_by, "user_id", None),
        },
    )
    create_notifications_for_admins(
        db,
        actor_user_id=getattr(created_by, "user_id", None),
        type="domain_created",
        title="New domain created",
        message=f"Domain “{getattr(domain, 'domain_name', '')}” was created by {_display_name(created_by)}.",
        severity="info",
        entity_type="domain",
        entity_id=getattr(domain, "domain_id", None),
        domain_id=getattr(domain, "domain_id", None),
        link="#/domains",
        actions=["open"],
    )


@_never_raise
def notify_admins_new_use_case(
    db: Session,
    use_case: UseCase,
    domain: Domain | None,
    created_by: User | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    domain_id = getattr(domain, "domain_id", None) or getattr(use_case, "domain_id", None)
    domain_name = getattr(domain, "domain_name", None) or domain_id or ""
    uc_title = getattr(use_case, "use_case_title", None) or getattr(use_case, "use_case_name", "")
    subject = "New Use Case Ready for Analysis Assignment"
    body_text = f"""Hello,

A new use case is in New status and is ready for Analysis assignment.

Use case name: {getattr(use_case, "use_case_name", "")}
Use case title: {getattr(use_case, "use_case_title", None) or "Not provided"}
Domain: {domain_name}
Status: {getattr(use_case, "status", "")}
Created by: {_display_name(created_by)}
Created date: {_format_dt(getattr(use_case, "created_dt", None))}

Please assign Technical and Business owners to move this use case to Analysis.

Regards,
AI Governance Workbench Notifications
"""
    _notify_governors(
        db,
        domain_id,
        subject,
        body_text,
        background_tasks=background_tasks,
        flow_name="admin_new_use_case",
        context={
            "use_case_id": getattr(use_case, "use_case_id", None),
            "domain_id": domain_id,
            "created_by_user_id": getattr(created_by, "user_id", None),
        },
    )
    create_notifications_for_users(
        db,
        recipient_user_ids=governor_user_ids(db, domain_id),
        actor_user_id=getattr(created_by, "user_id", None),
        type="use_case_created",
        title="New use case ready for Analysis",
        message=(
            f"“{uc_title}” was created by {_display_name(created_by)} in {domain_name}. "
            "Assign Technical and Business owners."
        ),
        severity="critical",
        entity_type="use_case",
        entity_id=getattr(use_case, "use_case_id", None),
        domain_id=domain_id,
        link=use_case_edit_link(
            domain_id=domain_id,
            use_case_id=use_case.use_case_id,
            section="basic",
            action="assign-analysis",
        ),
        actions=["open", "reassign"],
        payload={"use_case_title": uc_title, "status": "New"},
        commit=True,
    )


@_never_raise
def notify_analysis_assignment(
    db: Session,
    use_case: UseCase,
    *,
    technical_owner: User | None,
    business_owner: User | None,
    assigner: User | None,
    due_date: datetime | None,
    background_tasks: BackgroundTasks | None = None,
    include_technical: bool = True,
    include_business: bool = True,
) -> None:
    """Email technical and business owners about Analysis assignment."""
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    due_label = _format_dt(due_date) if due_date else "Not specified"
    assigner_name = _display_name(assigner)
    actor_id = getattr(assigner, "user_id", None)

    owners = []
    if include_technical:
        owners.append((technical_owner, "Technical", "tech_analysis"))
    if include_business:
        owners.append((business_owner, "Business", "business_analysis"))

    for owner, track, section in owners:
        if not owner:
            continue
        create_notification(
            db,
            recipient_user_id=owner.user_id,
            actor_user_id=actor_id,
            type="analysis_assigned",
            title=f"{track} Analysis assigned",
            message=f"You were assigned as {track} Owner on “{title}”. Due {due_label}.",
            severity="critical",
            entity_type="use_case",
            entity_id=use_case.use_case_id,
            domain_id=use_case.domain_id,
            link=use_case_edit_link(
                domain_id=use_case.domain_id,
                use_case_id=use_case.use_case_id,
                section=section,
            ),
            actions=["open", "reject_analysis"],
            payload={
                "track": track.lower(),
                "due_date": due_date.isoformat() if due_date else None,
                "use_case_title": title,
            },
            commit=True,
        )
        if not _is_usable_email(owner.user_email):
            continue
        subject = f"[AI Workbench] {track} Analysis assigned: {title}"
        body_text = f"""Hello {_display_name(owner)},

You have been assigned as the {track} Owner for Analysis on the following use case.

Use case: {title}
Assigned by: {assigner_name}
Due date: {due_label}
Assigned on: {_format_dt()}

Please complete your {track.lower()} analysis in AI Governance Workbench.

Regards,
AI Governance Workbench Notifications
"""
        queue_email(
            to_email=owner.user_email,
            subject=subject,
            body_text=body_text,
            background_tasks=background_tasks,
            flow_name="analysis_assignment",
            context={
                "use_case_id": use_case.use_case_id,
                "track": track,
                "assignee_user_id": owner.user_id,
            },
        )


@_never_raise
def notify_analysis_rejection(
    db: Session,
    use_case: UseCase,
    *,
    track: str,
    rejector: User | None,
    assigner: User | None,
    note: str,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Notify assigner + domain owner that a track assignment was rejected."""
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    notify_assigner_and_domain_owner(
        db,
        use_case,
        assigner_user_id=getattr(assigner, "user_id", None),
        actor_user_id=getattr(rejector, "user_id", None),
        type="analysis_rejected",
        title=f"{track} Analysis assignment rejected",
        message=f"“{title}” needs reassignment. Note: {note[:180]}",
        severity="critical",
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="basic",
            action="assign-analysis",
        ),
        actions=["open", "reassign"],
        payload={"track": track.lower(), "note": note, "use_case_title": title},
        commit=True,
    )
    if not assigner or not _is_usable_email(assigner.user_email):
        logger.warning("Analysis rejection email skipped: assigner email missing")
        return
    subject = f"[AI Workbench] {track} Analysis assignment rejected: {title}"
    body_text = f"""Hello {_display_name(assigner)},

The {track} Analysis assignment for the following use case was rejected and needs reassignment.

Use case: {title}
Rejected by: {_display_name(rejector)}
Rejected on: {_format_dt()}
Note: {note}

Please reassign the {track.lower()} owner in AI Governance Workbench.

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=assigner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="analysis_rejection",
        context={
            "use_case_id": use_case.use_case_id,
            "track": track,
            "rejector_user_id": getattr(rejector, "user_id", None),
        },
    )


@_never_raise
def notify_analysis_completed(
    db: Session,
    use_case: UseCase,
    *,
    track: str,
    completer: User | None,
    assigner: User | None,
    background_tasks: BackgroundTasks | None = None,
    advanced_to_review: bool = False,
) -> None:
    """Notify governors that a track was completed; escalate when both tracks enter Review."""
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    section = "tech_analysis" if track.lower().startswith("tech") else "business_analysis"
    if advanced_to_review:
        notify_assigner_and_domain_owner(
            db,
            use_case,
            assigner_user_id=getattr(assigner, "user_id", None),
            actor_user_id=getattr(completer, "user_id", None),
            type="ready_for_estimate",
            title="Ready for Estimate assignment",
            message=(
                f"{_display_name(completer)} completed {track} Analysis on “{title}”. "
                "Both tracks are done — assign an Estimate owner."
            ),
            severity="critical",
            link=use_case_edit_link(
                domain_id=use_case.domain_id,
                use_case_id=use_case.use_case_id,
                section="estimate",
                action="assign-estimate",
            ),
            actions=["open", "reassign"],
            payload={"track": track.lower(), "use_case_title": title},
            commit=True,
        )
    else:
        notify_assigner_and_domain_owner(
            db,
            use_case,
            assigner_user_id=getattr(assigner, "user_id", None),
            actor_user_id=getattr(completer, "user_id", None),
            type="analysis_completed",
            title=f"{track} Analysis completed",
            message=f"{_display_name(completer)} completed {track} Analysis on “{title}”.",
            severity="info",
            link=use_case_edit_link(
                domain_id=use_case.domain_id,
                use_case_id=use_case.use_case_id,
                section=section,
            ),
            actions=["open"],
            payload={"track": track.lower(), "use_case_title": title},
            commit=True,
        )
    if not assigner or not _is_usable_email(assigner.user_email):
        return
    if advanced_to_review:
        subject = f"[AI Workbench] Ready for Estimate assignment: {title}"
        body_text = f"""Hello {_display_name(assigner)},

Both Technical and Business Analysis are complete for:

Use case: {title}
Last completed by: {_display_name(completer)} ({track})
Completed on: {_format_dt()}

Please assign an Estimate owner in AI Governance Workbench.

Regards,
AI Governance Workbench Notifications
"""
        flow_name = "ready_for_estimate"
    else:
        subject = f"[AI Workbench] {track} Analysis completed: {title}"
        body_text = f"""Hello {_display_name(assigner)},

{track} Analysis has been marked complete for:

Use case: {title}
Completed by: {_display_name(completer)}
Completed on: {_format_dt()}

Regards,
AI Governance Workbench Notifications
"""
        flow_name = "analysis_completed"
    queue_email(
        to_email=assigner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name=flow_name,
        context={
            "use_case_id": use_case.use_case_id,
            "track": track,
            "completer_user_id": getattr(completer, "user_id", None),
        },
    )


@_never_raise
def notify_analysis_send_back(
    db: Session,
    use_case: UseCase,
    *,
    track: str,
    reviewer: User | None,
    owner: User | None,
    note: str,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Notify track owner that Review sent the analysis back for more information."""
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    section = "tech_analysis" if track.lower().startswith("tech") else "business_analysis"
    if owner:
        create_notification(
            db,
            recipient_user_id=owner.user_id,
            actor_user_id=getattr(reviewer, "user_id", None),
            type="analysis_send_back",
            title=f"{track} Analysis sent back",
            message=f"Review sent “{title}” back for more information. Note: {note[:160]}",
            severity="critical",
            entity_type="use_case",
            entity_id=use_case.use_case_id,
            domain_id=use_case.domain_id,
            link=use_case_edit_link(
                domain_id=use_case.domain_id,
                use_case_id=use_case.use_case_id,
                section=section,
            ),
            actions=["open"],
            payload={"track": track.lower(), "note": note, "use_case_title": title},
            commit=True,
        )
    if not owner or not _is_usable_email(owner.user_email):
        logger.warning("Analysis send-back email skipped: owner email missing")
        return
    subject = f"[AI Workbench] {track} Analysis sent back for more information: {title}"
    body_text = f"""Hello {_display_name(owner)},

Your {track} Analysis for the following use case was sent back from Review for more information.

Use case: {title}
Sent back by: {_display_name(reviewer)}
Sent back on: {_format_dt()}
Note: {note}

Please update your analysis in AI Governance Workbench and mark it completed again.

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=owner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="analysis_send_back",
        context={
            "use_case_id": use_case.use_case_id,
            "track": track,
            "owner_user_id": owner.user_id,
        },
    )


@_never_raise
def notify_estimate_assignment(
    db: Session,
    use_case: UseCase,
    *,
    estimate_owner: User | None,
    assigner: User | None,
    due_date: datetime | None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Email the estimate owner about Estimate assignment."""
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    due_label = _format_dt(due_date) if due_date else "Not specified"
    if estimate_owner:
        create_notification(
            db,
            recipient_user_id=estimate_owner.user_id,
            actor_user_id=getattr(assigner, "user_id", None),
            type="estimate_assigned",
            title="Estimate assigned",
            message=f"You were assigned to complete the Estimate for “{title}”. Due {due_label}.",
            severity="critical",
            entity_type="use_case",
            entity_id=use_case.use_case_id,
            domain_id=use_case.domain_id,
            link=use_case_edit_link(
                domain_id=use_case.domain_id,
                use_case_id=use_case.use_case_id,
                section="estimate",
            ),
            actions=["open"],
            payload={
                "due_date": due_date.isoformat() if due_date else None,
                "use_case_title": title,
            },
            commit=True,
        )
    if not estimate_owner or not _is_usable_email(estimate_owner.user_email):
        logger.warning("Estimate assignment email skipped: owner email missing")
        return
    subject = f"[AI Workbench] Estimate assigned: {title}"
    body_text = f"""Hello {_display_name(estimate_owner)},

You have been assigned to complete the cost Estimate for the following use case.

Use case: {title}
Assigned by: {_display_name(assigner)}
Due date: {due_label}
Assigned on: {_format_dt()}

Please complete the estimate (infra, build, validation, support, LLM token, change management) in AI Governance Workbench.

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=estimate_owner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="estimate_assignment",
        context={
            "use_case_id": use_case.use_case_id,
            "assignee_user_id": estimate_owner.user_id,
        },
    )


@_never_raise
def notify_estimate_completed(
    db: Session,
    use_case: UseCase,
    *,
    completer: User | None,
    assigner: User | None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Notify assigner + domain owner that Estimate was completed and moved to ROI."""
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    notify_assigner_and_domain_owner(
        db,
        use_case,
        assigner_user_id=getattr(assigner, "user_id", None),
        actor_user_id=getattr(completer, "user_id", None),
        type="estimate_completed",
        title="Ready for ROI assignment",
        message=f"{_display_name(completer)} completed Estimate on “{title}”. Moved to ROI — assign an ROI owner.",
        severity="critical",
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="roi",
            action="assign-roi",
        ),
        actions=["open", "reassign"],
        payload={"use_case_title": title},
        commit=True,
    )
    if not assigner or not _is_usable_email(assigner.user_email):
        return
    subject = f"[AI Workbench] Estimate completed — moved to ROI: {title}"
    body_text = f"""Hello {_display_name(assigner)},

The Estimate for the following use case has been completed and the use case moved to ROI.

Use case: {title}
Completed by: {_display_name(completer)}
Completed on: {_format_dt()}

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=assigner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="estimate_completed",
        context={
            "use_case_id": use_case.use_case_id,
            "completer_user_id": getattr(completer, "user_id", None),
        },
    )


@_never_raise
def notify_roi_assignment(
    db: Session,
    use_case: UseCase,
    *,
    roi_owner: User | None,
    assigner: User | None,
    due_date: datetime | None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    due_label = _format_dt(due_date) if due_date else "Not specified"
    if roi_owner:
        create_notification(
            db,
            recipient_user_id=roi_owner.user_id,
            actor_user_id=getattr(assigner, "user_id", None),
            type="roi_assigned",
            title="ROI assigned",
            message=f"You were assigned to complete the ROI worksheet for “{title}”. Due {due_label}.",
            severity="critical",
            entity_type="use_case",
            entity_id=use_case.use_case_id,
            domain_id=use_case.domain_id,
            link=use_case_edit_link(
                domain_id=use_case.domain_id,
                use_case_id=use_case.use_case_id,
                section="roi",
            ),
            actions=["open"],
            payload={
                "due_date": due_date.isoformat() if due_date else None,
                "use_case_title": title,
            },
            commit=True,
        )
    if not roi_owner or not _is_usable_email(roi_owner.user_email):
        logger.warning("ROI assignment email skipped: owner email missing")
        return
    subject = f"[AI Workbench] ROI assigned: {title}"
    body_text = f"""Hello {_display_name(roi_owner)},

You have been assigned to complete the ROI worksheet for the following use case.

Use case: {title}
Assigned by: {_display_name(assigner)}
Due date: {due_label}
Assigned on: {_format_dt()}

Please capture savings categories and Year 1–3 benefits in AI Governance Workbench.

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=roi_owner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="roi_assignment",
        context={"use_case_id": use_case.use_case_id, "assignee_user_id": roi_owner.user_id},
    )


@_never_raise
def notify_roi_previous_owner(
    db: Session,
    use_case: UseCase,
    *,
    previous_owner: User | None,
    new_owner: User | None,
    assigner: User | None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    if not previous_owner:
        return
    if new_owner and previous_owner.user_id == new_owner.user_id:
        return
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    create_notification(
        db,
        recipient_user_id=previous_owner.user_id,
        actor_user_id=getattr(assigner, "user_id", None),
        type="roi_reassigned",
        title="ROI reassigned",
        message=f"ROI for “{title}” was reassigned to {_display_name(new_owner)}. You are no longer the owner.",
        severity="warning",
        entity_type="use_case",
        entity_id=use_case.use_case_id,
        domain_id=use_case.domain_id,
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="roi",
        ),
        actions=["open"],
        payload={"use_case_title": title, "new_owner": _display_name(new_owner)},
        commit=True,
    )
    if not _is_usable_email(previous_owner.user_email):
        return
    subject = f"[AI Workbench] ROI reassigned: {title}"
    body_text = f"""Hello {_display_name(previous_owner)},

The ROI worksheet for the following use case has been reassigned.

Use case: {title}
New owner: {_display_name(new_owner)}
Reassigned by: {_display_name(assigner)}

You are no longer the ROI owner for this use case.

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=previous_owner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="roi_reassignment",
        context={"use_case_id": use_case.use_case_id, "previous_owner_id": previous_owner.user_id},
    )


@_never_raise
def notify_roi_completed(
    db: Session,
    use_case: UseCase,
    *,
    completer: User | None,
    assigner: User | None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    notify_assigner_and_domain_owner(
        db,
        use_case,
        assigner_user_id=getattr(assigner, "user_id", None),
        actor_user_id=getattr(completer, "user_id", None),
        type="roi_completed",
        title="Ready for AI Assessment assignment",
        message=f"{_display_name(completer)} completed ROI on “{title}”. Moved to AI Assessment — assign a governance owner.",
        severity="critical",
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="assessment",
            action="assign-assessment",
        ),
        actions=["open", "reassign"],
        payload={"use_case_title": title},
        commit=True,
    )
    if not assigner or not _is_usable_email(assigner.user_email):
        return
    subject = f"[AI Workbench] ROI completed — moved to AI Assessment: {title}"
    body_text = f"""Hello {_display_name(assigner)},

The ROI worksheet for the following use case has been completed and the use case moved to AI Assessment.

Use case: {title}
Completed by: {_display_name(completer)}
Completed on: {_format_dt()}

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=assigner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="roi_completed",
        context={
            "use_case_id": use_case.use_case_id,
            "completer_user_id": getattr(completer, "user_id", None),
        },
    )


@_never_raise
def notify_assessment_assignment(
    db: Session,
    use_case: UseCase,
    *,
    assessment_owner: User | None,
    assigner: User | None,
    due_date: datetime | None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    due_label = _format_dt(due_date) if due_date else "Not specified"
    if assessment_owner:
        create_notification(
            db,
            recipient_user_id=assessment_owner.user_id,
            actor_user_id=getattr(assigner, "user_id", None),
            type="assessment_assigned",
            title="AI Assessment assigned",
            message=f"You were assigned as governance owner for AI Assessment on “{title}”. Due {due_label}.",
            severity="critical",
            entity_type="use_case",
            entity_id=use_case.use_case_id,
            domain_id=use_case.domain_id,
            link=use_case_edit_link(
                domain_id=use_case.domain_id,
                use_case_id=use_case.use_case_id,
                section="assessment",
            ),
            actions=["open"],
            payload={
                "due_date": due_date.isoformat() if due_date else None,
                "use_case_title": title,
            },
            commit=True,
        )
    if not assessment_owner or not _is_usable_email(assessment_owner.user_email):
        logger.warning("AI Assessment assignment email skipped: owner email missing")
        return
    subject = f"[AI Workbench] AI Assessment assigned: {title}"
    body_text = f"""Hello {_display_name(assessment_owner)},

You have been assigned as the governance owner for AI Assessment on the following use case.

Use case: {title}
Assigned by: {_display_name(assigner)}
Due date: {due_label}
Assigned on: {_format_dt()}

Please complete the Responsible AI assessment checklist in AI Governance Workbench.

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=assessment_owner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="assessment_assignment",
        context={"use_case_id": use_case.use_case_id, "assignee_user_id": assessment_owner.user_id},
    )


@_never_raise
def notify_assessment_completed(
    db: Session,
    use_case: UseCase,
    *,
    completer: User | None,
    assigner: User | None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    notify_assigner_and_domain_owner(
        db,
        use_case,
        assigner_user_id=getattr(assigner, "user_id", None),
        actor_user_id=getattr(completer, "user_id", None),
        type="assessment_completed",
        title="Ready to Approve or Reject",
        message=f"{_display_name(completer)} completed AI Assessment on “{title}”. Final decision is needed.",
        severity="critical",
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="assessment",
        ),
        actions=["open"],
        payload={"use_case_title": title},
        commit=True,
    )
    if not assigner or not _is_usable_email(assigner.user_email):
        return
    subject = f"[AI Workbench] Ready to Approve or Reject: {title}"
    body_text = f"""Hello {_display_name(assigner)},

The AI Assessment for the following use case has been completed and is ready for final Approve/Reject.

Use case: {title}
Completed by: {_display_name(completer)}
Completed on: {_format_dt()}

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=assigner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="assessment_completed",
        context={
            "use_case_id": use_case.use_case_id,
            "completer_user_id": getattr(completer, "user_id", None),
        },
    )


@_never_raise
def notify_stage_previous_owner(
    db: Session,
    use_case: UseCase,
    *,
    previous_owner: User | None,
    new_owner: User | None,
    assigner: User | None,
    stage_label: str,
    notification_type: str,
    section: str,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Tell a previous stage owner they were replaced."""
    if not previous_owner:
        return
    if new_owner and previous_owner.user_id == new_owner.user_id:
        return
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    create_notification(
        db,
        recipient_user_id=previous_owner.user_id,
        actor_user_id=getattr(assigner, "user_id", None),
        type=notification_type,
        title=f"{stage_label} reassigned",
        message=f"{stage_label} for “{title}” was reassigned to {_display_name(new_owner)}. You are no longer the owner.",
        severity="warning",
        entity_type="use_case",
        entity_id=use_case.use_case_id,
        domain_id=use_case.domain_id,
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section=section,
        ),
        actions=["open"],
        payload={"use_case_title": title, "new_owner": _display_name(new_owner), "stage": stage_label},
        commit=True,
    )
    if not _is_usable_email(previous_owner.user_email):
        return
    subject = f"[AI Workbench] {stage_label} reassigned: {title}"
    body_text = f"""Hello {_display_name(previous_owner)},

The {stage_label} assignment for the following use case has been reassigned.

Use case: {title}
New owner: {_display_name(new_owner)}
Reassigned by: {_display_name(assigner)}

You are no longer the {stage_label} owner for this use case.

Regards,
AI Governance Workbench Notifications
"""
    queue_email(
        to_email=previous_owner.user_email,
        subject=subject,
        body_text=body_text,
        background_tasks=background_tasks,
        flow_name="stage_reassignment",
        context={"use_case_id": use_case.use_case_id, "previous_owner_id": previous_owner.user_id},
    )


@_never_raise
def notify_use_case_decision(
    db: Session,
    use_case: UseCase,
    *,
    actor: User | None,
    new_status: str,
    from_status: str | None = None,
    rejection_reason: str | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    dismiss_stale_use_case_action_notifications(db, getattr(use_case, "use_case_id", None))
    approved = new_status == "Approved"
    reason = (rejection_reason or "").strip()
    if approved:
        message = f"{_display_name(actor)} approved “{title}”."
    else:
        message = f"{_display_name(actor)} rejected “{title}”."
        if reason:
            message = f"{message} Reason: {reason[:160]}"
    create_notifications_for_users(
        db,
        recipient_user_ids=use_case_stakeholder_ids(db, use_case),
        actor_user_id=getattr(actor, "user_id", None),
        type="use_case_approved" if approved else "use_case_rejected",
        title=f"Use case {new_status.lower()}",
        message=message,
        severity="info" if approved else "warning",
        entity_type="use_case",
        entity_id=use_case.use_case_id,
        domain_id=use_case.domain_id,
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="basic",
        ),
        actions=["open"],
        payload={
            "use_case_title": title,
            "from_status": from_status,
            "to_status": new_status,
            "rejection_reason": reason or None,
        },
        commit=True,
    )
    recipients = get_governor_emails(db, use_case.domain_id)
    creator = db.query(User).filter(User.user_id == use_case.created_by).first() if use_case.created_by else None
    extra_emails = []
    if creator and _is_usable_email(creator.user_email):
        extra_emails.append(creator.user_email.strip().lower())
    seen = {e.lower() for e in recipients}
    for email in extra_emails:
        if email not in seen:
            recipients.append(email)
            seen.add(email)
    if not recipients:
        return
    subject = f"[AI Workbench] Use case {new_status}: {title}"
    body_text = f"""Hello,

The following use case was {new_status.lower()}.

Use case: {title}
Decided by: {_display_name(actor)}
Previous status: {from_status or "Unknown"}
{f"Reason: {reason}" if reason and not approved else ""}

Regards,
AI Governance Workbench Notifications
"""
    _send_many(
        recipients,
        subject,
        body_text,
        background_tasks=background_tasks,
        flow_name="use_case_decision",
        context={"use_case_id": use_case.use_case_id, "status": new_status},
    )


@_never_raise
def notify_comment_added(
    db: Session,
    use_case: UseCase,
    *,
    actor: User | None,
    comment_preview: str | None,
) -> None:
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    preview = (comment_preview or "").strip().replace("\n", " ")
    if len(preview) > 140:
        preview = preview[:137] + "..."
    create_notifications_for_users(
        db,
        recipient_user_ids=use_case_stakeholder_ids(db, use_case),
        actor_user_id=getattr(actor, "user_id", None),
        type="comment_added",
        title="New comment on use case",
        message=f"{_display_name(actor)} commented on “{title}”" + (f": {preview}" if preview else "."),
        severity="info",
        entity_type="use_case",
        entity_id=use_case.use_case_id,
        domain_id=use_case.domain_id,
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="comments",
        ),
        actions=["open"],
        payload={"use_case_title": title},
        commit=True,
    )


@_never_raise
def notify_risk_assigned(
    db: Session,
    use_case: UseCase,
    *,
    assignee: User | None,
    actor: User | None,
    risk_title: str | None,
) -> None:
    if not assignee:
        return
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    risk_label = (risk_title or "a risk").strip() or "a risk"
    create_notification(
        db,
        recipient_user_id=assignee.user_id,
        actor_user_id=getattr(actor, "user_id", None),
        type="risk_assigned",
        title="Risk assigned to you",
        message=f"You were assigned “{risk_label}” on “{title}”.",
        severity="critical",
        entity_type="use_case",
        entity_id=use_case.use_case_id,
        domain_id=use_case.domain_id,
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="risks",
        ),
        actions=["open"],
        payload={"use_case_title": title, "risk_title": risk_label},
        commit=True,
    )


@_never_raise
def notify_use_case_moved(
    db: Session,
    use_case: UseCase,
    *,
    actor: User | None,
    source_domain: Domain | None,
    target_domain: Domain | None,
) -> None:
    title = getattr(use_case, "use_case_title", None) or use_case.use_case_name
    source_name = getattr(source_domain, "domain_name", None) or "previous domain"
    target_name = getattr(target_domain, "domain_name", None) or "new domain"
    recipients = stakeholder_ids_for_move(db, use_case, source_domain, target_domain)
    create_notifications_for_users(
        db,
        recipient_user_ids=recipients,
        actor_user_id=getattr(actor, "user_id", None),
        type="use_case_moved",
        title="Use case moved to another domain",
        message=f"“{title}” was moved from {source_name} to {target_name} by {_display_name(actor)}.",
        severity="warning",
        entity_type="use_case",
        entity_id=use_case.use_case_id,
        domain_id=getattr(target_domain, "domain_id", None) or use_case.domain_id,
        link=use_case_edit_link(
            domain_id=use_case.domain_id,
            use_case_id=use_case.use_case_id,
            section="basic",
        ),
        actions=["open"],
        payload={"use_case_title": title, "from_domain": source_name, "to_domain": target_name},
        commit=True,
    )


def stakeholder_ids_for_move(
    db: Session,
    use_case: UseCase,
    source_domain: Domain | None,
    target_domain: Domain | None,
) -> list[str]:
    return stakeholder_recipient_ids(
        *use_case_stakeholder_ids(db, use_case),
        getattr(source_domain, "owner_id", None),
        getattr(target_domain, "owner_id", None),
        *governor_user_ids(db, getattr(source_domain, "domain_id", None)),
        *governor_user_ids(db, getattr(target_domain, "domain_id", None)),
    )


@_never_raise
def notify_use_case_deleted(
    db: Session,
    *,
    actor: User | None,
    use_case_id: str,
    use_case_title: str,
    domain_id: str | None,
    recipient_user_ids: list[str],
) -> None:
    create_notifications_for_users(
        db,
        recipient_user_ids=recipient_user_ids,
        actor_user_id=getattr(actor, "user_id", None),
        type="use_case_deleted",
        title="Use case deleted",
        message=f"“{use_case_title}” was deleted by {_display_name(actor)}.",
        severity="warning",
        entity_type="use_case",
        entity_id=use_case_id,
        domain_id=domain_id,
        link=f"#/d/{domain_id}" if domain_id else "#/use-cases",
        actions=["open"],
        payload={"use_case_title": use_case_title},
        commit=True,
    )


@_never_raise
def notify_domain_owner_changed(
    db: Session,
    domain: Domain,
    *,
    actor: User | None,
    new_owner: User | None,
    previous_owner: User | None,
) -> None:
    domain_name = getattr(domain, "domain_name", "") or "a domain"
    if new_owner:
        create_notification(
            db,
            recipient_user_id=new_owner.user_id,
            actor_user_id=getattr(actor, "user_id", None),
            type="domain_owner_changed",
            title="You are now domain owner",
            message=f"{_display_name(actor)} assigned you as owner of “{domain_name}”.",
            severity="critical",
            entity_type="domain",
            entity_id=domain.domain_id,
            domain_id=domain.domain_id,
            link="#/domains",
            actions=["open"],
            payload={"domain_name": domain_name},
            commit=True,
        )
    if previous_owner and (not new_owner or previous_owner.user_id != new_owner.user_id):
        create_notification(
            db,
            recipient_user_id=previous_owner.user_id,
            actor_user_id=getattr(actor, "user_id", None),
            type="domain_owner_changed",
            title="Domain ownership reassigned",
            message=f"Ownership of “{domain_name}” was reassigned to {_display_name(new_owner)}.",
            severity="warning",
            entity_type="domain",
            entity_id=domain.domain_id,
            domain_id=domain.domain_id,
            link="#/domains",
            actions=["open"],
            payload={"domain_name": domain_name, "new_owner": _display_name(new_owner)},
            commit=True,
        )


@_never_raise
def notify_domain_access_granted(
    db: Session,
    domain: Domain,
    *,
    actor: User | None,
    target_user: User | None,
) -> None:
    if not target_user:
        return
    domain_name = getattr(domain, "domain_name", "") or "a domain"
    create_notification(
        db,
        recipient_user_id=target_user.user_id,
        actor_user_id=getattr(actor, "user_id", None),
        type="domain_access_granted",
        title="Added to a domain",
        message=f"{_display_name(actor)} added you to “{domain_name}”.",
        severity="critical",
        entity_type="domain",
        entity_id=domain.domain_id,
        domain_id=domain.domain_id,
        link="#/domains",
        actions=["open"],
        payload={"domain_name": domain_name},
        commit=True,
    )


@_never_raise
def notify_domain_access_removed(
    db: Session,
    domain: Domain,
    *,
    actor: User | None,
    target_user: User | None,
) -> None:
    if not target_user:
        return
    domain_name = getattr(domain, "domain_name", "") or "a domain"
    create_notification(
        db,
        recipient_user_id=target_user.user_id,
        actor_user_id=getattr(actor, "user_id", None),
        type="domain_access_removed",
        title="Removed from a domain",
        message=f"{_display_name(actor)} removed your access to “{domain_name}”.",
        severity="warning",
        entity_type="domain",
        entity_id=domain.domain_id,
        domain_id=domain.domain_id,
        link="#/domains",
        actions=["open"],
        payload={"domain_name": domain_name},
        commit=True,
    )

