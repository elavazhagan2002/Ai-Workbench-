"""
AI assistance endpoints for use case field enhancement suggestions.
"""
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.v1.use_cases import _can_access_documentation_quality, _require_use_case_access
from app.core.ai_user_messages import AI_SERVICES_UNAVAILABLE_MESSAGE, user_facing_ai_error_detail
from app.core.authorization import check_permission, get_user_with_permissions, require_permission
from app.core.database import get_db
from app.core.logging_config import logger
from app.middleware.auth_middleware import get_current_user_id
from app.schemas.ai_assist import (
    DraftUseCaseQualityRequest,
    DraftUseCaseQualityResponse,
    EnhanceUseCaseFieldRequest,
    EnhanceUseCaseFieldResponse,
    UseCaseDocumentationQualityResponse,
)
from app.services.ai_field_enhancement_service import (
    AIFieldEnhancementServiceError,
    ai_field_enhancement_service,
)
from app.services.usecase_documentation_quality_service import (
    UseCaseDocumentationQualityServiceError,
    usecase_documentation_quality_service,
)

router = APIRouter()


@router.post("/enhance-usecase-field", response_model=EnhanceUseCaseFieldResponse)
def enhance_usecase_field(
    payload: EnhanceUseCaseFieldRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Return an AI-enhanced suggestion for supported use case text fields."""
    started_at = perf_counter()
    provider_debug = ai_field_enhancement_service.get_provider_debug_info()
    selected_provider = provider_debug["provider"]
    selected_model = provider_debug["model"] or "unconfigured"
    selected_base_url = provider_debug["base_url"] or "missing"
    key_fingerprint = provider_debug["api_key_fingerprint"]
    text_length = len(payload.text)
    requested_max_length = payload.max_length or "default"

    logger.info(
        "event=ai_enhance_usecase_field_start field_name=%s provider=%s model=%s base_url=%s "
        "api_key_fingerprint=%s text_length=%s requested_max_length=%s",
        payload.field_name,
        selected_provider,
        selected_model,
        selected_base_url,
        key_fingerprint,
        text_length,
        requested_max_length,
    )

    try:
        user_id = get_current_user_id(request)
        user, _, _ = get_user_with_permissions(db, user_id)
        if not (
            check_permission(db, user, "case_edit", allow_admin=True)
            or check_permission(db, user, "case_create", allow_admin=True)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to enhance use case fields.",
            )
        response = ai_field_enhancement_service.enhance_usecase_field(payload)
    except AIFieldEnhancementServiceError as exc:
        latency_ms = int((perf_counter() - started_at) * 1000)
        logger.warning(
            "event=ai_enhance_usecase_field_end status=failure field_name=%s provider=%s model=%s "
            "base_url=%s api_key_fingerprint=%s latency_ms=%s detail=%s",
            payload.field_name,
            selected_provider,
            selected_model,
            selected_base_url,
            key_fingerprint,
            latency_ms,
            exc.detail,
        )
        raise HTTPException(
            status_code=exc.status_code,
            detail=user_facing_ai_error_detail(detail=exc.detail, status_code=exc.status_code),
        ) from exc
    except HTTPException as exc:
        latency_ms = int((perf_counter() - started_at) * 1000)
        logger.warning(
            "event=ai_enhance_usecase_field_end status=failure field_name=%s provider=%s model=%s "
            "base_url=%s api_key_fingerprint=%s latency_ms=%s detail=%s",
            payload.field_name,
            selected_provider,
            selected_model,
            selected_base_url,
            key_fingerprint,
            latency_ms,
            str(exc.detail),
        )
        raise
    except Exception as exc:
        latency_ms = int((perf_counter() - started_at) * 1000)
        logger.error(
            "event=ai_enhance_usecase_field_end status=failure field_name=%s provider=%s model=%s "
            "base_url=%s api_key_fingerprint=%s latency_ms=%s detail=%s",
            payload.field_name,
            selected_provider,
            selected_model,
            selected_base_url,
            key_fingerprint,
            latency_ms,
            str(exc),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=AI_SERVICES_UNAVAILABLE_MESSAGE,
        ) from exc

    latency_ms = int((perf_counter() - started_at) * 1000)
    logger.info(
        "event=ai_enhance_usecase_field_end status=success field_name=%s provider=%s model=%s "
        "base_url=%s api_key_fingerprint=%s latency_ms=%s output_length=%s within_limit=%s",
        payload.field_name,
        selected_provider,
        selected_model,
        selected_base_url,
        key_fingerprint,
        latency_ms,
        response.char_count,
        response.within_limit,
    )
    return response


@router.post("/draft-usecase-quality", response_model=DraftUseCaseQualityResponse)
def draft_usecase_quality(
    payload: DraftUseCaseQualityRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Score draft use case fields during registration (requires case_create or case_edit)."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    if not (
        check_permission(db, user, "case_create", allow_admin=True)
        or check_permission(db, user, "case_edit", allow_admin=True)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to analyze draft use case quality.",
        )
    try:
        return ai_field_enhancement_service.score_draft_usecase(payload)
    except Exception as exc:
        logger.error("event=draft_usecase_quality_error detail=%s", str(exc), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=AI_SERVICES_UNAVAILABLE_MESSAGE,
        ) from exc


@router.get("/provider-debug")
def provider_debug(
    request: Request,
    run_connectivity_test: bool = False,
    db: Session = Depends(get_db),
):
    """Return safe LLM provider diagnostics for development and operator debugging."""
    user_id = get_current_user_id(request)
    user, _, _ = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "settings_access",
        allow_admin=True,
        error_message="You do not have permission to inspect AI provider diagnostics.",
    )

    diagnostics = (
        ai_field_enhancement_service.run_provider_connectivity_test()
        if run_connectivity_test
        else ai_field_enhancement_service.get_provider_debug_info()
    )
    logger.info(
        "event=llm_provider_debug provider=%s model=%s base_url=%s api_key_fingerprint=%s "
        "connectivity_test=%s status=%s",
        diagnostics["provider"],
        diagnostics["model"] or "missing",
        diagnostics["base_url"] or "missing",
        diagnostics["api_key_fingerprint"],
        run_connectivity_test,
        diagnostics.get("status", "not_run"),
    )
    return diagnostics


@router.post(
    "/use-cases/{use_case_id}/documentation-quality",
    response_model=UseCaseDocumentationQualityResponse,
)
def analyze_use_case_documentation_quality(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Return a documentation quality analysis for a full use case."""
    started_at = perf_counter()
    provider_debug = usecase_documentation_quality_service.get_provider_debug_info()
    selected_provider = provider_debug["provider"]
    selected_model = provider_debug["model"] or "unconfigured"
    selected_base_url = provider_debug["base_url"] or "missing"
    key_fingerprint = provider_debug["api_key_fingerprint"]

    logger.info(
        "event=use_case_documentation_quality_start use_case_id=%s provider=%s model=%s base_url=%s "
        "api_key_fingerprint=%s",
        use_case_id,
        selected_provider,
        selected_model,
        selected_base_url,
        key_fingerprint,
    )

    try:
        user_id = get_current_user_id(request)
        user, use_case = _require_use_case_access(db, user_id, use_case_id)
        if not _can_access_documentation_quality(db, user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators or users with domain_owner permission can analyze use case documentation quality.",
            )

        response = usecase_documentation_quality_service.analyze_use_case_documentation(
            db=db,
            use_case=use_case,
        )
    except UseCaseDocumentationQualityServiceError as exc:
        latency_ms = int((perf_counter() - started_at) * 1000)
        logger.warning(
            "event=use_case_documentation_quality_end status=failure use_case_id=%s provider=%s model=%s "
            "base_url=%s api_key_fingerprint=%s latency_ms=%s detail=%s",
            use_case_id,
            selected_provider,
            selected_model,
            selected_base_url,
            key_fingerprint,
            latency_ms,
            exc.detail,
        )
        raise HTTPException(
            status_code=exc.status_code,
            detail=user_facing_ai_error_detail(detail=exc.detail, status_code=exc.status_code),
        ) from exc
    except HTTPException as exc:
        latency_ms = int((perf_counter() - started_at) * 1000)
        logger.warning(
            "event=use_case_documentation_quality_end status=failure use_case_id=%s provider=%s model=%s "
            "base_url=%s api_key_fingerprint=%s latency_ms=%s detail=%s",
            use_case_id,
            selected_provider,
            selected_model,
            selected_base_url,
            key_fingerprint,
            latency_ms,
            str(exc.detail),
        )
        raise
    except Exception as exc:
        latency_ms = int((perf_counter() - started_at) * 1000)
        logger.error(
            "event=use_case_documentation_quality_end status=failure use_case_id=%s provider=%s model=%s "
            "base_url=%s api_key_fingerprint=%s latency_ms=%s detail=%s",
            use_case_id,
            selected_provider,
            selected_model,
            selected_base_url,
            key_fingerprint,
            latency_ms,
            str(exc),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=AI_SERVICES_UNAVAILABLE_MESSAGE,
        ) from exc

    latency_ms = int((perf_counter() - started_at) * 1000)
    logger.info(
        "event=use_case_documentation_quality_end status=success use_case_id=%s provider=%s model=%s "
        "base_url=%s api_key_fingerprint=%s latency_ms=%s overall_score=%s",
        use_case_id,
        selected_provider,
        selected_model,
        selected_base_url,
        key_fingerprint,
        latency_ms,
        response.overall_score,
    )
    return response


@router.get(
    "/use-cases/{use_case_id}/documentation-quality",
    response_model=UseCaseDocumentationQualityResponse,
)
def get_saved_use_case_documentation_quality(
    use_case_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Return the latest persisted documentation quality analysis."""
    user_id = get_current_user_id(request)
    user, use_case = _require_use_case_access(db, user_id, use_case_id)
    if not _can_access_documentation_quality(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators or users with domain_owner permission can view use case documentation quality analysis.",
        )

    response = usecase_documentation_quality_service.get_saved_use_case_documentation(
        db=db,
        use_case=use_case,
    )
    if response is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No saved documentation quality analysis exists for this use case.",
        )

    return response
