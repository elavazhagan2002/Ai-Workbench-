"""
Schemas for AI-powered text enhancement endpoints.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.field_limits import (
    AI_ENHANCEMENT_FIELD_LIMITS,
    AI_ENHANCEMENT_MIN_INPUT_LENGTH,
    EXPECTED_BENEFITS_MAX_LENGTH,
    INTENDED_USE_MAX_LENGTH,
    USE_CASE_DESCRIPTION_MAX_LENGTH,
)

AIEnhancementFieldName = Literal[
    "description",
    "intended_use",
    "expected_benefits",
    "solution_design_overview",
    "risk_description",
    "mitigation_strategy",
]


class UseCaseFieldEnhancementContext(BaseModel):
    """Optional lightweight context to improve rewrite quality without sending full records upstream."""

    model_config = ConfigDict(extra="ignore")

    use_case_name: str | None = Field(default=None, max_length=150)
    title: str | None = Field(default=None, max_length=150)
    domain: str | None = Field(default=None, max_length=100)
    department: str | None = Field(default=None, max_length=100)
    related_fields: dict[str, str] | None = None

    @field_validator("use_case_name", "title", "domain", "department", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        """Strip whitespace and drop empty context values."""
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value

    @field_validator("related_fields", mode="before")
    @classmethod
    def normalize_related_fields(cls, value):
        """Keep only a small set of compact related fields to avoid oversharing context upstream."""
        if value in (None, ""):
            return None
        if not isinstance(value, dict):
            raise ValueError("context.related_fields must be an object of string values.")

        normalized: dict[str, str] = {}
        for raw_key, raw_value in value.items():
            key = str(raw_key).strip()
            text_value = str(raw_value).strip() if raw_value is not None else ""
            if not key or not text_value:
                continue
            normalized[key[:60]] = text_value[:500]
            if len(normalized) >= 5:
                break

        return normalized or None


class EnhanceUseCaseFieldRequest(BaseModel):
    """Request body for use case field enhancement."""

    field_name: AIEnhancementFieldName
    text: str = Field(..., max_length=10000)
    max_length: int | None = Field(default=None, ge=1, le=max(AI_ENHANCEMENT_FIELD_LIMITS.values()))
    context: UseCaseFieldEnhancementContext | None = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        """Reject empty or too-short source text after trimming."""
        normalized = value.strip()
        if not normalized:
            raise ValueError("text must not be empty.")
        if len(normalized) < AI_ENHANCEMENT_MIN_INPUT_LENGTH:
            raise ValueError(
                f"text must be at least {AI_ENHANCEMENT_MIN_INPUT_LENGTH} characters long for enhancement."
            )
        return normalized


class EnhanceUseCaseFieldResponse(BaseModel):
    """Response payload containing the suggested rewrite only."""

    field_name: AIEnhancementFieldName
    original_text: str
    enhanced_text: str
    char_count: int
    within_limit: bool


class DocumentationQualitySectionScore(BaseModel):
    """Score payload for a single rubric section."""

    score: int = Field(..., ge=0)
    max_score: int = Field(..., ge=1)
    reason: str = Field(..., min_length=1, max_length=1000)

    @model_validator(mode="after")
    def validate_score_range(self):
        """Ensure section scores never exceed their configured maximum."""
        if self.score > self.max_score:
            raise ValueError("score cannot exceed max_score.")
        return self


class DocumentationQualitySectionScores(BaseModel):
    """Top-level grouped section scores for the documentation analysis report."""

    effective_title: DocumentationQualitySectionScore
    use_case_explanation: DocumentationQualitySectionScore
    design_specification: DocumentationQualitySectionScore
    risks_logged: DocumentationQualitySectionScore
    data_requirements: DocumentationQualitySectionScore
    references: DocumentationQualitySectionScore
    comments: DocumentationQualitySectionScore


class DocumentationQualitySummary(BaseModel):
    """Lightweight saved analysis summary for card and preview display."""

    overall_score: int = Field(..., ge=0, le=100)
    strengths_count: int = Field(..., ge=0)
    improvements_count: int = Field(..., ge=0)
    status_label: str = Field(..., min_length=1, max_length=40)
    analyzed_at: datetime
    is_stale: bool = False


class UseCaseDocumentationQualityDetail(BaseModel):
    """Detailed documentation quality analysis payload."""

    use_case_id: str
    overall_score: int = Field(..., ge=0, le=100)
    section_scores: DocumentationQualitySectionScores
    strengths: list[str] = Field(default_factory=list, max_length=5)
    improvement_suggestions: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("strengths", "improvement_suggestions", mode="before")
    @classmethod
    def normalize_reason_list(cls, value):
        """Normalize list-based text output from the provider."""
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("Expected a list of strings.")
        normalized: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if not text:
                continue
            normalized.append(" ".join(text.split())[:240])
        return normalized[:5]


class UseCaseDocumentationQualityResponse(UseCaseDocumentationQualityDetail):
    """Admin-only documentation quality analysis response for a full use case."""

    documentation_quality_summary: DocumentationQualitySummary


class DocumentationQualityLLMSection(BaseModel):
    """Validated qualitative section returned by the provider."""

    score: int = Field(..., ge=0)
    reason: str = Field(..., min_length=1, max_length=800)


class DocumentationQualityLLMResponse(BaseModel):
    """Validated JSON payload expected from the provider for qualitative scoring only."""

    effective_title: DocumentationQualityLLMSection
    use_case_explanation: DocumentationQualityLLMSection
    design_specification: DocumentationQualityLLMSection
    risks_quality: DocumentationQualityLLMSection
    strengths: list[str] = Field(default_factory=list)
    improvement_suggestions: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_section_maximums(self):
        """Keep qualitative scores inside the rubric limits used by the service."""
        max_scores = {
            "effective_title": 10,
            "use_case_explanation": 30,
            "design_specification": 20,
            "risks_quality": 12,
        }
        for field_name, max_score in max_scores.items():
            section = getattr(self, field_name)
            if section.score > max_score:
                raise ValueError(f"{field_name}.score cannot exceed {max_score}.")
        return self


class DraftUseCaseQualityRequest(BaseModel):
    """Draft fields for create-time quality scoring (no saved use case required)."""

    title: str = Field(..., min_length=1, max_length=100)
    department: str = Field(..., min_length=1, max_length=30)
    description: str = Field(..., min_length=1, max_length=USE_CASE_DESCRIPTION_MAX_LENGTH)
    expected_benefits: str = Field(..., min_length=1, max_length=EXPECTED_BENEFITS_MAX_LENGTH)
    intended_use: str | None = Field(default=None, max_length=INTENDED_USE_MAX_LENGTH)

    @field_validator("title", "department", "description", "expected_benefits")
    @classmethod
    def require_non_blank(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("This field is required.")
        return normalized


class DraftFieldQuality(BaseModel):
    field_name: str
    score: int = Field(..., ge=0, le=100)
    feedback: str


class DraftUseCaseQualityResponse(BaseModel):
    overall_score: int = Field(..., ge=0, le=100)
    status_label: str
    fields: list[DraftFieldQuality]
    improvement_suggestions: list[str] = Field(default_factory=list)
