"""
Provider adapters for env-driven LLM integrations.
"""
from __future__ import annotations

import http.client
import json
import re
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

_RETRY_AFTER_IN_DETAIL = re.compile(r"try again in\s+([0-9]+(?:\.[0-9]+)?)\s*s", re.IGNORECASE)
_MAX_RATE_LIMIT_WAIT_SECONDS = 20.0
_EMPTY_CONTENT_RETRY_TOKENS = 2048
_JSON_OBJECT_FAMILIES = frozenset({"openai_compatible", "azure_openai"})


def parse_retry_after_seconds(detail: str | None, headers: Any = None) -> float | None:
    """Parse Retry-After header or Groq-style 'try again in N s' text."""
    if headers is not None:
        raw = headers.get("Retry-After") if hasattr(headers, "get") else None
        if raw not in (None, ""):
            try:
                seconds = float(str(raw).strip())
                if seconds > 0:
                    return seconds
            except (TypeError, ValueError):
                pass
    if not detail:
        return None
    match = _RETRY_AFTER_IN_DETAIL.search(detail)
    if not match:
        return None
    try:
        seconds = float(match.group(1))
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def rate_limit_user_message(detail: str | None = None) -> str:
    seconds = parse_retry_after_seconds(detail)
    if seconds:
        wait = max(1, int(round(min(seconds, _MAX_RATE_LIMIT_WAIT_SECONDS))))
        return (
            f"The AI provider is temporarily rate limited. "
            f"Please wait about {wait} seconds and try AI Pre-fill again."
        )
    return "The AI provider is temporarily rate limited. Please wait a moment and try AI Pre-fill again."


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
    use_max_completion_tokens: bool = False,
    include_temperature: bool | None = None,
) -> dict[str, Any]:
    """Build a chat payload that respects reasoning-model / Azure parameter constraints."""
    is_reasoning = _is_reasoning_model(model)
    use_completion_tokens = is_reasoning or use_max_completion_tokens
    # Reasoning models reject custom temperature. Some Azure deployments only allow default (1).
    if include_temperature is None:
        include_temperature = not is_reasoning and not use_max_completion_tokens

    if use_completion_tokens:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_completion_tokens": reasoning_completion_token_budget(model, max_tokens),
        }
        if include_temperature:
            payload["temperature"] = temperature
        # Groq gpt-oss spends the completion budget on hidden reasoning first.
        if "gpt-oss" in model.strip().lower():
            payload["reasoning_effort"] = "low"
        return payload

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if include_temperature:
        payload["temperature"] = temperature
    return payload


def _payload_without_unsupported_params(payload: dict[str, Any], detail: str) -> dict[str, Any] | None:
    """Return a repaired payload when the provider rejects temperature/max_tokens parameters."""
    lowered = (detail or "").lower()
    repaired = dict(payload)
    changed = False

    if "max_tokens" in lowered and "max_completion_tokens" in lowered and "max_tokens" in repaired:
        repaired["max_completion_tokens"] = repaired.pop("max_tokens")
        changed = True

    if "temperature" in lowered and "temperature" in repaired:
        repaired.pop("temperature", None)
        changed = True

    if "response_format" in repaired and (
        "response_format" in lowered or "json_object" in lowered or "json_schema" in lowered
    ):
        repaired.pop("response_format", None)
        changed = True

    return repaired if changed else None


def _text_from_content_parts(content: Any) -> str:
    """Flatten chat-message content that may be a string or typed part list."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        for key in ("text", "output_text", "content", "value"):
            nested = content.get(key)
            if isinstance(nested, str) and nested.strip():
                return nested
        return ""
    if not isinstance(content, list):
        return str(content or "")

    text_parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            if item.strip():
                text_parts.append(item)
            continue
        if not isinstance(item, dict):
            item_type = getattr(item, "type", None)
            item_text = getattr(item, "text", None)
            if item_type in ("text", "output_text") and item_text:
                text_parts.append(str(item_text))
            continue
        part_type = str(item.get("type") or "")
        if part_type in ("text", "output_text") or item.get("text"):
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                text_parts.append(text)
                continue
            if text:
                nested = _text_from_content_parts(text)
                if nested.strip():
                    text_parts.append(nested)
                continue
        if part_type == "refusal":
            refusal = item.get("refusal") or item.get("text")
            if isinstance(refusal, str) and refusal.strip():
                text_parts.append(refusal)
            continue
        output_text = item.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            text_parts.append(output_text)
    return "".join(text_parts)


def extract_openai_compatible_text(response: Any) -> str:
    """Extract assistant text from OpenAI-compatible / Azure chat completions."""
    if isinstance(response, dict):
        choices = response.get("choices") or []
    else:
        choices = getattr(response, "choices", None) or []
    if not choices:
        return ""

    for first_choice in choices:
        if isinstance(first_choice, dict):
            message = first_choice.get("message") or {}
            finish_text = first_choice.get("text")
        else:
            message = getattr(first_choice, "message", None) or {}
            finish_text = getattr(first_choice, "text", None)
            if not isinstance(message, dict):
                message = {
                    "content": getattr(message, "content", ""),
                    "refusal": getattr(message, "refusal", None),
                    "parsed": getattr(message, "parsed", None),
                    "tool_calls": getattr(message, "tool_calls", None),
                    "reasoning": getattr(message, "reasoning", None),
                    "reasoning_content": getattr(message, "reasoning_content", None),
                }

        if not isinstance(message, dict):
            message = {}

        extracted = _text_from_content_parts(message.get("content"))
        if extracted.strip():
            return extracted

        if isinstance(finish_text, str) and finish_text.strip():
            return finish_text

        refusal = message.get("refusal")
        if isinstance(refusal, str) and refusal.strip():
            return refusal

        parsed = message.get("parsed")
        if isinstance(parsed, (dict, list)):
            return json.dumps(parsed, ensure_ascii=False)
        if isinstance(parsed, str) and parsed.strip():
            return parsed

        for key in ("reasoning", "reasoning_content"):
            extra = message.get(key)
            if isinstance(extra, str) and extra.strip():
                return extra

        tool_calls = message.get("tool_calls") or []
        if isinstance(tool_calls, list):
            for call in tool_calls:
                function = call.get("function") if isinstance(call, dict) else getattr(call, "function", None)
                if isinstance(function, dict):
                    arguments = function.get("arguments")
                else:
                    arguments = getattr(function, "arguments", None) if function else None
                if isinstance(arguments, str) and arguments.strip():
                    return arguments
                if isinstance(arguments, (dict, list)):
                    return json.dumps(arguments, ensure_ascii=False)

    return ""


def openai_choice_finish_reason(response: Any) -> str | None:
    """Return the first choice finish_reason when present."""
    if isinstance(response, dict):
        choices = response.get("choices") or []
        first = choices[0] if choices else None
        if isinstance(first, dict):
            reason = first.get("finish_reason")
            return str(reason) if reason else None
        return None
    choices = getattr(response, "choices", None) or []
    first = choices[0] if choices else None
    reason = getattr(first, "finish_reason", None) if first is not None else None
    return str(reason) if reason else None



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
        json_mode: bool = False,
        timeout_seconds: float | None = None,
    ) -> str:
        """Send one provider request and return cleaned text output."""
        request_url, headers, payload = self.build_request(
            messages,
            temperature=temperature,
            max_tokens=reasoning_completion_token_budget(self.model, max_tokens),
        )
        if json_mode and self._supports_json_object_response_format():
            payload = {**payload, "response_format": {"type": "json_object"}}
        timeout = float(
            timeout_seconds if timeout_seconds is not None else self.runtime_config.timeout_seconds
        )

        response = self._request_json_with_param_repair(
            request_url=request_url,
            headers=headers,
            payload=payload,
            timeout_seconds=timeout,
        )
        text = clean_model_output(self.extract_text(response))
        if text:
            return text

        finish_reason = openai_choice_finish_reason(response)
        self._log_provider_failure(
            event_name="llm_empty_content",
            detail=f"empty content finish_reason={finish_reason or 'n/a'}",
        )
        if (finish_reason or "").lower() == "content_filter":
            raise LLMProviderHTTPError(
                self.provider_name,
                400,
                "The AI provider blocked the response due to a content filter.",
            )

        retry_payload = self._payload_for_empty_content_retry(payload)
        self._log_retry(reason="empty_content", attempt=1, detail=finish_reason)
        response = self._request_json_with_param_repair(
            request_url=request_url,
            headers=headers,
            payload=retry_payload,
            timeout_seconds=timeout,
        )
        return clean_model_output(self.extract_text(response))

    def _supports_json_object_response_format(self) -> bool:
        family = getattr(self.runtime_config, "provider_family", "") or ""
        return family in _JSON_OBJECT_FAMILIES

    def _payload_for_empty_content_retry(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Bump output budget and request JSON when the first reply had no text."""
        retry_payload = dict(payload)
        if "max_completion_tokens" in retry_payload:
            retry_payload["max_completion_tokens"] = max(
                int(retry_payload.get("max_completion_tokens") or 0),
                _EMPTY_CONTENT_RETRY_TOKENS,
            )
        elif "max_tokens" in retry_payload:
            retry_payload["max_tokens"] = max(
                int(retry_payload.get("max_tokens") or 0),
                _EMPTY_CONTENT_RETRY_TOKENS,
            )
        generation_config = retry_payload.get("generationConfig")
        if isinstance(generation_config, dict) and "maxOutputTokens" in generation_config:
            retry_payload["generationConfig"] = {
                **generation_config,
                "maxOutputTokens": max(
                    int(generation_config.get("maxOutputTokens") or 0),
                    _EMPTY_CONTENT_RETRY_TOKENS,
                ),
            }
        if self._supports_json_object_response_format() and "response_format" not in retry_payload:
            retry_payload["response_format"] = {"type": "json_object"}
        return retry_payload

    def _request_json_with_param_repair(
        self,
        *,
        request_url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        timeout_seconds: float | None = None,
    ) -> Any:
        """POST once, then retry if the provider rejects unsupported chat parameters."""
        try:
            return self._request_json(
                request_url=request_url,
                headers=headers,
                payload=payload,
                timeout_seconds=timeout_seconds,
            )
        except LLMProviderHTTPError as exc:
            if exc.status_code != 400:
                raise
            repaired = _payload_without_unsupported_params(payload, exc.detail)
            if not repaired:
                raise
            self._log_retry(
                reason="unsupported_parameter",
                attempt=1,
                status_code=exc.status_code,
                detail=exc.detail,
            )
            return self._request_json(
                request_url=request_url,
                headers=headers,
                payload=repaired,
                timeout_seconds=timeout_seconds,
            )

    def _request_json(
        self,
        *,
        request_url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        timeout_seconds: float | None = None,
    ) -> Any:
        """Send a JSON POST request with limited retries for transient failures."""
        request_body = json.dumps(payload).encode("utf-8")
        merged_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": self.user_agent,
            **headers,
        }
        timeout = float(
            timeout_seconds if timeout_seconds is not None else self.runtime_config.timeout_seconds
        )

        extra_rate_limit_retries = 1
        for attempt in range(self.runtime_config.max_retries + 1 + extra_rate_limit_retries):
            try:
                http_request = request.Request(
                    request_url,
                    data=request_body,
                    headers=merged_headers,
                    method="POST",
                )
                with open_http_request(http_request, timeout=timeout) as response:
                    raw_body = response.read().decode("utf-8")
                return json.loads(raw_body or "{}")
            except error.HTTPError as exc:
                detail = self._extract_error_detail(exc)
                self._log_provider_failure(
                    event_name="llm_provider_http_error",
                    status_code=exc.code,
                    detail=detail,
                )
                if self._should_retry_status(exc.code, attempt):
                    wait_seconds = self._retry_wait_seconds(
                        status_code=exc.code,
                        detail=detail,
                        headers=getattr(exc, "headers", None),
                    )
                    self._log_retry(
                        reason="http_status",
                        attempt=attempt + 1,
                        status_code=exc.code,
                        detail=detail,
                        wait_seconds=wait_seconds,
                    )
                    self._sleep_before_retry(wait_seconds)
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
                        self._sleep_before_retry(self.runtime_config.retry_backoff_seconds)
                        continue
                    raise LLMProviderTimeoutError(self.provider_name) from exc

                self._log_provider_failure(
                    event_name="llm_provider_connection_error",
                    detail="The AI provider is currently unavailable.",
                )
                if attempt < self.runtime_config.max_retries:
                    self._log_retry(reason="connection_error", attempt=attempt + 1)
                    self._sleep_before_retry(self.runtime_config.retry_backoff_seconds)
                    continue
                raise LLMProviderConnectionError(self.provider_name) from exc
            except TimeoutError as exc:
                self._log_provider_failure(
                    event_name="llm_provider_timeout",
                    detail="The AI provider timed out.",
                )
                if attempt < self.runtime_config.max_retries:
                    self._log_retry(reason="timeout", attempt=attempt + 1)
                    self._sleep_before_retry(self.runtime_config.retry_backoff_seconds)
                    continue
                raise LLMProviderTimeoutError(self.provider_name) from exc
            except (ConnectionError, http.client.IncompleteRead) as exc:
                self._log_provider_failure(
                    event_name="llm_provider_connection_error",
                    detail="The AI provider closed the connection before returning a response.",
                )
                if attempt < self.runtime_config.max_retries:
                    self._log_retry(reason="connection_drop", attempt=attempt + 1)
                    self._sleep_before_retry(self.runtime_config.retry_backoff_seconds)
                    continue
                raise LLMProviderConnectionError(self.provider_name) from exc
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

    def _should_retry_status(self, status_code: int, attempt: int) -> bool:
        if not self._is_retryable_status(status_code):
            return False
        extra = 1 if status_code == 429 else 0
        return attempt < self.runtime_config.max_retries + extra

    def _retry_wait_seconds(
        self,
        *,
        status_code: int,
        detail: str | None = None,
        headers: Any = None,
    ) -> float:
        configured = max(0.0, float(self.runtime_config.retry_backoff_seconds or 0))
        if status_code != 429:
            return configured
        parsed = parse_retry_after_seconds(detail, headers)
        wait = parsed if parsed is not None else max(configured, 8.0)
        return min(max(wait, configured), _MAX_RATE_LIMIT_WAIT_SECONDS)

    def _sleep_before_retry(self, wait_seconds: float) -> None:
        """Apply a bounded backoff between retry attempts."""
        if wait_seconds > 0:
            time.sleep(wait_seconds)

    def _log_retry(
        self,
        *,
        reason: str,
        attempt: int,
        status_code: int | None = None,
        detail: str | None = None,
        wait_seconds: float | None = None,
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
            wait_seconds if wait_seconds is not None else self.runtime_config.retry_backoff_seconds,
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
        organization = getattr(self.runtime_config, "openai_organization", None)
        if organization:
            headers["OpenAI-Organization"] = str(organization)
        payload = _build_openai_chat_payload(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return f"{self.base_url}/chat/completions", headers, payload

    def extract_text(self, response: Any) -> str:
        return extract_openai_compatible_text(response)


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
        # Newer Azure chat models reject max_tokens and often reject non-default temperature.
        payload = _build_openai_chat_payload(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            use_max_completion_tokens=True,
            include_temperature=False,
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
