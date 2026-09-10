"""AI-assisted pre-population for use case assessments."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.ai_user_messages import AI_SERVICES_UNAVAILABLE_MESSAGE
from app.core.logging_config import logger
from app.models import (
    UseCase,
    UseCaseAssessment,
    UseCaseComment,
    UseCaseData,
    UseCaseDocumentationQualityResult,
    UseCaseLink,
    UseCaseRiskReview,
    UseCaseTag,
)
from app.services.llm import (
    LLMConfigurationError,
    LLMGateway,
    LLMProviderConnectionError,
    LLMProviderHTTPError,
    LLMProviderTimeoutError,
    LLMStructuredOutputError,
    llm_gateway,
)
from app.services.use_case_assessment_service import save_response

_ASSESSMENT_PREFILL_SYSTEM_PROMPT = (
    "Return JSON with items (template_item_id, selected_labels, comment) and optional overall_findings. "
    "You are a cautious AI governance assessor. Answer ONLY from the supplied use case documentation.\n\n"
    "Rules:\n"
    "1. Select one or more allowed answer labels ONLY when documentation clearly supports them. "
    "Copy labels exactly as listed.\n"
    "2. If documentation is missing, incomplete, ambiguous, or silent on a question, "
    "return an empty selected_labels array []. Do NOT guess.\n"
    "3. Never default to optimistic labels such as Documented, Completed, Allowed, or Low "
    "without explicit supporting evidence.\n"
    "4. In comment, cite the specific documentation section or field when answering. "
    "When not answerable, state that manual review is required and name what documentation is missing.\n"
    "5. Return one item for every question in the batch, including unanswered ones.\n"
    "6. overall_findings must be a single plain-text string (not a JSON object). "
    "Summarize documented strengths and documentation gaps — do not assume compliance."
)


def _coerce_text_field(value: Any) -> str:
    """Normalize LLM output that may return strings, lists, or structured objects."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        parts: list[str] = []
        for key, raw in value.items():
            label = str(key).replace("_", " ").strip().capitalize()
            if isinstance(raw, list):
                joined = "; ".join(str(item).strip() for item in raw if str(item).strip())
                if joined:
                    parts.append(f"{label}: {joined}")
            elif raw is not None and str(raw).strip():
                parts.append(f"{label}: {str(raw).strip()}")
        return "\n".join(parts)
    if isinstance(value, list):
        return "; ".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


class AssessmentPrefillItem(BaseModel):
    template_item_id: int
    selected_labels: list[str] = Field(default_factory=list)
    comment: str = ""

    @field_validator("comment", mode="before")
    @classmethod
    def normalize_comment(cls, value: Any) -> str:
        return _coerce_text_field(value)

    @field_validator("selected_labels", mode="before")
    @classmethod
    def normalize_selected_labels(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [value.strip()] if value.strip() else []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return []


class AssessmentPrefillResponse(BaseModel):
    items: list[AssessmentPrefillItem] = Field(default_factory=list)
    overall_findings: str = ""

    @field_validator("overall_findings", mode="before")
    @classmethod
    def normalize_overall_findings(cls, value: Any) -> str:
        return _coerce_text_field(value)


def _json_field(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _build_use_case_documentation_context(db: Session, use_case: UseCase) -> str:
    """Collect all available use case documentation for evidence-based assessment."""
    sections: list[str] = []

    core_fields = [
        ("Name", use_case.use_case_name),
        ("Title", use_case.use_case_title),
        ("Description", use_case.use_case_description),
        ("Intended use", use_case.intended_use),
        ("Expected benefits", use_case.expected_benefits),
        ("Department", use_case.department),
        ("AI category", use_case.ai_category),
        ("Feasibility", use_case.feasibility),
        ("Status", use_case.status),
        ("Intended audience", use_case.intended_audience),
        ("Target audience type", _json_field(use_case.target_audience_type)),
        ("Impacted stakeholders", _json_field(use_case.impacted_stakeholders)),
        ("Solution design overview", use_case.solution_design_overview),
        ("Human-in-the-loop strategy", use_case.human_in_loop_strategy),
        ("Bias assessment performed", use_case.bias_assessment_performed),
        ("Protected attributes", use_case.protected_attributes),
        ("Balancing strategy", use_case.balancing_strategy),
        ("Rejection reason", use_case.rejection_reason),
    ]
    sections.append("=== Core use case fields ===")
    for label, value in core_fields:
        text = (str(value).strip() if value is not None else "")
        sections.append(f"{label}: {text or '[not documented]'}")

    tags = db.query(UseCaseTag).filter(UseCaseTag.use_case_id == use_case.use_case_id).all()
    sections.append("\n=== Tags ===")
    sections.append(", ".join(tag.tag_name for tag in tags) if tags else "[not documented]")

    links = db.query(UseCaseLink).filter(UseCaseLink.use_case_id == use_case.use_case_id).all()
    sections.append("\n=== Reference links ===")
    if links:
        for link in links:
            label = link.label or "Link"
            sections.append(f"- {label}: {link.url}")
    else:
        sections.append("[not documented]")

    data_rows = db.query(UseCaseData).filter(UseCaseData.use_case_id == use_case.use_case_id).all()
    sections.append("\n=== Data requirements ===")
    if data_rows:
        for idx, row in enumerate(data_rows, start=1):
            sections.append(
                f"Requirement {idx}: requirement={row.data_req or '[empty]'}; source={row.data_source or '[empty]'}; "
                f"volume={row.volume or '[empty]'}; classification={row.data_classification or '[empty]'}; "
                f"owner={row.data_owner or '[empty]'}; usage={_json_field(row.data_usage) or '[empty]'}; "
                f"pii_phi={row.is_pii_phi_involved}; dataset_type={row.dataset_type or '[empty]'}; "
                f"lineage_available={row.data_lineage_available}; quality_assessed={row.data_quality_assessed}; "
                f"freshness_confirmed={row.data_freshness_confirmed}"
            )
    else:
        sections.append("[not documented]")

    risks = db.query(UseCaseRiskReview).filter(UseCaseRiskReview.use_case_id == use_case.use_case_id).all()
    sections.append("\n=== Risks and mitigations ===")
    if risks:
        for idx, risk in enumerate(risks, start=1):
            sections.append(
                f"Risk {idx}: category={risk.risk_category or '[empty]'}; title={risk.risk_title or '[empty]'}; "
                f"description={risk.risk_description or '[empty]'}; likelihood={risk.risk_likelihood or '[empty]'}; "
                f"impact={risk.risk_impact or '[empty]'}; status={risk.status}; "
                f"mitigation={risk.mitigation_strategy or '[empty]'}; closure={risk.closure_comment or '[empty]'}"
            )
    else:
        sections.append("[not documented]")

    comments = (
        db.query(UseCaseComment)
        .filter(UseCaseComment.use_case_id == use_case.use_case_id)
        .order_by(UseCaseComment.comment_date.desc())
        .limit(20)
        .all()
    )
    sections.append("\n=== Reviewer comments (most recent) ===")
    if comments:
        for comment in comments:
            sections.append(f"- {comment.comment or '[empty]'}")
    else:
        sections.append("[not documented]")

    doc_quality = (
        db.query(UseCaseDocumentationQualityResult)
        .filter(UseCaseDocumentationQualityResult.use_case_id == use_case.use_case_id)
        .first()
    )
    sections.append("\n=== Documentation quality analysis ===")
    if doc_quality:
        sections.append(
            f"Overall score: {doc_quality.overall_score}%; status: {doc_quality.status_label}; "
            f"strengths: {doc_quality.strengths_count}; improvements needed: {doc_quality.improvements_count}"
        )
        if doc_quality.analysis_payload:
            sections.append(f"Analysis detail: {doc_quality.analysis_payload[:4000]}")
    else:
        sections.append("[not documented]")

    return "\n".join(sections)


def _question_batch(snapshot: dict, batch_size: int = 12) -> list[list[dict]]:
    questions: list[dict] = []
    for area in snapshot.get("areas") or []:
        for item in area.get("items") or []:
            questions.append(
                {
                    "template_item_id": item.get("item_id"),
                    "area_id": area.get("area_id"),
                    "sno": item.get("sno"),
                    "area_title": area.get("title"),
                    "assessment_item": item.get("assessment_item"),
                    "category": item.get("category"),
                    "allowed_checklist_items": item.get("allowed_checklist_items") or [],
                }
            )
    return [questions[i : i + batch_size] for i in range(0, len(questions), batch_size)]


class UseCaseAssessmentAIService:
    def __init__(self, gateway: LLMGateway | None = None) -> None:
        self.gateway = gateway or llm_gateway

    def prefill_assessment(
        self,
        db: Session,
        use_case: UseCase,
        assessment: UseCaseAssessment,
        user_id: str,
    ) -> dict[str, Any]:
        if assessment.status != "IN_PROGRESS":
            raise ValueError("AI prefill is only available for in-progress assessments")

        snapshot = assessment.template_snapshot or {}
        batches = _question_batch(snapshot)
        if not batches:
            raise ValueError("Assessment checklist has no questions")

        context = _build_use_case_documentation_context(db, use_case)
        saved_count = 0
        skipped_count = 0
        overall_parts: list[str] = []

        for batch in batches:
            prompt = (
                "Review the use case documentation below and suggest checklist answers.\n"
                "Use ONLY the documentation provided. Do not invent facts.\n"
                "Leave selected_labels empty when the documentation does not support an answer.\n\n"
                f"USE CASE DOCUMENTATION:\n{context}\n\n"
                f"QUESTIONS JSON:\n{json.dumps(batch, ensure_ascii=False)}\n"
            )
            try:
                result = self.gateway.generate_structured_json(
                    messages=[
                        {"role": "system", "content": _ASSESSMENT_PREFILL_SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                    schema_model=AssessmentPrefillResponse,
                )
            except (
                LLMConfigurationError,
                LLMProviderConnectionError,
                LLMProviderHTTPError,
                LLMProviderTimeoutError,
                LLMStructuredOutputError,
            ) as exc:
                logger.error("Assessment AI prefill failed: %s", exc)
                raise ValueError(AI_SERVICES_UNAVAILABLE_MESSAGE) from exc

            if result.overall_findings:
                overall_parts.append(result.overall_findings.strip())

            batch_map = {int(item["template_item_id"]): item for item in batch}
            for item in result.items:
                meta = batch_map.get(int(item.template_item_id))
                if not meta:
                    continue

                comment = (item.comment or "").strip()
                labels = [label.strip() for label in item.selected_labels if label.strip()]

                if not labels and not comment:
                    skipped_count += 1
                    continue

                save_response(
                    db,
                    assessment,
                    template_item_id=int(item.template_item_id),
                    area_id=int(meta["area_id"]),
                    sno=str(meta["sno"]),
                    selected_labels=labels,
                    comment=comment or None,
                    user_id=user_id,
                )
                saved_count += 1

        assessment.ai_prefill_applied = True
        if overall_parts and not assessment.overall_findings:
            assessment.overall_findings = "\n\n".join(overall_parts)
        db.flush()

        return {
            "prefilled_count": saved_count,
            "skipped_count": skipped_count,
            "overall_findings": assessment.overall_findings,
        }


use_case_assessment_ai_service = UseCaseAssessmentAIService()
