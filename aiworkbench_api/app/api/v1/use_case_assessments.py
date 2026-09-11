"""Use case assessment checklist instance endpoints."""


from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.authorization import check_permission, get_user_with_permissions
from app.core.database import get_db
from app.middleware.auth_middleware import get_current_user_id
from app.models import Domain, DomainAccess, UseCase, User
from app.services.use_case_assessment_ai_service import use_case_assessment_ai_service
from app.services.use_case_assessment_service import (
    cancel_assessment,
    close_assessment,
    get_use_case_assessment,
    initiate_assessment,
    reset_closed_assessment,
    save_response,
    serialize_assessment,
)

router = APIRouter()


def _require_use_case_access(db: Session, user_id: str, use_case: UseCase) -> None:
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    if not check_permission(db, user, "case_view", allow_admin=True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    if is_user_admin:
        return
    domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    if domain.owner_id == user_id:
        return
    access = (
        db.query(DomainAccess)
        .filter(DomainAccess.domain_id == use_case.domain_id, DomainAccess.user_id == user_id)
        .first()
    )
    if not access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this use case")


def _has_initiate_assessment_permission(db: Session, user: User) -> bool:
    return check_permission(db, user, "initiate_assessment", allow_admin=True) or check_permission(
        db, user, "case_assess", allow_admin=True
    )


def _has_contribute_assessment_permission(db: Session, user: User) -> bool:
    return check_permission(db, user, "contribute_assessment", allow_admin=True)


def _require_initiate_assessment_permission(db: Session, user_id: str) -> None:
    user, _, _ = get_user_with_permissions(db, user_id)
    if not _has_initiate_assessment_permission(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to initiate or manage use case assessments",
        )


def _require_assessment_update_permission(
    db: Session,
    user_id: str,
    *,
    assessment_status: str | None,
) -> None:
    user, _, _ = get_user_with_permissions(db, user_id)
    if _has_initiate_assessment_permission(db, user):
        return
    if (
        assessment_status == "IN_PROGRESS"
        and _has_contribute_assessment_permission(db, user)
    ):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to update this assessment",
    )


def _load_use_case(db: Session, use_case_id: str) -> UseCase:
    use_case = db.query(UseCase).filter(UseCase.use_case_id == use_case_id).first()
    if not use_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    return use_case


def _require_open_ai_assessment_stage(use_case: UseCase) -> None:
    if use_case.status != "AI Assessment":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Responsible AI assessment can only be changed in AI Assessment status.",
        )
    if not use_case.assessment_owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assign an AI Assessment owner before starting the assessment checklist.",
        )
    if use_case.assessment_completed_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI Assessment assignment is already completed and is read-only.",
        )


class AssessmentInitRequest(BaseModel):
    force_new: bool = False


class AssessmentResponseInput(BaseModel):
    template_item_id: int
    area_id: int
    sno: str
    selected_labels: list[str] = Field(default_factory=list)
    comment: str | None = None


class AssessmentCloseRequest(BaseModel):
    overall_findings: str | None = None
    confirm: bool = False


@router.get("/{use_case_id}/assessment")
async def get_assessment(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db),
    include_history: bool = False,
    include_participants: bool = False,
):
    user_id = get_current_user_id(request)
    use_case = _load_use_case(db, use_case_id)
    _require_use_case_access(db, user_id, use_case)

    assessment = get_use_case_assessment(
        db,
        use_case_id,
        load_history=include_history,
    )
    if not assessment:
        return {"assessment": None}
    return {
        "assessment": serialize_assessment(
            db,
            assessment,
            use_case,
            include_history=include_history,
            include_participants=include_participants,
        )
    }


@router.post("/{use_case_id}/assessment", status_code=status.HTTP_201_CREATED)
async def create_or_get_assessment(
    use_case_id: str,
    payload: AssessmentInitRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    use_case = _load_use_case(db, use_case_id)
    _require_use_case_access(db, user_id, use_case)
    _require_initiate_assessment_permission(db, user_id)
    _require_open_ai_assessment_stage(use_case)

    try:
        existing = get_use_case_assessment(db, use_case_id)
        if existing and existing.status == "CLOSED" and payload.force_new:
            assessment = reset_closed_assessment(db, existing, user_id)
        else:
            assessment = initiate_assessment(db, use_case, user_id, force_new=payload.force_new)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    from app.models import AuditLog

    db.add(
        AuditLog(
            type="use_case",
            action="assessment_checklist_initiate",
            user_id=user_id,
            details={"use_case_id": use_case_id, "assessment_id": assessment.assessment_id},
        )
    )
    db.commit()
    db.refresh(assessment)
    return {"assessment": serialize_assessment(db, assessment, use_case)}


@router.delete("/{use_case_id}/assessment")
async def delete_assessment(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    use_case = _load_use_case(db, use_case_id)
    _require_use_case_access(db, user_id, use_case)
    _require_initiate_assessment_permission(db, user_id)
    _require_open_ai_assessment_stage(use_case)

    assessment = get_use_case_assessment(db, use_case_id)
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")

    try:
        cancel_assessment(db, assessment)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    db.commit()
    return {"message": "Assessment cancelled", "assessment": None}


@router.put("/{use_case_id}/assessment/responses/{template_item_id}")
async def upsert_assessment_response(
    use_case_id: str,
    template_item_id: int,
    payload: AssessmentResponseInput,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    use_case = _load_use_case(db, use_case_id)
    _require_use_case_access(db, user_id, use_case)
    _require_open_ai_assessment_stage(use_case)
    assessment = get_use_case_assessment(db, use_case_id)
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")

    _require_assessment_update_permission(
        db,
        user_id,
        assessment_status=assessment.status,
    )

    try:
        save_response(
            db,
            assessment,
            template_item_id=template_item_id,
            area_id=payload.area_id,
            sno=payload.sno,
            selected_labels=payload.selected_labels,
            comment=payload.comment,
            user_id=user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    db.commit()
    db.refresh(assessment)
    return {"assessment": serialize_assessment(db, assessment, use_case)}


@router.post("/{use_case_id}/assessment/close")
async def close_use_case_assessment(
    use_case_id: str,
    payload: AssessmentCloseRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    use_case = _load_use_case(db, use_case_id)
    _require_use_case_access(db, user_id, use_case)
    _require_initiate_assessment_permission(db, user_id)
    _require_open_ai_assessment_stage(use_case)

    if not payload.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set confirm=true to close the assessment and compute scores",
        )

    assessment = get_use_case_assessment(db, use_case_id)
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")

    try:
        close_assessment(db, assessment, user_id, overall_findings=payload.overall_findings)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    from app.models import AuditLog

    db.add(
        AuditLog(
            type="use_case",
            action="assessment_checklist_close",
            user_id=user_id,
            details={
                "use_case_id": use_case_id,
                "assessment_id": assessment.assessment_id,
                "total_score": assessment.total_score,
                "risk_classification": assessment.risk_classification,
            },
        )
    )
    db.commit()
    db.refresh(assessment)
    return {"assessment": serialize_assessment(db, assessment, use_case)}


@router.post("/{use_case_id}/assessment/ai-prefill")
async def ai_prefill_assessment(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    use_case = _load_use_case(db, use_case_id)
    _require_use_case_access(db, user_id, use_case)
    _require_open_ai_assessment_stage(use_case)
    assessment = get_use_case_assessment(db, use_case_id)
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found. Initiate first.")

    _require_assessment_update_permission(
        db,
        user_id,
        assessment_status=assessment.status,
    )

    try:
        result = use_case_assessment_ai_service.prefill_assessment(db, use_case, assessment, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    db.commit()
    db.refresh(assessment)
    return {
        "assessment": serialize_assessment(db, assessment, use_case),
        "prefill": result,
    }


@router.get("/{use_case_id}/assessment/history")
async def get_assessment_history(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    use_case = _load_use_case(db, use_case_id)
    _require_use_case_access(db, user_id, use_case)

    assessment = get_use_case_assessment(db, use_case_id, load_history=True)
    if not assessment:
        return {"history": [], "participants": []}
    serialized = serialize_assessment(
        db,
        assessment,
        use_case,
        include_history=True,
        include_participants=True,
    )
    return {
        "history": serialized.get("history") or [],
        "participants": serialized.get("participants") or [],
    }
