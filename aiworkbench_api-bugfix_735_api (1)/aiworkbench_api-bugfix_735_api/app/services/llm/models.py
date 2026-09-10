"""
Central models, configuration normalization, and exceptions for LLM providers.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

DEFAULT_LLM_USER_AGENT = "AI-Governance-Workbench-API/1.0"
_PROVIDER_DETAIL_MAX_LENGTH = 300

_OPENAI_COMPATIBLE_PROVIDERS = {
    "openai_compatible",
    "openai",
    "groq",
    "openrouter",
    "together",
    "xai",
    "grok",
    "local_openai",
}
_PROVIDER_ALIASES = {
    "compat": "openai_compatible",
    "generic": "openai_compatible",
    "generic_openai": "openai_compatible",
    "openai-compatible": "openai_compatible",
    "openai_compatible": "openai_compatible",
    "azure": "azure_openai",
    "azure_openai": "azure_openai",
    "anthropic": "anthropic",
    "gemini": "gemini",
    "ollama": "ollama",
    "openai": "openai",
    "groq": "groq",
    "openrouter": "openrouter",
    "together": "together",
    "xai": "xai",
    "grok": "grok",
    "local": "local_openai",
    "local_openai": "local_openai",
}
_SUPPORTED_PROVIDERS = set(_PROVIDER_ALIASES.values())


def build_api_key_fingerprint(api_key: str | None) -> str:
    """Return a masked key fingerprint that helps confirm which credential is loaded."""
    normalized = (api_key or "").strip()
    if not normalized:
        return "missing"

    digest_prefix = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    if len(normalized) >= 8:
        return f"{normalized[:4]}...{normalized[-4:]} (sha256:{digest_prefix})"
    return f"sha256:{digest_prefix}"


def sanitize_provider_detail(detail: str | None) -> str | None:
    """Normalize provider error text for safe display and logging."""
    if not detail:
        return None
    cleaned = " ".join(str(detail).split())
    if not cleaned:
        return None
    return cleaned[:_PROVIDER_DETAIL_MAX_LENGTH]


def infer_provider_from_base_url(base_url: str | None) -> str:
    """Infer a provider identifier from a configured base URL when possible."""
    normalized = (base_url or "").strip().lower()
    if not normalized:
        return "openai_compatible"
    if "groq.com" in normalized:
        return "groq"
    if "openai.com" in normalized:
        return "openai"
    if "openrouter.ai" in normalized:
        return "openrouter"
    if "together.xyz" in normalized:
        return "together"
    if "x.ai" in normalized:
        return "xai"
    if "anthropic.com" in normalized:
        return "anthropic"
    if "googleapis.com" in normalized or "generativelanguage" in normalized:
        return "gemini"
    if "ollama" in normalized or "11434" in normalized:
        return "ollama"
    return "openai_compatible"


def normalize_provider_identifier(provider: str | None, base_url: str | None) -> str:
    """Return a supported normalized provider identifier."""
    normalized = (provider or "").strip().lower().replace(" ", "_")
    if normalized:
        resolved = _PROVIDER_ALIASES.get(normalized)
        if resolved:
            return resolved
        return normalized
    return infer_provider_from_base_url(base_url)


def provider_family_for(provider: str) -> str:
    """Collapse provider aliases into a small number of adapter families."""
    if provider in _OPENAI_COMPATIBLE_PROVIDERS:
        return "openai_compatible"
    return provider


def get_provider_label(provider: str, base_url: str | None = None) -> str:
    """Return a human-readable provider label for logs and user-facing errors."""
    labels = {
        "openai_compatible": "OpenAI-compatible provider",
        "openai": "OpenAI",
        "groq": "Groq",
        "openrouter": "OpenRouter",
        "together": "Together",
        "xai": "Grok",
        "grok": "Grok",
        "local_openai": "Local OpenAI-compatible provider",
        "azure_openai": "Azure OpenAI",
        "anthropic": "Anthropic",
        "gemini": "Gemini",
        "ollama": "Ollama",
    }
    label = labels.get(provider)
    if label:
        return label
    if base_url:
        host = urlparse(base_url).netloc or ""
        if host:
            return host
    return "LLM provider"


@dataclass(frozen=True)
class LLMRuntimeConfig:
    """Resolved runtime configuration for the active LLM provider."""

    enabled: bool
    configured_provider: str | None
    provider: str
    provider_family: str
    provider_label: str
    api_key: str | None
    model: str | None
    base_url: str | None
    timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float
    temperature: float
    max_tokens: int
    startup_self_test_enabled: bool
    azure_api_version: str | None = None
    azure_deployment: str | None = None
    anthropic_version: str | None = None
    gemini_api_version: str | None = None

    @classmethod
    def from_settings(cls, settings: Any) -> LLMRuntimeConfig:
        configured_provider = (getattr(settings, "LLM_PROVIDER", None) or "").strip() or None
        provider = normalize_provider_identifier(configured_provider, getattr(settings, "LLM_BASE_URL", None))
        family = provider_family_for(provider)
        return cls(
            enabled=bool(getattr(settings, "LLM_ENABLED", False)),
            configured_provider=configured_provider,
            provider=provider,
            provider_family=family,
            provider_label=get_provider_label(provider, getattr(settings, "LLM_BASE_URL", None)),
            api_key=getattr(settings, "LLM_API_KEY", None),
            model=getattr(settings, "LLM_MODEL", None),
            base_url=getattr(settings, "LLM_BASE_URL", None),
            timeout_seconds=float(getattr(settings, "LLM_TIMEOUT_SECONDS", 20.0)),
            max_retries=int(getattr(settings, "LLM_MAX_RETRIES", 1)),
            retry_backoff_seconds=float(getattr(settings, "LLM_RETRY_BACKOFF_SECONDS", 0.5)),
            temperature=float(getattr(settings, "LLM_TEMPERATURE", 0.1)),
            max_tokens=int(getattr(settings, "LLM_MAX_TOKENS", 1100)),
            startup_self_test_enabled=bool(getattr(settings, "LLM_STARTUP_SELF_TEST_ENABLED", False)),
            azure_api_version=getattr(settings, "LLM_AZURE_API_VERSION", None),
            azure_deployment=getattr(settings, "LLM_AZURE_DEPLOYMENT", None),
            anthropic_version=getattr(settings, "LLM_ANTHROPIC_VERSION", None),
            gemini_api_version=getattr(settings, "LLM_GEMINI_API_VERSION", None),
        )

    def missing_required_fields(self) -> list[str]:
        """List required settings that are missing for the resolved provider."""
        if not self.enabled:
            return []

        missing: list[str] = []
        if self.provider not in _SUPPORTED_PROVIDERS:
            missing.append("LLM_PROVIDER")
        if not self.model:
            missing.append("LLM_MODEL")
        if not self.base_url:
            missing.append("LLM_BASE_URL")
        if self.provider_family != "ollama" and not self.api_key:
            missing.append("LLM_API_KEY")
        if self.provider_family == "azure_openai" and not (self.azure_deployment or self.model):
            missing.append("LLM_AZURE_DEPLOYMENT")
        return missing

    def diagnostics(self) -> dict[str, Any]:
        """Return safe diagnostics for operator debugging."""
        return {
            "enabled": self.enabled,
            "configured_provider": self.configured_provider or "auto",
            "provider": self.provider_label,
            "provider_id": self.provider,
            "provider_family": self.provider_family,
            "base_url": self.base_url,
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "timeout_seconds": self.timeout_seconds,
            "max_retries": self.max_retries,
            "retry_backoff_seconds": self.retry_backoff_seconds,
            "api_key_fingerprint": build_api_key_fingerprint(self.api_key),
        }


class LLMConfigurationError(Exception):
    """Raised when the runtime LLM configuration is incomplete or unsupported."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class LLMProviderTimeoutError(Exception):
    """Raised when the upstream provider times out."""

    def __init__(self, provider_name: str, detail: str = "The AI provider timed out.") -> None:
        super().__init__(detail)
        self.provider_name = provider_name
        self.detail = detail


class LLMProviderConnectionError(Exception):
    """Raised when the upstream provider cannot be reached."""

    def __init__(
        self,
        provider_name: str,
        detail: str = "The AI provider is currently unavailable.",
    ) -> None:
        super().__init__(detail)
        self.provider_name = provider_name
        self.detail = detail


class LLMProviderHTTPError(Exception):
    """Raised for non-success upstream HTTP responses."""

    def __init__(self, provider_name: str, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.provider_name = provider_name
        self.status_code = status_code
        self.detail = detail


class LLMStructuredOutputError(Exception):
    """Raised when the provider returns invalid structured JSON output."""

    def __init__(self, provider_name: str, detail: str) -> None:
        super().__init__(detail)
        self.provider_name = provider_name
        self.detail = detail
