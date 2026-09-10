"""
Central gateway and factory for env-driven LLM providers.
"""
from __future__ import annotations

import json
from typing import Any, TypeVar

from pydantic import BaseModel

from app.core.config import settings
from app.core.logging_config import logger
from app.services.llm.adapters import (
    AnthropicAdapter,
    AzureOpenAIAdapter,
    GeminiAdapter,
    OllamaAdapter,
    OpenAICompatibleAdapter,
)
from app.services.llm.models import (
    LLMConfigurationError,
    LLMProviderConnectionError,
    LLMProviderHTTPError,
    LLMProviderTimeoutError,
    LLMRuntimeConfig,
    LLMStructuredOutputError,
    sanitize_provider_detail,
)

StructuredModelT = TypeVar("StructuredModelT", bound=BaseModel)
_SUPPORTED_PROVIDER_IDS = (
    "openai_compatible",
    "openai",
    "groq",
    "openrouter",
    "together",
    "xai",
    "grok",
    "local_openai",
    "azure_openai",
    "anthropic",
    "gemini",
    "ollama",
)


def extract_json_payload(raw_text: str) -> Any:
    """Parse JSON from model output, even if wrapped with minor extra text."""
    cleaned = str(raw_text or "").strip()
    if not cleaned:
        raise json.JSONDecodeError("Empty content", cleaned, 0)

    candidates = [cleaned]
    first_object_start = cleaned.find("{")
    last_object_end = cleaned.rfind("}")
    if first_object_start != -1 and last_object_end != -1 and last_object_end > first_object_start:
        candidates.append(cleaned[first_object_start : last_object_end + 1])
    first_array_start = cleaned.find("[")
    last_array_end = cleaned.rfind("]")
    if first_array_start != -1 and last_array_end != -1 and last_array_end > first_array_start:
        candidates.append(cleaned[first_array_start : last_array_end + 1])

    decoder = json.JSONDecoder()
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        for index, char in enumerate(candidate):
            if char not in "[{":
                continue
            try:
                value, _ = decoder.raw_decode(candidate[index:])
                return value
            except json.JSONDecodeError:
                continue

    raise json.JSONDecodeError("Unable to decode JSON content.", cleaned, 0)


class LLMGateway:
    """Unified provider abstraction for text and structured JSON generation."""

    def __init__(self, app_settings=settings) -> None:
        self.settings = app_settings

    def _get_runtime_config(self) -> LLMRuntimeConfig:
        return LLMRuntimeConfig.from_settings(self.settings)

    def _build_adapter(self, runtime_config: LLMRuntimeConfig):
        family = runtime_config.provider_family
        if family == "openai_compatible":
            return OpenAICompatibleAdapter(runtime_config)
        if family == "azure_openai":
            return AzureOpenAIAdapter(runtime_config)
        if family == "anthropic":
            return AnthropicAdapter(runtime_config)
        if family == "gemini":
            return GeminiAdapter(runtime_config)
        if family == "ollama":
            return OllamaAdapter(runtime_config)
        raise LLMConfigurationError(
            f"Unsupported LLM provider '{runtime_config.configured_provider or runtime_config.provider}'. "
            f"Supported values: {', '.join(_SUPPORTED_PROVIDER_IDS)}."
        )

    def get_provider_debug_info(self) -> dict[str, Any]:
        """Return safe runtime diagnostics for the configured provider."""
        return self._get_runtime_config().diagnostics()

    def log_startup_diagnostics(self) -> None:
        """Emit one structured startup log line for the active LLM settings."""
        diagnostics = self.get_provider_debug_info()
        logger.info(
            "event=llm_provider_startup enabled=%s configured_provider=%s provider=%s provider_family=%s "
            "base_url=%s model=%s temperature=%s max_tokens=%s timeout_seconds=%s max_retries=%s "
            "retry_backoff_seconds=%s api_key_fingerprint=%s",
            diagnostics["enabled"],
            diagnostics["configured_provider"],
            diagnostics["provider"],
            diagnostics["provider_family"],
            diagnostics["base_url"] or "missing",
            diagnostics["model"] or "missing",
            diagnostics["temperature"],
            diagnostics["max_tokens"],
            diagnostics["timeout_seconds"],
            diagnostics["max_retries"],
            diagnostics["retry_backoff_seconds"],
            diagnostics["api_key_fingerprint"],
        )

    def ensure_provider_is_available(self) -> None:
        """Fail clearly when AI is disabled, incomplete, or unsupported."""
        runtime_config = self._get_runtime_config()
        if not runtime_config.enabled:
            raise LLMConfigurationError("AI enhancement is currently disabled.")

        if runtime_config.provider not in _SUPPORTED_PROVIDER_IDS:
            raise LLMConfigurationError(
                f"Unsupported LLM provider '{runtime_config.configured_provider or runtime_config.provider}'. "
                f"Supported values: {', '.join(_SUPPORTED_PROVIDER_IDS)}."
            )

        missing = runtime_config.missing_required_fields()
        if missing:
            raise LLMConfigurationError(
                "AI enhancement is not configured. Missing required environment variables: "
                + ", ".join(missing)
                + "."
            )

    def run_provider_connectivity_test(self) -> dict[str, Any]:
        """Run a minimal provider connectivity check without sending user content upstream."""
        diagnostics = self.get_provider_debug_info()
        provider_name = diagnostics["provider"]

        runtime_config = self._get_runtime_config()
        if not runtime_config.enabled:
            return {
                **diagnostics,
                "status": "disabled",
                "detail": "AI enhancement is currently disabled.",
            }
        if runtime_config.provider not in _SUPPORTED_PROVIDER_IDS:
            return {
                **diagnostics,
                "status": "unsupported_provider",
                "detail": (
                    f"Unsupported LLM provider '{runtime_config.configured_provider or runtime_config.provider}'. "
                    f"Supported values: {', '.join(_SUPPORTED_PROVIDER_IDS)}."
                ),
            }

        missing = runtime_config.missing_required_fields()
        if missing:
            return {
                **diagnostics,
                "status": "configuration_error",
                "detail": "AI enhancement is not configured. Missing required settings: "
                + ", ".join(missing)
                + ".",
            }

        try:
            self.generate_text(
                messages=[
                    {"role": "system", "content": "You are a provider connectivity checker. Reply with OK."},
                    {"role": "user", "content": "OK"},
                ],
                temperature=0,
                max_tokens=min(16, runtime_config.max_tokens),
            )
        except LLMProviderTimeoutError:
            return {
                **diagnostics,
                "status": "timeout",
                "detail": f"{provider_name} timed out during the connectivity test.",
            }
        except LLMProviderConnectionError:
            return {
                **diagnostics,
                "status": "connection_error",
                "detail": f"{provider_name} could not be reached during the connectivity test.",
            }
        except LLMProviderHTTPError as exc:
            if exc.status_code == 401:
                return {
                    **diagnostics,
                    "status": "auth_failure",
                    "http_status": exc.status_code,
                    "detail": self.build_provider_rejection_message(exc),
                }
            if exc.status_code == 403:
                return {
                    **diagnostics,
                    "status": "permission_failure",
                    "http_status": exc.status_code,
                    "detail": self.build_provider_rejection_message(exc),
                }
            if self.is_invalid_model_http_error(exc):
                return {
                    **diagnostics,
                    "status": "invalid_model",
                    "http_status": exc.status_code,
                    "detail": self.build_provider_rejection_message(exc),
                }
            return {
                **diagnostics,
                "status": "provider_http_error",
                "http_status": exc.status_code,
                "detail": self.build_provider_rejection_message(exc),
            }
        except LLMConfigurationError as exc:
            return {
                **diagnostics,
                "status": "configuration_error",
                "detail": exc.detail,
            }

        return {
            **diagnostics,
            "status": "ok",
            "detail": f"{provider_name} connectivity test succeeded.",
        }

    def generate_text(
        self,
        *,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Generate plain text using the active provider adapter."""
        self.ensure_provider_is_available()
        runtime_config = self._get_runtime_config()
        adapter = self._build_adapter(runtime_config)
        resolved_temperature = runtime_config.temperature if temperature is None else float(temperature)
        resolved_max_tokens = runtime_config.max_tokens if max_tokens is None else int(max_tokens)
        return adapter.generate_text(
            messages,
            temperature=resolved_temperature,
            max_tokens=resolved_max_tokens,
        )

    def generate_structured_json(
        self,
        *,
        messages: list[dict[str, str]],
        schema_model: type[StructuredModelT],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> StructuredModelT:
        """Generate structured JSON text and validate it with the provided schema."""
        runtime_config = self._get_runtime_config()
        content = self.generate_text(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not content:
            raise LLMStructuredOutputError(
                runtime_config.provider_label,
                f"{runtime_config.provider_label} returned an empty structured response.",
            )
        try:
            payload = extract_json_payload(content)
            return schema_model.model_validate(payload)
        except LLMStructuredOutputError:
            raise
        except Exception as exc:
            raise LLMStructuredOutputError(
                runtime_config.provider_label,
                f"{runtime_config.provider_label} returned invalid structured JSON output. "
                f"Provider detail: {sanitize_provider_detail(str(exc)) or 'n/a'}",
            ) from exc

    def build_provider_rejection_message(self, exc: LLMProviderHTTPError) -> str:
        """Create clear user-facing provider rejection messages for common auth/model issues."""
        generic_detail = sanitize_provider_detail(exc.detail)
        default_http_detail = f"{exc.provider_name} returned HTTP {exc.status_code}."
        if generic_detail == default_http_detail:
            generic_detail = None
        if exc.status_code == 401:
            return self._append_provider_detail(
                f"{exc.provider_name} rejected the request with HTTP 401. Verify the configured API key.",
                generic_detail,
            )
        if exc.status_code == 403:
            return self._append_provider_detail(
                f"{exc.provider_name} rejected the request with HTTP 403. This can happen because the API key is "
                "invalid or stale, the configured model is not permitted for this key or project, or the "
                "account or project permissions do not allow the request.",
                generic_detail,
            )
        if self.is_invalid_model_http_error(exc):
            return self._append_provider_detail(
                f"{exc.provider_name} could not find the configured model or endpoint. Verify LLM_MODEL and LLM_BASE_URL.",
                generic_detail,
            )
        if generic_detail:
            return f"{exc.provider_name} rejected the request: {generic_detail}"
        return f"{exc.provider_name} rejected the request with HTTP {exc.status_code}."

    def is_invalid_model_http_error(self, exc: LLMProviderHTTPError) -> bool:
        """Detect provider errors that likely indicate an invalid model or endpoint."""
        if exc.status_code == 404:
            return True
        if exc.status_code != 400:
            return False
        detail = (exc.detail or "").lower()
        if "model" not in detail and "deployment" not in detail:
            return False
        invalid_model_markers = ("not found", "does not exist", "unknown", "invalid")
        return any(marker in detail for marker in invalid_model_markers)

    def _append_provider_detail(self, base_message: str, provider_detail: str | None) -> str:
        """Append safe provider detail to a user-facing message when available."""
        if not provider_detail:
            return base_message
        return f"{base_message} Provider detail: {provider_detail}"


llm_gateway = LLMGateway()
