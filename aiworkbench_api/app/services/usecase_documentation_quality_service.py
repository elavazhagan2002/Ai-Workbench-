"""
Documentation quality analysis service for full use cases.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging_config import logger
from app.models import (
    Domain,
    UseCase,
    UseCaseComment,
    UseCaseData,
    UseCaseDocument,
    UseCaseDocumentationQualityResult,
    UseCaseLink,
    UseCaseRisk,
    UseCaseRiskReview,
)
from app.schemas.ai_assist import (
    DocumentationQualitySectionScore,
    DocumentationQualitySectionScores,
    DocumentationQualitySummary,
    UseCaseDocumentationQualityDetail,
    UseCaseDocumentationQualityResponse,
)
from app.services.llm import (
    LLMGateway,
    llm_gateway,
)

_SECTION_MAX_SCORES = {
    "effective_title": 10,
    "use_case_explanation": 30,
    "design_specification": 20,
    "risks_logged": 20,
    "data_requirements": 10,
    "references": 5,
    "comments": 5,
}
_RISK_PRESENCE_MAX_SCORE = 8
_RISK_QUALITY_MAX_SCORE = 12
_GENERIC_TITLE_VALUES = {
    "test",
    "test 1",
    "test 2",
    "untitled",
    "untitled use case",
    "use case",
    "demo",
    "sample",
    "poc",
    "dummy",
    "temp",
    "new use case",
    "new",
}
_DESIGN_KEYWORDS = (
    "architecture",
    "integration",
    "workflow",
    "data flow",
    "dataflow",
    "security",
    "control",
    "api",
    "model",
    "pipeline",
    "interface",
    "component",
    "orchestration",
    "governance",
    "validation",
)


@dataclass(frozen=True)
class _NormalizedDocumentationQualityPayload:
    use_case_id: str
    use_case_name: str | None
    use_case_title: str | None
    use_case_description: str | None
    expected_benefits: str | None
    solution_design_overview: str | None
    domain_name: str | None
    department: str | None
    risk_items: list[dict[str, Any]]
    data_requirement_examples: list[dict[str, str | None]]
    reference_link_examples: list[dict[str, str | None]]
    document_examples: list[dict[str, str | bool | None]]
    deterministic_facts: dict[str, Any]
    source_updated_at: datetime | None


@dataclass(frozen=True)
class _DeterministicDocumentationQualityScores:
    effective_title: DocumentationQualitySectionScore
    use_case_explanation: DocumentationQualitySectionScore
    design_specification: DocumentationQualitySectionScore
    risks_logged: DocumentationQualitySectionScore
    data_requirements: DocumentationQualitySectionScore
    references: DocumentationQualitySectionScore
    comments: DocumentationQualitySectionScore


class UseCaseDocumentationQualityServiceError(Exception):
    """Controlled application error raised by the documentation quality service."""

    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class UseCaseDocumentationQualityService:
    """Generate a content-based documentation quality score for a full use case."""

    def __init__(self, app_settings=settings) -> None:
        self.settings = app_settings
        self.llm_gateway = llm_gateway if app_settings is settings else LLMGateway(app_settings)

    def get_provider_debug_info(self) -> dict[str, Any]:
        """Return safe runtime diagnostics for the configured provider."""
        return self.llm_gateway.get_provider_debug_info()

    def analyze_use_case_documentation(
        self,
        *,
        db: Session,
        use_case: UseCase,
    ) -> UseCaseDocumentationQualityResponse:
        """Analyze a full use case and return a content-based documentation quality report."""
        normalized_payload = self._build_normalized_payload(db=db, use_case=use_case)
        deterministic_scores = self._build_deterministic_scores(normalized_payload)
        detail_payload = self._build_final_response(
            normalized_payload=normalized_payload,
            deterministic_scores=deterministic_scores,
        )
        saved_result = self._persist_latest_analysis(
            db=db,
            use_case_id=use_case.use_case_id,
            detail_payload=detail_payload,
            source_updated_at=normalized_payload.source_updated_at,
        )
        return self._build_response_from_saved_result(
            saved_result,
            current_source_updated_at=normalized_payload.source_updated_at,
        )

    def get_saved_use_case_documentation(
        self,
        *,
        db: Session,
        use_case: UseCase,
    ) -> UseCaseDocumentationQualityResponse | None:
        """Return the latest persisted documentation quality analysis without recalculating."""
        saved_result = self._get_saved_result(db=db, use_case_id=use_case.use_case_id)
        if saved_result is None:
            return None
        current_source_updated_at = self._build_source_updated_at_map(
            db=db,
            use_cases=[use_case],
        ).get(use_case.use_case_id)
        return self._build_response_from_saved_result(
            saved_result,
            current_source_updated_at=current_source_updated_at,
        )

    def get_documentation_quality_summary(
        self,
        *,
        db: Session,
        use_case: UseCase,
    ) -> DocumentationQualitySummary | None:
        """Return the saved documentation quality summary for one use case."""
        return self.get_documentation_quality_summary_map(
            db=db,
            use_cases=[use_case],
        ).get(use_case.use_case_id)

    def get_documentation_quality_summary_map(
        self,
        *,
        db: Session,
        use_cases: list[UseCase],
    ) -> dict[str, DocumentationQualitySummary]:
        """Return saved documentation quality summaries keyed by use_case_id."""
        if not use_cases:
            return {}

        use_case_ids = [use_case.use_case_id for use_case in use_cases]
        saved_results = (
            db.query(UseCaseDocumentationQualityResult)
            .filter(UseCaseDocumentationQualityResult.use_case_id.in_(use_case_ids))
            .all()
        )
        current_source_updated_at_map = self._build_source_updated_at_map(
            db=db,
            use_cases=use_cases,
        )
        return {
            saved_result.use_case_id: self._build_summary_from_saved_result(
                saved_result,
                current_source_updated_at=current_source_updated_at_map.get(saved_result.use_case_id),
            )
            for saved_result in saved_results
        }

    def _build_normalized_payload(
        self,
        *,
        db: Session,
        use_case: UseCase,
    ) -> _NormalizedDocumentationQualityPayload:
        """Load related use case records and normalize them into one scoring payload."""
        domain = db.query(Domain).filter(Domain.domain_id == use_case.domain_id).first()
        data_requirements = (
            db.query(UseCaseData)
            .filter(UseCaseData.use_case_id == use_case.use_case_id)
            .order_by(UseCaseData.data_req_id.asc())
            .all()
        )
        risk_reviews = (
            db.query(UseCaseRiskReview)
            .filter(UseCaseRiskReview.use_case_id == use_case.use_case_id)
            .order_by(UseCaseRiskReview.risk_review_id.asc())
            .all()
        )
        legacy_risks = (
            db.query(UseCaseRisk)
            .filter(UseCaseRisk.use_case_id == use_case.use_case_id)
            .order_by(UseCaseRisk.risk_id.asc())
            .all()
        )
        reference_links = (
            db.query(UseCaseLink)
            .filter(UseCaseLink.use_case_id == use_case.use_case_id)
            .order_by(UseCaseLink.link_id.asc())
            .all()
        )
        documents = (
            db.query(UseCaseDocument)
            .filter(UseCaseDocument.use_case_id == use_case.use_case_id)
            .order_by(UseCaseDocument.uploaded_dt.desc())
            .all()
        )
        comments = (
            db.query(UseCaseComment)
            .filter(UseCaseComment.use_case_id == use_case.use_case_id)
            .order_by(UseCaseComment.comment_date.desc())
            .all()
        )

        risk_items = self._normalize_risk_items(risk_reviews=risk_reviews, legacy_risks=legacy_risks)
        data_requirement_examples = [self._normalize_data_requirement(item) for item in data_requirements[:5]]
        reference_link_examples = [self._normalize_reference_link(item) for item in reference_links[:5]]
        document_examples = [self._normalize_document(item) for item in documents[:5]]
        deterministic_facts = self._build_deterministic_facts(
            use_case=use_case,
            risk_items=risk_items,
            data_requirements=data_requirements,
            reference_links=reference_links,
            documents=documents,
            comments=comments,
        )
        source_updated_at = self._compute_source_updated_at(
            use_case=use_case,
            data_requirements=data_requirements,
            risk_reviews=risk_reviews,
            legacy_risks=legacy_risks,
            reference_links=reference_links,
            documents=documents,
            comments=comments,
        )

        return _NormalizedDocumentationQualityPayload(
            use_case_id=use_case.use_case_id,
            use_case_name=self._normalize_text(use_case.use_case_name, 120),
            use_case_title=self._normalize_text(use_case.use_case_title, 240),
            use_case_description=self._normalize_text(use_case.use_case_description, 3000),
            expected_benefits=self._normalize_text(use_case.expected_benefits, 3000),
            solution_design_overview=self._normalize_text(use_case.solution_design_overview, 3000),
            domain_name=self._normalize_text(domain.domain_name if domain else None, 120),
            department=self._normalize_text(use_case.department, 120),
            risk_items=risk_items,
            data_requirement_examples=data_requirement_examples,
            reference_link_examples=reference_link_examples,
            document_examples=document_examples,
            deterministic_facts=deterministic_facts,
            source_updated_at=source_updated_at,
        )

    def _build_deterministic_facts(
        self,
        *,
        use_case: UseCase,
        risk_items: list[dict[str, Any]],
        data_requirements: list[UseCaseData],
        reference_links: list[UseCaseLink],
        documents: list[UseCaseDocument],
        comments: list[UseCaseComment],
    ) -> dict[str, Any]:
        """Precompute transparent, presence-based facts used in hybrid scoring."""
        meaningful_data_requirement_count = sum(
            1 for item in data_requirements if self._is_meaningful_data_requirement(item)
        )
        described_data_requirement_count = sum(
            1 for item in data_requirements if self._has_meaningful_text(item.data_req, minimum_length=8)
        )
        sourced_data_requirement_count = sum(
            1
            for item in data_requirements
            if self._has_meaningful_text(item.data_source) or self._has_meaningful_text(item.volume)
        )
        risk_with_description_count = sum(
            1
            for item in risk_items
            if self._has_meaningful_text(item.get("risk_title"))
            or self._has_meaningful_text(item.get("risk_description"), minimum_length=15)
        )
        mitigated_risk_count = sum(
            1 for item in risk_items if self._has_meaningful_text(item.get("mitigation_strategy"), minimum_length=15)
        )
        meaningful_comment_count = sum(
            1 for item in comments if self._has_meaningful_text(item.comment, minimum_length=20)
        )
        rated_comment_count = sum(1 for item in comments if item.rating is not None)
        infographic_count = sum(
            1 for item in documents if str(item.file_name or "").upper().startswith("INFOGRAPHIC__")
        )

        return {
            "has_use_case_name": bool(self._normalize_text(use_case.use_case_name, 120)),
            "has_use_case_title": bool(self._normalize_text(use_case.use_case_title, 240)),
            "has_description": bool(self._normalize_text(use_case.use_case_description, 3000)),
            "has_expected_benefits": bool(self._normalize_text(use_case.expected_benefits, 3000)),
            "has_solution_design_overview": bool(self._normalize_text(use_case.solution_design_overview, 3000)),
            "risk_count": len(risk_items),
            "risk_with_description_count": risk_with_description_count,
            "mitigated_risk_count": mitigated_risk_count,
            "data_requirement_count": len(data_requirements),
            "meaningful_data_requirement_count": meaningful_data_requirement_count,
            "described_data_requirement_count": described_data_requirement_count,
            "sourced_data_requirement_count": sourced_data_requirement_count,
            "reference_link_count": len(reference_links),
            "document_count": len(documents),
            "infographic_count": infographic_count,
            "reference_count": len(reference_links) + len(documents),
            "comment_count": len(comments),
            "meaningful_comment_count": meaningful_comment_count,
            "rated_comment_count": rated_comment_count,
        }

    def _build_deterministic_scores(
        self,
        normalized_payload: _NormalizedDocumentationQualityPayload,
    ) -> _DeterministicDocumentationQualityScores:
        """Compute deterministic section scores from the current use-case documentation."""
        facts = normalized_payload.deterministic_facts
        return _DeterministicDocumentationQualityScores(
            effective_title=self._score_effective_title(normalized_payload),
            use_case_explanation=self._score_use_case_explanation(normalized_payload),
            design_specification=self._score_design_specification(normalized_payload),
            risks_logged=self._score_risks_logged(facts),
            data_requirements=self._score_data_requirements(facts),
            references=self._score_references(facts),
            comments=self._score_comments(facts),
        )

    def _build_final_response(
        self,
        *,
        normalized_payload: _NormalizedDocumentationQualityPayload,
        deterministic_scores: _DeterministicDocumentationQualityScores,
    ) -> UseCaseDocumentationQualityDetail:
        """Assemble the final rubric response from content-based scores."""
        facts = normalized_payload.deterministic_facts
        section_scores = DocumentationQualitySectionScores(
            effective_title=deterministic_scores.effective_title,
            use_case_explanation=deterministic_scores.use_case_explanation,
            design_specification=deterministic_scores.design_specification,
            risks_logged=deterministic_scores.risks_logged,
            data_requirements=deterministic_scores.data_requirements,
            references=deterministic_scores.references,
            comments=deterministic_scores.comments,
        )

        overall_score = min(
            100,
            sum(
                section.score
                for section in (
                    section_scores.effective_title,
                    section_scores.use_case_explanation,
                    section_scores.design_specification,
                    section_scores.risks_logged,
                    section_scores.data_requirements,
                    section_scores.references,
                    section_scores.comments,
                )
            ),
        )
        strengths = self._build_strengths(deterministic_scores=deterministic_scores)
        improvement_suggestions = self._build_improvement_suggestions(
            facts=facts,
            deterministic_scores=deterministic_scores,
        )

        return UseCaseDocumentationQualityDetail(
            use_case_id=normalized_payload.use_case_id,
            overall_score=overall_score,
            section_scores=section_scores,
            strengths=strengths,
            improvement_suggestions=improvement_suggestions,
        )

    def _persist_latest_analysis(
        self,
        *,
        db: Session,
        use_case_id: str,
        detail_payload: UseCaseDocumentationQualityDetail,
        source_updated_at: datetime | None,
    ) -> UseCaseDocumentationQualityResult:
        """Upsert the latest documentation quality analysis for the use case."""
        saved_result = self._get_saved_result(db=db, use_case_id=use_case_id)
        if saved_result is None:
            saved_result = UseCaseDocumentationQualityResult(use_case_id=use_case_id)

        saved_result.overall_score = detail_payload.overall_score
        saved_result.strengths_count = len(detail_payload.strengths)
        saved_result.improvements_count = len(detail_payload.improvement_suggestions)
        saved_result.status_label = self._build_status_label(detail_payload.overall_score)
        saved_result.analyzed_at = datetime.utcnow()
        saved_result.source_updated_at = source_updated_at
        saved_result.analysis_payload = json.dumps(
            detail_payload.model_dump(mode="json"),
            ensure_ascii=True,
        )

        db.add(saved_result)
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.error(
                "event=use_case_documentation_quality_persist_failure use_case_id=%s detail=%s",
                use_case_id,
                str(exc),
                exc_info=True,
            )
            raise UseCaseDocumentationQualityServiceError(
                "Failed to persist documentation quality analysis.",
                500,
            ) from exc

        db.refresh(saved_result)
        return saved_result

    def _get_saved_result(
        self,
        *,
        db: Session,
        use_case_id: str,
    ) -> UseCaseDocumentationQualityResult | None:
        """Fetch the latest saved documentation quality result for a use case."""
        return (
            db.query(UseCaseDocumentationQualityResult)
            .filter(UseCaseDocumentationQualityResult.use_case_id == use_case_id)
            .first()
        )

    def _build_response_from_saved_result(
        self,
        saved_result: UseCaseDocumentationQualityResult,
        *,
        current_source_updated_at: datetime | None,
    ) -> UseCaseDocumentationQualityResponse:
        """Hydrate the API response from the persisted record."""
        try:
            payload = json.loads(saved_result.analysis_payload or "{}")
        except json.JSONDecodeError as exc:
            logger.error(
                "event=use_case_documentation_quality_invalid_saved_payload use_case_id=%s detail=%s",
                saved_result.use_case_id,
                str(exc),
                exc_info=True,
            )
            raise UseCaseDocumentationQualityServiceError(
                "Stored documentation quality analysis is invalid.",
                500,
            ) from exc

        payload["documentation_quality_summary"] = self._build_summary_from_saved_result(
            saved_result,
            current_source_updated_at=current_source_updated_at,
        ).model_dump(mode="json")
        try:
            return UseCaseDocumentationQualityResponse.model_validate(payload)
        except Exception as exc:
            logger.error(
                "event=use_case_documentation_quality_invalid_saved_response use_case_id=%s detail=%s",
                saved_result.use_case_id,
                str(exc),
                exc_info=True,
            )
            raise UseCaseDocumentationQualityServiceError(
                "Stored documentation quality analysis is invalid.",
                500,
            ) from exc

    def _build_summary_from_saved_result(
        self,
        saved_result: UseCaseDocumentationQualityResult,
        *,
        current_source_updated_at: datetime | None,
    ) -> DocumentationQualitySummary:
        """Build the lightweight saved-summary payload used by list and detail responses."""
        is_stale = False
        if saved_result.source_updated_at is None:
            is_stale = current_source_updated_at is not None
        elif current_source_updated_at is not None:
            is_stale = current_source_updated_at > saved_result.source_updated_at

        return DocumentationQualitySummary(
            overall_score=saved_result.overall_score,
            strengths_count=saved_result.strengths_count,
            improvements_count=saved_result.improvements_count,
            status_label=saved_result.status_label,
            analyzed_at=saved_result.analyzed_at,
            is_stale=is_stale,
        )

    def _build_status_label(self, overall_score: int) -> str:
        """Map the numeric score into a stable rating bucket for compact UI display."""
        if overall_score >= 85:
            return "Excellent"
        if overall_score >= 70:
            return "Good"
        if overall_score >= 50:
            return "Fair"
        return "Needs Attention"

    def _compute_source_updated_at(
        self,
        *,
        use_case: UseCase,
        data_requirements: list[UseCaseData],
        risk_reviews: list[UseCaseRiskReview],
        legacy_risks: list[UseCaseRisk],
        reference_links: list[UseCaseLink],
        documents: list[UseCaseDocument],
        comments: list[UseCaseComment],
    ) -> datetime | None:
        """Track the latest source-content timestamp covered by an analysis run."""
        latest_timestamp = use_case.modified_dt or use_case.created_dt
        for item in data_requirements:
            latest_timestamp = self._pick_later_datetime(
                latest_timestamp,
                item.modified_dt or item.created_dt,
            )
        for item in risk_reviews:
            latest_timestamp = self._pick_later_datetime(
                latest_timestamp,
                item.modified_dt or item.created_dt,
            )
        for item in legacy_risks:
            latest_timestamp = self._pick_later_datetime(
                latest_timestamp,
                item.modified_dt or item.created_dt,
            )
        for item in reference_links:
            latest_timestamp = self._pick_later_datetime(latest_timestamp, item.created_dt)
        for item in documents:
            latest_timestamp = self._pick_later_datetime(latest_timestamp, item.uploaded_dt)
        for item in comments:
            latest_timestamp = self._pick_later_datetime(latest_timestamp, item.comment_date)
        return latest_timestamp

    def _build_source_updated_at_map(
        self,
        *,
        db: Session,
        use_cases: list[UseCase],
    ) -> dict[str, datetime | None]:
        """Batch-compute the latest relevant source-content timestamp per use case."""
        if not use_cases:
            return {}

        use_case_ids = [use_case.use_case_id for use_case in use_cases]
        latest_by_use_case = {
            use_case.use_case_id: use_case.modified_dt or use_case.created_dt
            for use_case in use_cases
        }

        latest_timestamp_queries = (
            db.query(
                UseCaseData.use_case_id,
                func.max(func.coalesce(UseCaseData.modified_dt, UseCaseData.created_dt)).label("latest_source_updated_at"),
            )
            .filter(UseCaseData.use_case_id.in_(use_case_ids))
            .group_by(UseCaseData.use_case_id)
            .all(),
            db.query(
                UseCaseRiskReview.use_case_id,
                func.max(func.coalesce(UseCaseRiskReview.modified_dt, UseCaseRiskReview.created_dt)).label("latest_source_updated_at"),
            )
            .filter(UseCaseRiskReview.use_case_id.in_(use_case_ids))
            .group_by(UseCaseRiskReview.use_case_id)
            .all(),
            db.query(
                UseCaseRisk.use_case_id,
                func.max(func.coalesce(UseCaseRisk.modified_dt, UseCaseRisk.created_dt)).label("latest_source_updated_at"),
            )
            .filter(UseCaseRisk.use_case_id.in_(use_case_ids))
            .group_by(UseCaseRisk.use_case_id)
            .all(),
            db.query(
                UseCaseLink.use_case_id,
                func.max(UseCaseLink.created_dt).label("latest_source_updated_at"),
            )
            .filter(UseCaseLink.use_case_id.in_(use_case_ids))
            .group_by(UseCaseLink.use_case_id)
            .all(),
            db.query(
                UseCaseDocument.use_case_id,
                func.max(UseCaseDocument.uploaded_dt).label("latest_source_updated_at"),
            )
            .filter(UseCaseDocument.use_case_id.in_(use_case_ids))
            .group_by(UseCaseDocument.use_case_id)
            .all(),
            db.query(
                UseCaseComment.use_case_id,
                func.max(UseCaseComment.comment_date).label("latest_source_updated_at"),
            )
            .filter(UseCaseComment.use_case_id.in_(use_case_ids))
            .group_by(UseCaseComment.use_case_id)
            .all(),
        )

        for rows in latest_timestamp_queries:
            for row in rows:
                use_case_id = row.use_case_id
                latest_by_use_case[use_case_id] = self._pick_later_datetime(
                    latest_by_use_case.get(use_case_id),
                    row.latest_source_updated_at,
                )

        return latest_by_use_case

    def _pick_later_datetime(
        self,
        left: datetime | None,
        right: datetime | None,
    ) -> datetime | None:
        """Return the later of two optional datetimes."""
        if left is None:
            return right
        if right is None:
            return left
        return right if right > left else left

    def _build_strengths(
        self,
        *,
        deterministic_scores: _DeterministicDocumentationQualityScores,
    ) -> list[str]:
        """Build repeatable strengths from the same rubric that produced the scores."""
        strengths: list[str] = []
        if deterministic_scores.effective_title.score >= 8:
            strengths.append("The title is specific enough to identify the use case without extra context.")
        if deterministic_scores.use_case_explanation.score >= 20:
            strengths.append("The explanation and expected benefits together describe purpose and outcomes.")
        if deterministic_scores.design_specification.score >= 14:
            strengths.append("The solution design overview has enough structure for a reviewer to follow.")
        if deterministic_scores.risks_logged.score >= 12:
            strengths.append("Risks are logged and include meaningful mitigation coverage.")
        if deterministic_scores.data_requirements.score >= 8:
            strengths.append("Data requirements are documented with meaningful requirement details.")
        if deterministic_scores.references.score >= 4:
            strengths.append("Supporting references include more than a bare minimum of evidence.")
        if deterministic_scores.comments.score >= 4:
            strengths.append("Reviewer commentary is present, which improves documentation traceability.")
        return self._dedupe_text_list(strengths)

    def _build_improvement_suggestions(
        self,
        *,
        facts: dict[str, Any],
        deterministic_scores: _DeterministicDocumentationQualityScores,
    ) -> list[str]:
        """Add deterministic improvement actions for missing or weak documentation."""
        suggestions: list[str] = []
        if deterministic_scores.effective_title.score < _SECTION_MAX_SCORES["effective_title"]:
            suggestions.append("Replace generic titles with a specific statement of the business problem or solution intent.")
        if not facts["has_description"] or not facts["has_expected_benefits"]:
            suggestions.append("Complete both the description and expected benefits so reviewers can assess purpose and outcomes.")
        elif deterministic_scores.use_case_explanation.score < 20:
            suggestions.append("Expand the description and expected benefits with distinct, reviewable detail instead of repeating the same text.")
        if not facts["has_solution_design_overview"]:
            suggestions.append("Document the solution design overview with architecture, data flow, integrations, and controls.")
        elif deterministic_scores.design_specification.score < 14:
            suggestions.append("Add more design detail covering workflow, integrations, data handling, and controls.")
        if facts["risk_count"] == 0:
            suggestions.append("Log at least one concrete risk for the use case.")
        elif facts["mitigated_risk_count"] == 0:
            suggestions.append("Add mitigation strategies to the logged risks.")
        if deterministic_scores.data_requirements.score < _SECTION_MAX_SCORES["data_requirements"]:
            suggestions.append("Document data requirements with the required data, source, and expected volume.")
        if deterministic_scores.references.score < _SECTION_MAX_SCORES["references"]:
            suggestions.append("Add supporting reference links or attached documents to strengthen the record.")
        if deterministic_scores.comments.score == 0:
            suggestions.append("Capture reviewer comments or discussion notes to improve documentation traceability.")
        return self._dedupe_text_list(suggestions)

    def _score_effective_title(
        self,
        normalized_payload: _NormalizedDocumentationQualityPayload,
    ) -> DocumentationQualitySectionScore:
        """Score title quality from length, specificity, and uniqueness."""
        title = normalized_payload.use_case_title or normalized_payload.use_case_name
        if not title:
            return DocumentationQualitySectionScore(
                score=0,
                max_score=_SECTION_MAX_SCORES["effective_title"],
                reason="No title is documented.",
            )

        word_count = len(title.split())
        generic = self._is_generic_title(title)
        distinct_from_name = bool(
            normalized_payload.use_case_title
            and normalized_payload.use_case_name
            and self._compare_normalized_text(normalized_payload.use_case_title)
            != self._compare_normalized_text(normalized_payload.use_case_name)
        )

        score = 2
        if len(title) >= 20:
            score += 2
        if len(title) >= 40 or word_count >= 6:
            score += 2
        if distinct_from_name:
            score += 2
        if not generic:
            score += 2
        else:
            score = min(score, 4)

        if generic:
            reason = (
                f"Title '{title}' is present but too generic to describe the use case. "
                "Use a specific business problem or solution statement."
            )
        elif score >= 8:
            reason = "Title is present, specific, and long enough to identify the use case."
        else:
            reason = (
                "Title exists but needs more descriptive detail, or a title that is distinct from the use case name."
            )
        return DocumentationQualitySectionScore(
            score=score,
            max_score=_SECTION_MAX_SCORES["effective_title"],
            reason=reason,
        )

    def _score_use_case_explanation(
        self,
        normalized_payload: _NormalizedDocumentationQualityPayload,
    ) -> DocumentationQualitySectionScore:
        """Score explanation quality from description and expected-benefits coverage."""
        description = normalized_payload.use_case_description
        benefits = normalized_payload.expected_benefits
        description_length = len(description or "")
        benefits_length = len(benefits or "")

        if not description and not benefits:
            return DocumentationQualitySectionScore(
                score=0,
                max_score=_SECTION_MAX_SCORES["use_case_explanation"],
                reason="Description and expected benefits are missing.",
            )

        description_score = 0
        if description_length >= 300:
            description_score = 22
        elif description_length >= 120:
            description_score = 18
        elif description_length >= 40:
            description_score = 12
        elif description_length > 0:
            description_score = 6

        benefits_score = 0
        if benefits_length >= 120:
            benefits_score = 8
        elif benefits_length >= 40:
            benefits_score = 6
        elif benefits_length > 0:
            benefits_score = 3

        score = description_score + benefits_score
        identical = bool(
            description
            and benefits
            and self._compare_normalized_text(description) == self._compare_normalized_text(benefits)
        )
        if identical:
            score = max(0, score - 6)

        score = min(_SECTION_MAX_SCORES["use_case_explanation"], score)
        if identical:
            reason = (
                "Description and expected benefits are present but identical, so they add little independent detail."
            )
        elif not description:
            reason = "Expected benefits are present, but the use case explanation is missing."
        elif not benefits:
            reason = "A description is present, but expected benefits are missing."
        elif score >= 20:
            reason = "Description and expected benefits both contain reviewable, distinct detail."
        else:
            reason = (
                f"Description ({description_length} characters) and expected benefits ({benefits_length} characters) "
                "are present but still too brief for a complete explanation."
            )
        return DocumentationQualitySectionScore(
            score=score,
            max_score=_SECTION_MAX_SCORES["use_case_explanation"],
            reason=reason,
        )

    def _score_design_specification(
        self,
        normalized_payload: _NormalizedDocumentationQualityPayload,
    ) -> DocumentationQualitySectionScore:
        """Score design coverage from length and structured design signals."""
        design = normalized_payload.solution_design_overview
        if not design:
            return DocumentationQualitySectionScore(
                score=0,
                max_score=_SECTION_MAX_SCORES["design_specification"],
                reason="Solution design overview is missing.",
            )

        design_length = len(design)
        lowered = design.lower()
        keyword_hits = sum(1 for keyword in _DESIGN_KEYWORDS if keyword in lowered)

        if design_length >= 250:
            score = 16
        elif design_length >= 120:
            score = 12
        elif design_length >= 40:
            score = 8
        else:
            score = 4

        score = min(_SECTION_MAX_SCORES["design_specification"], score + min(4, keyword_hits))
        if score >= 16:
            reason = "Solution design overview is substantial and includes structured design detail."
        elif keyword_hits:
            reason = (
                f"Solution design overview is present ({design_length} characters) with {keyword_hits} "
                "design-related signal(s), but it still needs more complete coverage."
            )
        else:
            reason = (
                f"Solution design overview is present ({design_length} characters) but lacks architecture, "
                "integration, data flow, or control detail."
            )
        return DocumentationQualitySectionScore(
            score=score,
            max_score=_SECTION_MAX_SCORES["design_specification"],
            reason=reason,
        )

    def _score_risks_logged(self, facts: dict[str, Any]) -> DocumentationQualitySectionScore:
        """Score logged risks from presence plus completeness of descriptions and mitigations."""
        presence_score = self._score_risk_presence(facts)
        quality_score = self._score_risk_quality(facts)
        score = min(_SECTION_MAX_SCORES["risks_logged"], presence_score + quality_score)
        presence_reason = self._build_risk_presence_reason(facts, presence_score)
        if facts["risk_count"] == 0:
            quality_reason = "Quality score 0/12 because no risks are available to review."
        else:
            quality_reason = (
                f"Quality score {quality_score}/12 based on "
                f"{facts['risk_with_description_count']} described risk(s) and "
                f"{facts['mitigated_risk_count']} with mitigation strategies."
            )
        return DocumentationQualitySectionScore(
            score=score,
            max_score=_SECTION_MAX_SCORES["risks_logged"],
            reason=f"{presence_reason} {quality_reason}".strip()[:1000],
        )

    def _score_risk_quality(self, facts: dict[str, Any]) -> int:
        """Score how completely logged risks are described and mitigated."""
        risk_count = facts["risk_count"]
        if risk_count == 0:
            return 0

        described_ratio = facts["risk_with_description_count"] / risk_count
        mitigated_ratio = facts["mitigated_risk_count"] / risk_count
        return min(
            _RISK_QUALITY_MAX_SCORE,
            round((described_ratio * 6) + (mitigated_ratio * 6)),
        )

    def _score_risk_presence(self, facts: dict[str, Any]) -> int:
        """Score presence-based risk coverage before qualitative review is applied."""
        risk_count = facts["risk_count"]
        described_count = facts["risk_with_description_count"]
        mitigated_count = facts["mitigated_risk_count"]

        if risk_count == 0:
            return 0

        score = 3
        if described_count >= risk_count:
            score += 2
        elif described_count > 0:
            score += 1

        if mitigated_count >= risk_count:
            score += 3
        elif mitigated_count > 0:
            score += 2
        return min(_RISK_PRESENCE_MAX_SCORE, score)

    def _build_risk_presence_reason(self, facts: dict[str, Any], score: int) -> str:
        """Explain the deterministic portion of the risk section score."""
        if facts["risk_count"] == 0:
            return "Presence/coverage score 0/8 because no risks are logged."
        return (
            f"Presence/coverage score {score}/8 based on {facts['risk_count']} logged risk(s), "
            f"{facts['risk_with_description_count']} with titles or descriptions, and "
            f"{facts['mitigated_risk_count']} with mitigation strategies."
        )

    def _score_data_requirements(self, facts: dict[str, Any]) -> DocumentationQualitySectionScore:
        """Score data requirements with simple, transparent deterministic rules."""
        count = facts["data_requirement_count"]
        if count == 0:
            return DocumentationQualitySectionScore(
                score=0,
                max_score=_SECTION_MAX_SCORES["data_requirements"],
                reason="No data requirements are documented.",
            )

        score = 4
        if facts["described_data_requirement_count"] > 0:
            score += 3
        if facts["sourced_data_requirement_count"] > 0:
            score += 3
        score = min(_SECTION_MAX_SCORES["data_requirements"], score)
        reason = (
            f"{count} data requirement(s) are present, "
            f"{facts['described_data_requirement_count']} include requirement text, and "
            f"{facts['sourced_data_requirement_count']} include source or volume details."
        )
        return DocumentationQualitySectionScore(
            score=score,
            max_score=_SECTION_MAX_SCORES["data_requirements"],
            reason=reason,
        )

    def _score_references(self, facts: dict[str, Any]) -> DocumentationQualitySectionScore:
        """Score reference support without rewarding uncontrolled count inflation."""
        total = facts["reference_count"]
        if total == 0:
            return DocumentationQualitySectionScore(
                score=0,
                max_score=_SECTION_MAX_SCORES["references"],
                reason="No reference links or supporting documents are attached.",
            )

        score = 3
        if facts["reference_link_count"] > 0 and facts["document_count"] > 0:
            score += 1
        if total >= 3 or facts["infographic_count"] > 0:
            score += 1
        reason = (
            f"{facts['reference_link_count']} reference link(s) and {facts['document_count']} document(s) are attached"
            f" ({facts['infographic_count']} infographic-style file(s))."
        )
        return DocumentationQualitySectionScore(
            score=min(_SECTION_MAX_SCORES["references"], score),
            max_score=_SECTION_MAX_SCORES["references"],
            reason=reason,
        )

    def _score_comments(self, facts: dict[str, Any]) -> DocumentationQualitySectionScore:
        """Score review-discussion presence with lightweight deterministic checks."""
        count = facts["comment_count"]
        if count == 0:
            return DocumentationQualitySectionScore(
                score=0,
                max_score=_SECTION_MAX_SCORES["comments"],
                reason="No comments or review discussion are documented.",
            )

        score = 3
        if facts["meaningful_comment_count"] > 0:
            score += 1
        if count > 1 or facts["rated_comment_count"] > 0:
            score += 1
        reason = (
            f"{count} comment(s) are present, {facts['meaningful_comment_count']} contain substantial text, "
            f"and {facts['rated_comment_count']} include ratings."
        )
        return DocumentationQualitySectionScore(
            score=min(_SECTION_MAX_SCORES["comments"], score),
            max_score=_SECTION_MAX_SCORES["comments"],
            reason=reason,
        )

    def _normalize_risk_items(
        self,
        *,
        risk_reviews: list[UseCaseRiskReview],
        legacy_risks: list[UseCaseRisk],
    ) -> list[dict[str, Any]]:
        """Combine legacy and current risk records into one normalized structure."""
        items: list[dict[str, Any]] = []
        for item in risk_reviews:
            items.append(
                {
                    "source": "risk_review",
                    "risk_title": self._normalize_text(item.risk_title, 160),
                    "risk_description": self._normalize_text(item.risk_description, 800),
                    "mitigation_strategy": self._normalize_text(item.mitigation_strategy, 800),
                    "status": self._normalize_text(item.status, 40),
                    "risk_category": self._normalize_text(item.risk_category, 60),
                    "risk_likelihood": self._normalize_text(item.risk_likelihood, 40),
                    "risk_impact": self._normalize_text(item.risk_impact, 40),
                }
            )
        for item in legacy_risks:
            items.append(
                {
                    "source": "risk",
                    "risk_title": self._normalize_text(item.risk_title, 160),
                    "risk_description": self._normalize_text(item.risk_description, 800),
                    "mitigation_strategy": self._normalize_text(item.mitigation_strategy, 800),
                    "status": self._normalize_text(item.risk_status, 40),
                    "risk_category": self._normalize_text(item.risk_category, 60),
                    "risk_likelihood": self._normalize_text(item.risk_likelihood, 40),
                    "risk_impact": self._normalize_text(item.risk_impact, 40),
                }
            )
        return items

    def _normalize_data_requirement(self, item: UseCaseData) -> dict[str, str | None]:
        """Serialize a compact data requirement example for the provider prompt."""
        usage_values = item.data_usage if isinstance(item.data_usage, list) else []
        usage_text = ", ".join(str(value) for value in usage_values if value) or None
        governance_flags = ", ".join(
            flag
            for flag, enabled in (
                ("lineage", bool(getattr(item, "data_lineage_available", False))),
                ("quality_assessed", bool(getattr(item, "data_quality_assessed", False))),
                ("freshness_confirmed", bool(getattr(item, "data_freshness_confirmed", False))),
            )
            if enabled
        ) or None
        return {
            "data_req": self._normalize_text(item.data_req, 240),
            "data_source": self._normalize_text(item.data_source, 120),
            "volume": self._normalize_text(item.volume, 80),
            "data_classification": self._normalize_text(getattr(item, "data_classification", None), 80),
            "data_owner": self._normalize_text(getattr(item, "data_owner", None), 120),
            "data_usage": self._normalize_text(usage_text, 120),
            "dataset_type": self._normalize_text(getattr(item, "dataset_type", None), 40),
            "is_pii_phi_involved": "yes" if getattr(item, "is_pii_phi_involved", False) else "no",
            "governance_flags": governance_flags,
        }

    def _normalize_reference_link(self, item: UseCaseLink) -> dict[str, str | None]:
        """Serialize reference links without sending full URLs upstream when not needed."""
        host = None
        try:
            host = urlparse(item.url or "").netloc or None
        except Exception:
            host = None
        return {
            "label": self._normalize_text(item.label, 160),
            "host": self._normalize_text(host, 160),
        }

    def _normalize_document(self, item: UseCaseDocument) -> dict[str, str | bool | None]:
        """Serialize a compact summary of an attached document."""
        file_name = self._normalize_text(item.file_name, 240)
        return {
            "file_name": file_name,
            "content_type": self._normalize_text(item.content_type, 120),
            "is_infographic": bool(str(file_name or "").upper().startswith("INFOGRAPHIC__")),
            "document_type": self._normalize_text(getattr(item, "document_type", None), 80),
        }

    def _is_meaningful_data_requirement(self, item: UseCaseData) -> bool:
        """Check whether a data requirement contains meaningful structured information."""
        usage_values = item.data_usage if isinstance(getattr(item, "data_usage", None), list) else []
        return any(
            (
                self._has_meaningful_text(item.data_req, minimum_length=8),
                self._has_meaningful_text(item.data_source),
                self._has_meaningful_text(item.volume),
                self._has_meaningful_text(getattr(item, "data_classification", None)),
                self._has_meaningful_text(getattr(item, "data_owner", None)),
                len(usage_values) > 0,
                bool(getattr(item, "dataset_type", None)),
            )
        )

    def _is_generic_title(self, title: str) -> bool:
        """Detect placeholder titles that should not earn a high quality score."""
        normalized = self._compare_normalized_text(title)
        if normalized in _GENERIC_TITLE_VALUES:
            return True
        return bool(
            normalized.startswith("test")
            and all(part.isdigit() or part in {"test", "case", "usecase"} for part in normalized.split())
        )

    def _compare_normalized_text(self, value: str) -> str:
        """Normalize text for equality checks used by the scoring rubric."""
        return " ".join(str(value or "").lower().split())

    def _normalize_text(self, value: str | None, max_length: int) -> str | None:
        """Trim and collapse whitespace while keeping the prompt bounded."""
        if value is None:
            return None
        normalized = " ".join(str(value).split())
        if not normalized:
            return None
        return normalized[:max_length]

    def _has_meaningful_text(self, value: str | None, *, minimum_length: int = 3) -> bool:
        """Treat non-empty, minimally informative text as meaningful content."""
        normalized = self._normalize_text(value, 500) or ""
        return len(normalized) >= minimum_length

    def _dedupe_text_list(self, items: list[str], *, max_items: int = 5) -> list[str]:
        """Keep concise unique text items in their original order."""
        result: list[str] = []
        seen: set[str] = set()
        for item in items:
            normalized = " ".join(str(item or "").split()).strip()
            if not normalized:
                continue
            key = normalized.rstrip(".").lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(normalized[:240])
            if len(result) >= max_items:
                break
        return result


usecase_documentation_quality_service = UseCaseDocumentationQualityService()
