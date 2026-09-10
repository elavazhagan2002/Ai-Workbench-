"""
Reusable service for AI-enhanced suggestions on use case text fields.
"""
from __future__ import annotations

from app.core.config import settings
from app.core.field_limits import AI_ENHANCEMENT_FIELD_LIMITS
from app.core.logging_config import logger
from app.schemas.ai_assist import (
    EnhanceUseCaseFieldRequest,
    EnhanceUseCaseFieldResponse,
    UseCaseFieldEnhancementContext,
)
from app.services.llm import (
    LLMConfigurationError,
    LLMGateway,
    LLMProviderConnectionError,
    LLMProviderHTTPError,
    LLMProviderTimeoutError,
    llm_gateway,
)
from app.services.llm.adapters import _is_reasoning_model

FIELD_PROMPT_GUIDANCE = {
    "description": (
        "Improve clarity, grammar, structure, and business context without changing the user's meaning."
    ),
    "intended_use": (
        "Rewrite as a clear, practical description of how the use case will be applied in day-to-day operations. "
        "Focus on workflows, users, and usage scenarios supported by the source text. Do not invent new use cases."
    ),
    "expected_benefits": (
        "Rewrite as concise, professional business benefits and outcomes using measurable language only when "
        "the source already supports it. Do not invent metrics."
    ),
    "solution_design_overview": (
        "Rewrite as a clear, structured, high-level technical solution overview. Mention architecture, data flow, "
        "integrations, and controls only when they are present in the source."
    ),
    "risk_description": (
        "Rewrite as a clear risk statement covering the issue, likely cause, and impact when the source contains "
        "that information. Do not invent missing facts."
    ),
    "mitigation_strategy": (
        "Rewrite as a practical mitigation plan with preventive and corrective actions when supported by the "
        "source text. Do not fabricate controls or remediation steps."
    ),
}


class AIFieldEnhancementServiceError(Exception):
    """Controlled application error raised by the AI enhancement service."""

    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class AIFieldEnhancementService:
    """Stateless service that requests rewrite suggestions from the configured provider abstraction."""

    def __init__(self, app_settings=settings) -> None:
        self.settings = app_settings
        self.llm_gateway = llm_gateway if app_settings is settings else LLMGateway(app_settings)

    def get_provider_debug_info(self) -> dict[str, object]:
        """Return safe runtime diagnostics for the configured provider."""
        return self.llm_gateway.get_provider_debug_info()

    def log_startup_diagnostics(self) -> None:
        """Emit one structured startup log line for the active LLM settings."""
        self.llm_gateway.log_startup_diagnostics()

    def run_provider_connectivity_test(self) -> dict[str, object]:
        """Run a minimal provider connectivity check without sending user content upstream."""
        return self.llm_gateway.run_provider_connectivity_test()

    def enhance_usecase_field(self, payload: EnhanceUseCaseFieldRequest) -> EnhanceUseCaseFieldResponse:
        """Enhance the provided field text and return a suggestion within the supported limit."""
        self._ensure_provider_is_available()

        field_limit = AI_ENHANCEMENT_FIELD_LIMITS[payload.field_name]
        effective_limit = min(payload.max_length or field_limit, field_limit)

        enhanced_text = self._generate_text(
            payload=payload,
            effective_limit=effective_limit,
            shorter_retry=False,
        )
        if len(enhanced_text) > effective_limit:
            logger.info(
                "event=ai_enhancement_length_retry field_name=%s provider=%s model=%s output_length=%s limit=%s",
                payload.field_name,
                self._get_provider_name(),
                self.settings.LLM_MODEL,
                len(enhanced_text),
                effective_limit,
            )
            enhanced_text = self._generate_text(
                payload=payload,
                effective_limit=effective_limit,
                shorter_retry=True,
            )

        if len(enhanced_text) > effective_limit:
            raise AIFieldEnhancementServiceError(
                "The AI provider returned text that exceeded the allowed field length. Please shorten the source text and try again.",
                502,
            )

        return EnhanceUseCaseFieldResponse(
            field_name=payload.field_name,
            original_text=payload.text,
            enhanced_text=enhanced_text,
            char_count=len(enhanced_text),
            within_limit=len(enhanced_text) <= effective_limit,
        )

    def _ensure_provider_is_available(self) -> None:
        """Fail clearly when AI enhancement is disabled or misconfigured."""
        try:
            self.llm_gateway.ensure_provider_is_available()
        except LLMConfigurationError as exc:
            raise AIFieldEnhancementServiceError(exc.detail, 503) from exc

    def _generate_text(
        self,
        *,
        payload: EnhanceUseCaseFieldRequest,
        effective_limit: int,
        shorter_retry: bool,
    ) -> str:
        """Call the provider gateway and return the cleaned text output."""
        messages = self._build_messages(payload, effective_limit, shorter_retry=shorter_retry)
        provider_name = self._get_provider_name()

        try:
            content = self.llm_gateway.generate_text(
                messages=messages,
                max_tokens=self._estimate_max_tokens(effective_limit),
            )
        except LLMProviderTimeoutError as exc:
            raise AIFieldEnhancementServiceError(
                f"{provider_name} timed out while generating the suggestion. Please try again.",
                504,
            ) from exc
        except LLMProviderConnectionError as exc:
            raise AIFieldEnhancementServiceError(
                f"{provider_name} is currently unavailable. Please try again later.",
                503,
            ) from exc
        except LLMProviderHTTPError as exc:
            if exc.status_code in (408, 409, 429) or exc.status_code >= 500:
                raise AIFieldEnhancementServiceError(
                    f"{provider_name} failed to complete the request. Please try again later.",
                    503,
                ) from exc
            raise AIFieldEnhancementServiceError(
                self.llm_gateway.build_provider_rejection_message(exc),
                502,
            ) from exc
        except LLMConfigurationError as exc:
            raise AIFieldEnhancementServiceError(exc.detail, 503) from exc
        except Exception as exc:
            logger.error(
                "event=ai_enhancement_unexpected_error provider=%s model=%s base_url=%s detail=%s",
                provider_name,
                self.settings.LLM_MODEL or "missing",
                self.settings.LLM_BASE_URL or "missing",
                str(exc),
                exc_info=True,
            )
            raise AIFieldEnhancementServiceError(
                "Unexpected error while generating the AI suggestion.",
                500,
            ) from exc

        if not content:
            raise AIFieldEnhancementServiceError(
                f"{provider_name} returned an empty suggestion.",
                502,
            )
        return content

    def _get_provider_name(self) -> str:
        """Return a friendly provider label for user-facing errors."""
        diagnostics = self.get_provider_debug_info()
        return str(diagnostics.get("provider") or "LLM provider")

    def _build_messages(
        self,
        payload: EnhanceUseCaseFieldRequest,
        effective_limit: int,
        *,
        shorter_retry: bool,
    ) -> list[dict[str, str]]:
        """Build a deterministic, field-specific prompt with minimal context."""
        field_guidance = FIELD_PROMPT_GUIDANCE[payload.field_name]
        context_block = self._build_context_block(payload.context)
        shorter_retry_instruction = ""
        if shorter_retry:
            shorter_retry_instruction = (
                "\nAdditional requirement: your previous answer was too long. Rewrite it again so the final text "
                f"is safely under {effective_limit} characters."
            )

        system_message = (
            "You are an enterprise writing assistant for AI Governance Workbench. "
            "Rewrite the user's field text without changing meaning. "
            "Do not invent facts, systems, metrics, owners, causes, impacts, controls, or outcomes. "
            "Keep the tone professional and concise. "
            f"Return only the improved field text, with no headings, bullets, labels, markdown, or quotation marks. "
            f"The response must not exceed {effective_limit} characters."
        )

        user_message = (
            f"Field name: {payload.field_name}\n"
            f"Field guidance: {field_guidance}\n"
            "Requirements:\n"
            "- Preserve the user's meaning.\n"
            "- Improve readability, grammar, and structure.\n"
            "- Use only the details explicitly present in the source text or optional context.\n"
            f"- Keep the final answer within {effective_limit} characters."
            f"{shorter_retry_instruction}\n"
            f"{context_block}"
            "Source text:\n"
            f"{payload.text}"
        )

        return [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message},
        ]

    def _build_context_block(self, context: UseCaseFieldEnhancementContext | None) -> str:
        """Serialize only a compact subset of optional context fields."""
        if not context:
            return ""

        lines = []
        if context.use_case_name:
            lines.append(f"- Use case name: {context.use_case_name}")
        if context.title:
            lines.append(f"- Title: {context.title}")
        if context.domain:
            lines.append(f"- Domain: {context.domain}")
        if context.department:
            lines.append(f"- Department: {context.department}")
        if context.related_fields:
            for name, value in context.related_fields.items():
                lines.append(f"- Related field ({name}): {value}")

        if not lines:
            return ""
        return "Optional context:\n" + "\n".join(lines) + "\n"

    def _estimate_max_tokens(self, effective_limit: int) -> int:
        """Use a conservative token budget to encourage concise outputs."""
        estimated_tokens = (effective_limit // 4) + 64
        bounded_estimate = max(96, min(800, estimated_tokens))
        configured_cap = getattr(self.settings, "LLM_MAX_TOKENS", bounded_estimate) or bounded_estimate
        budget = min(int(configured_cap), bounded_estimate)
        if _is_reasoning_model(getattr(self.settings, "LLM_MODEL", None)):
            # gpt-oss and similar models spend this budget on hidden reasoning first.
            return max(budget, 2048)
        return budget

    def score_draft_usecase(self, payload) -> "DraftUseCaseQualityResponse":
        """Score draft registration fields with deterministic heuristics (no persist)."""
        from app.schemas.ai_assist import DraftFieldQuality, DraftUseCaseQualityResponse

        def _score_text(text: str, *, min_good: int, label: str) -> DraftFieldQuality:
            length = len(text.strip())
            if length < 20:
                score = max(20, min(45, length * 2))
                feedback = f"{label} is too short. Add more specific detail."
            elif length < min_good:
                score = 55 + min(25, (length - 20) // 2)
                feedback = f"{label} is acceptable but could be more specific."
            else:
                score = min(95, 75 + (length - min_good) // 20)
                feedback = f"{label} looks sufficiently detailed."
            return DraftFieldQuality(field_name=label, score=score, feedback=feedback)

        fields = [
            _score_text(payload.title, min_good=25, label="Title"),
            DraftFieldQuality(
                field_name="Department",
                score=90 if payload.department.strip() else 0,
                feedback="Department is set." if payload.department.strip() else "Department is required.",
            ),
            _score_text(payload.description, min_good=120, label="Description"),
            _score_text(payload.expected_benefits, min_good=80, label="Expected Benefits"),
        ]
        if payload.intended_use and payload.intended_use.strip():
            fields.append(_score_text(payload.intended_use, min_good=60, label="Intended Use (COU)"))

        overall = int(sum(f.score for f in fields) / len(fields))
        if overall >= 80:
            status_label = "Strong"
        elif overall >= 60:
            status_label = "Good"
        elif overall >= 40:
            status_label = "Needs improvement"
        else:
            status_label = "Weak"

        suggestions: list[str] = []
        for field in fields:
            if field.score < 70:
                suggestions.append(field.feedback)
        if not suggestions:
            suggestions.append("Entry quality looks solid. You can still use Rewrite to polish wording.")

        # Optionally enrich suggestions via LLM when configured
        try:
            self._ensure_provider_is_available()
            messages = [
                {
                    "role": "system",
                    "content": (
                        "You are an enterprise AI governance writing coach. "
                        "Given draft use case fields, return 2-4 short improvement tips as a plain bullet list. "
                        "Do not rewrite the full fields. Keep each tip under 120 characters."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Title: {payload.title}\n"
                        f"Department: {payload.department}\n"
                        f"Description: {payload.description}\n"
                        f"Expected benefits: {payload.expected_benefits}\n"
                        f"Intended use: {payload.intended_use or '(not provided)'}\n"
                        f"Current overall score: {overall}"
                    ),
                },
            ]
            tip_text = self.llm_gateway.generate_text(messages=messages, max_tokens=300)
            if tip_text:
                llm_tips = [
                    line.lstrip("-•* ").strip()
                    for line in tip_text.splitlines()
                    if line.strip() and not line.strip().startswith("#")
                ]
                if llm_tips:
                    suggestions = llm_tips[:4]
        except Exception:
            # Deterministic score is enough when AI is unavailable
            pass

        return DraftUseCaseQualityResponse(
            overall_score=overall,
            status_label=status_label,
            fields=fields,
            improvement_suggestions=suggestions,
        )


ai_field_enhancement_service = AIFieldEnhancementService()
