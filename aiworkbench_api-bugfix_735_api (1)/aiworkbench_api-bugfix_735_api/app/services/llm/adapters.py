"""
Provider adapters for env-driven LLM integrations.
"""
from __future__ import annotations

import json
import socket
import time
from abc import ABC, abstractmethod
from typing import Any
from urllib import error, parse, request

from app.core.logging_config import logger
from app.services.llm.models import (
    DEFAULT_LLM_USER_AGENT,
    LLMProviderConnectionError,
    LLMProviderHTTPError,
    LLMProviderTimeoutError,
    LLMRuntimeConfig,
    build_api_key_fingerprint,
    sanitize_provider_detail,
)
from app.utils.safe_http import open_http_request


def clean_model_output(content: str) -> str:
    """Trim common wrapper artifacts while preserving the model output."""
    cleaned = str(content or "").strip()
    if cleaned.startswith("```") and cleaned.endswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(lines[1:-1]).strip() if len(lines) >= 3 else cleaned.strip("`").strip()

    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {'"', "'"}:
        cleaned = cleaned[1:-1].strip()
    return cleaned


def _split_system_messages(messages: list[dict[str, str]]) -> tuple[str | None, list[dict[str, str]]]:
    """Separate system messages from conversational messages for providers that need it."""
    system_parts: list[str] = []
    conversational: list[dict[str, str]] = []
    for item in messages:
        role = str(item.get("role") or "user").strip()
        content = str(item.get("content") or "")
        if role == "system":
            if content.strip():
                system_parts.append(content.strip())
            continue
        conversational.append({"role": role, "content": content})
    system_message = "\n\n".join(system_parts).strip() or None
    return system_message, conversational


def _is_reasoning_model(model_name: str | None) -> bool:
    """Identify model families that require reasoning-model chat payload rules."""
    normalized = str(model_name or "").strip().lower()
    if not normalized:
        return False
    reasoning_prefixes = (
        "o1",
        "o3",
        "o4",
        "gpt-5",
    )
    if any(normalized.startswith(prefix) for prefix in reasoning_prefixes):
        return True
    reasoning_markers = (
        "gpt-oss",
        "deepseek-r1",
        "qwq",
        "groq/compound",
    )
    return any(marker in normalized for marker in reasoning_markers)


def reasoning_completion_token_budget(model_name: str | None, requested_max_tokens: int) -> int:
    """Ensure reasoning models keep enough tokens after hidden chain-of-thought."""
    requested = max(1, int(requested_max_tokens or 0))
    if not _is_reasoning_model(model_name):
        return requested
    return max(requested, 2048)


def _build_openai_chat_payload(
    *,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> dict[str, Any]:
    """Build a chat payload that respects reasoning-model parameter constraints."""
    if _is_reasoning_model(model):
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_completion_tokens": reasoning_completion_token_budget(model, max_tokens),
        }
        # Groq gpt-oss spends the completion budget on hidden reasoning first.
        # Low effort leaves room for visible content on short rewrite tasks.
        if "gpt-oss" in model.strip().lower():
            payload["reasoning_effort"] = "low"
        return payload

    return {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


class BaseLLMAdapter(ABC):
    """Base provider adapter with shared HTTP retry/error handling."""

    def __init__(self, runtime_config: LLMRuntimeConfig) -> None:
        self.runtime_config = runtime_config
        self.provider_name = runtime_config.provider_label
        self.base_url = (runtime_config.base_url or "").rstrip("/")
        self.model = runtime_config.model or "unconfigured"
        self.user_agent = DEFAULT_LLM_USER_AGENT
        self.key_fingerprint = build_api_key_fingerprint(runtime_config.api_key)

    @abstractmethod
    def build_request(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, dict[str, str], dict[str, Any]]:
        """Return URL, headers, and payload for the provider request."""

    @abstractmethod
    def extract_text(self, response: Any) -> str:
        """Extract text content from the provider response body."""

    def generate_text(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Send one provider request and return cleaned text output."""
        request_url, headers, payload = self.build_request(
            messages,
            temperature=temperature,
            max_tokens=reasoning_completion_token_budget(self.model, max_tokens),
        )
        response = self._request_json(request_url=request_url, headers=headers, payload=payload)
        return clean_model_output(self.extract_text(response))

    def _request_json(
        self,
        *,
        request_url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> Any:
        """Send a JSON POST request with limited retries for transient failures."""
        request_body = json.dumps(payload).encode("utf-8")
        merged_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": self.user_agent,
            **headers,
        }

        for attempt in range(self.runtime_config.max_retries + 1):
            try:
                http_request = request.Request(
                    request_url,
                    data=request_body,
                    headers=merged_headers,
                    method="POST",
                )
                with open_http_request(http_request, timeout=self.runtime_config.timeout_seconds) as response:
                    raw_body = response.read().decode("utf-8")
                return json.loads(raw_body or "{}")
            except error.HTTPError as exc:
                detail = self._extract_error_detail(exc)
                self._log_provider_failure(
                    event_name="llm_provider_http_error",
                    status_code=exc.code,
                    detail=detail,
                )
                if self._is_retryable_status(exc.code) and attempt < self.runtime_config.max_retries:
                    self._log_retry(
                        reason="http_status",
                        attempt=attempt + 1,
                        status_code=exc.code,
                        detail=detail,
                    )
                    self._sleep_before_retry()
                    continue
                raise LLMProviderHTTPError(self.provider_name, exc.code, detail) from exc
            except error.URLError as exc:
                if self._is_timeout_reason(exc.reason):
                    self._log_provider_failure(
                        event_name="llm_provider_timeout",
                        detail="The AI provider timed out.",
                    )
                    if attempt < self.runtime_config.max_retries:
                        self._log_retry(reason="timeout", attempt=attempt + 1)
                        self._sleep_before_retry()
                        continue
                    raise LLMProviderTimeoutError(self.provider_name) from exc

                self._log_provider_failure(
                    event_name="llm_provider_connection_error",
                    detail="The AI provider is currently unavailable.",
                )
                if attempt < self.runtime_config.max_retries:
                    self._log_retry(reason="connection_error", attempt=attempt + 1)
                    self._sleep_before_retry()
                    continue
                raise LLMProviderConnectionError(self.provider_name) from exc
            except TimeoutError as exc:
                self._log_provider_failure(
                    event_name="llm_provider_timeout",
                    detail="The AI provider timed out.",
                )
                if attempt < self.runtime_config.max_retries:
                    self._log_retry(reason="timeout", attempt=attempt + 1)
                    self._sleep_before_retry()
                    continue
                raise LLMProviderTimeoutError(self.provider_name) from exc
            except json.JSONDecodeError as exc:
                self._log_provider_failure(
                    event_name="llm_provider_invalid_json",
                    status_code=502,
                    detail="The AI provider returned an invalid JSON response.",
                )
                raise LLMProviderHTTPError(
                    self.provider_name,
                    502,
                    "The AI provider returned an invalid JSON response.",
                ) from exc

        raise LLMProviderConnectionError(self.provider_name)

    def _sleep_before_retry(self) -> None:
        """Apply a bounded fixed backoff between retry attempts."""
        if self.runtime_config.retry_backoff_seconds > 0:
            time.sleep(self.runtime_config.retry_backoff_seconds)

    def _log_retry(
        self,
        *,
        reason: str,
        attempt: int,
        status_code: int | None = None,
        detail: str | None = None,
    ) -> None:
        """Log retry attempts with safe provider diagnostics."""
        logger.warning(
            "event=llm_provider_retry provider=%s model=%s base_url=%s api_key_fingerprint=%s "
            "reason=%s status_code=%s attempt=%s max_retries=%s retry_backoff_seconds=%s detail=%s",
            self.provider_name,
            self.model,
            self.base_url or "missing",
            self.key_fingerprint,
            reason,
            status_code if status_code is not None else "n/a",
            attempt,
            self.runtime_config.max_retries,
            self.runtime_config.retry_backoff_seconds,
            sanitize_provider_detail(detail) or "n/a",
        )

    def _log_provider_failure(
        self,
        *,
        event_name: str,
        detail: str,
        status_code: int | None = None,
    ) -> None:
        """Log provider failures without leaking user content or raw secrets."""
        logger.warning(
            "event=%s provider=%s model=%s base_url=%s api_key_fingerprint=%s status_code=%s detail=%s",
            event_name,
            self.provider_name,
            self.model,
            self.base_url or "missing",
            self.key_fingerprint,
            status_code if status_code is not None else "n/a",
            sanitize_provider_detail(detail) or "n/a",
        )

    def _extract_error_detail(self, exc: error.HTTPError) -> str:
        """Parse the upstream error response without exposing secrets."""
        try:
            raw_body = exc.read().decode("utf-8")
        except Exception:
            raw_body = ""

        if raw_body:
            try:
                payload = json.loads(raw_body)
            except json.JSONDecodeError:
                cleaned_body = sanitize_provider_detail(raw_body)
                if cleaned_body:
                    return cleaned_body
                return f"{self.provider_name} returned HTTP {exc.code}."

            nested_detail = self._extract_text_detail(payload)
            if nested_detail:
                return nested_detail

        return f"{self.provider_name} returned HTTP {exc.code}."

    def _extract_text_detail(self, payload: Any) -> str | None:
        """Extract the most useful human-readable error detail from a provider payload."""
        if not isinstance(payload, dict):
            return None
        error_payload = payload.get("error")
        if isinstance(error_payload, dict):
            nested_detail = self._extract_text_detail(error_payload)
            if nested_detail:
                return nested_detail
        elif isinstance(error_payload, str) and error_payload.strip():
            return sanitize_provider_detail(error_payload)

        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return sanitize_provider_detail(message)

        detail = payload.get("detail")
        title = payload.get("title")
        if isinstance(detail, str) and detail.strip():
            if isinstance(title, str) and title.strip() and title.strip() != detail.strip():
                return sanitize_provider_detail(f"{title.strip()}. {detail.strip()}")
            return sanitize_provider_detail(detail)
        if isinstance(title, str) and title.strip():
            return sanitize_provider_detail(title)
        return None

    def _is_retryable_status(self, status_code: int) -> bool:
        """Retry only transient upstream HTTP failures."""
        return status_code in (408, 409, 429) or status_code >= 500

    def _is_timeout_reason(self, reason: object) -> bool:
        """Detect timeout-like URLError reasons."""
        return isinstance(reason, (TimeoutError, socket.timeout))


class OpenAICompatibleAdapter(BaseLLMAdapter):
    """Adapter for Bearer-auth OpenAI-compatible chat completion APIs."""

    def build_request(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, dict[str, str], dict[str, Any]]:
        headers = {
            "Authorization": f"Bearer {self.runtime_config.api_key or ''}",
        }
        payload = _build_openai_chat_payload(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return f"{self.base_url}/chat/completions", headers, payload

    def extract_text(self, response: Any) -> str:
        if isinstance(response, dict):
            choices = response.get("choices") or []
        else:
            choices = getattr(response, "choices", None) or []
        if not choices:
            return ""

        first_choice = choices[0]
        if isinstance(first_choice, dict):
            message = first_choice.get("message") or {}
            content = message.get("content", "")
        else:
            message = getattr(first_choice, "message", None)
            content = getattr(message, "content", "") if message else ""
            message = message or {}

        if isinstance(content, list):
            text_parts = []
            for item in content:
                if isinstance(item, str):
                    text_parts.append(item)
                    continue
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        text_parts.append(str(item.get("text", "")))
                    continue
                if getattr(item, "type", None) == "text":
                    text_parts.append(getattr(item, "text", ""))
            extracted = "".join(text_parts)
        else:
            extracted = str(content or "")

        if extracted.strip():
            return extracted

        # Some Groq/OpenAI reasoning payloads leave content empty and put text elsewhere.
        if isinstance(message, dict):
            for key in ("reasoning", "reasoning_content"):
                extra = message.get(key)
                if isinstance(extra, str) and extra.strip():
                    return extra
        return ""


class AzureOpenAIAdapter(OpenAICompatibleAdapter):
    """Adapter for Azure OpenAI chat completions."""

    def build_request(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, dict[str, str], dict[str, Any]]:
        deployment = self.runtime_config.azure_deployment or self.model
        api_version = self.runtime_config.azure_api_version or "2024-02-01"
        base_path = self.base_url
        if not base_path.endswith("/openai"):
            base_path = f"{base_path}/openai"
        query = parse.urlencode({"api-version": api_version})
        url = f"{base_path}/deployments/{deployment}/chat/completions?{query}"
        headers = {"api-key": self.runtime_config.api_key or ""}
        payload = _build_openai_chat_payload(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        payload.pop("model", None)
        return url, headers, payload


class AnthropicAdapter(BaseLLMAdapter):
    """Adapter for Anthropic Messages API."""

    def build_request(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, dict[str, str], dict[str, Any]]:
        system_message, anthropic_messages = _split_system_messages(messages)
        headers = {
            "x-api-key": self.runtime_config.api_key or "",
            "anthropic-version": self.runtime_config.anthropic_version or "2023-06-01",
        }
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": anthropic_messages,
        }
        if system_message:
            payload["system"] = system_message
        return f"{self.base_url}/messages", headers, payload

    def extract_text(self, response: Any) -> str:
        content = response.get("content") if isinstance(response, dict) else None
        if not isinstance(content, list):
            return ""
        text_parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                text_parts.append(str(item.get("text", "")))
        return "".join(text_parts)


class GeminiAdapter(BaseLLMAdapter):
    """Adapter for Gemini generateContent API."""

    def build_request(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, dict[str, str], dict[str, Any]]:
        system_message, conversational = _split_system_messages(messages)
        api_version = self.runtime_config.gemini_api_version or "v1beta"
        base_path = self.base_url
        if not base_path.endswith(f"/{api_version}"):
            base_path = f"{base_path}/{api_version}"

        contents = []
        for item in conversational:
            role = "model" if item["role"] == "assistant" else "user"
            contents.append(
                {
                    "role": role,
                    "parts": [{"text": item["content"]}],
                }
            )

        payload: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        if system_message:
            payload["system_instruction"] = {"parts": [{"text": system_message}]}

        query = parse.urlencode({"key": self.runtime_config.api_key or ""})
        url = f"{base_path}/models/{self.model}:generateContent?{query}"
        return url, {}, payload

    def extract_text(self, response: Any) -> str:
        if not isinstance(response, dict):
            return ""
        candidates = response.get("candidates") or []
        if not candidates:
            return ""
        first_candidate = candidates[0]
        if not isinstance(first_candidate, dict):
            return ""
        content = first_candidate.get("content") or {}
        parts = content.get("parts") or []
        text_parts: list[str] = []
        for item in parts:
            if isinstance(item, dict) and item.get("text"):
                text_parts.append(str(item.get("text", "")))
        return "".join(text_parts)


class OllamaAdapter(BaseLLMAdapter):
    """Adapter for Ollama native chat API."""

    def build_request(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, dict[str, str], dict[str, Any]]:
        headers: dict[str, str] = {}
        if self.runtime_config.api_key:
            headers["Authorization"] = f"Bearer {self.runtime_config.api_key}"
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        return f"{self.base_url}/api/chat", headers, payload

    def extract_text(self, response: Any) -> str:
        if not isinstance(response, dict):
            return ""
        message = response.get("message") or {}
        if isinstance(message, dict) and message.get("content"):
            return str(message.get("content", ""))
        if response.get("response"):
            return str(response.get("response", ""))
        return ""
