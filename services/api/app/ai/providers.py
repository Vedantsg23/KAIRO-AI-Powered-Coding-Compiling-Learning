"""Language-model providers for Saarthi.

Two wire formats cover the useful options:

  anthropic  the Claude Messages API (POST /v1/messages). Structured answers
             use a tool the model is required to call, so they arrive as a
             JSON object that matches the tool's input schema.
  openai     any OpenAI-compatible chat-completions server: OpenAI itself, or
             a model running on the school's own machine with Ollama or LM
             Studio (set CC_AI_BASE_URL, e.g. http://localhost:11434/v1).
             Structured answers use JSON mode plus the schema in the prompt.
  gateway    Vercel AI Gateway, which speaks the OpenAI format for many model
             vendors. On Vercel it authenticates with the deployment's OIDC
             token (renewed by the platform), so no key is stored anywhere.
  gemini     Google's Gemini API through its OpenAI-compatible endpoint, with a
             key from Google AI Studio (GEMINI_API_KEY; the free tier needs no
             card).

Free-form answers can also be streamed (stream()), so Saarthi's chat shows
the answer while it is being written, like ChatGPT or Copilot.

Keys are read from the server's environment only and sent only to the
configured provider. Errors never echo the key or the provider's raw body.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Protocol

import httpx

from ..config import ApiSettings

log = logging.getLogger("saarthi")

ANTHROPIC_URL = "https://api.anthropic.com"
ANTHROPIC_VERSION = "2023-06-01"
OPENAI_URL = "https://api.openai.com/v1"
# Claude Haiku 4.5: the fastest and most cost-efficient current Claude model
# (Claude API docs, models overview, September 2026). For deeper answers set
# CC_AI_MODEL=claude-sonnet-5.
DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
GATEWAY_URL = "https://ai-gateway.vercel.sh/v1"
# Gemini 2.5 Flash Lite: fast and inexpensive, and one of the models that AI
# Gateway's free credit covers ($5 every 30 days for a limited set of models;
# the model's AI Gateway page, October 2026), so Saarthi works on a free Vercel
# account. Newer models such as google/gemini-3.5-flash-lite need paid AI
# Gateway credit; choose one with CC_AI_MODEL.
DEFAULT_GATEWAY_MODEL = "google/gemini-2.5-flash-lite"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
# Gemini 3.5 Flash Lite: a stable model on the Gemini API's free tier (Google's
# free-tier model list, October 2026). Override with CC_AI_MODEL.
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
# What students see when AI Gateway refuses the deployment (HTTP 401/403): the
# team has no AI Gateway credit turned on, or the free credit does not cover
# the model. The gateway's own reason goes to the server log.
GATEWAY_REFUSED = ("Saarthi's AI service (Vercel AI Gateway) refused the request. The site owner can turn on "
                   "AI Gateway credit or choose another model in Vercel. The quick notes and fixes still work.")


class ProviderError(Exception):
    """The provider could not answer. `public` is safe to show to students."""

    def __init__(self, public: str, retry_after_s: int | None = None) -> None:
        super().__init__(public)
        self.public = public
        self.retry_after_s = retry_after_s


@dataclass(frozen=True)
class ToolSpec:
    """A structured answer: the JSON object the model must return."""

    name: str
    description: str
    input_schema: dict


@dataclass
class Completion:
    text: str | None = None   # free-form answer
    data: dict | None = None  # structured answer (tool input / JSON object)
    input_tokens: int | None = None
    output_tokens: int | None = None


class Provider(Protocol):
    name: str
    model: str

    async def complete(self, *, system: str, messages: list[dict], max_tokens: int,
                       tool: ToolSpec | None = None) -> Completion: ...

    def stream(self, *, system: str, messages: list[dict], max_tokens: int) -> AsyncIterator[str]: ...


@dataclass(frozen=True)
class ProviderChoice:
    provider: Provider | None
    reason: str | None  # why there is no provider (shown on the status endpoint)


def choose_provider(settings: ApiSettings, http: httpx.AsyncClient,
                    oidc_token: Callable[[], str | None] | None = None) -> ProviderChoice:
    """The configured provider, or the reason Saarthi is switched off.

    oidc_token returns the deployment's current Vercel OIDC token (gateway only).
    Gemini and AI Gateway back each other up when both are available (a Gemini
    key, and AI Gateway on Vercel or with AI_GATEWAY_API_KEY): when the first one
    cannot answer (busy, out of free quota, refused), the other one does.
    """
    choice = _configured_provider(settings, http, oidc_token)
    backup = _backup_provider(settings, http, oidc_token, choice.provider) if settings.ai_backup else None
    if choice.provider is None or backup is None:
        return choice
    return ProviderChoice(FallbackProvider([choice.provider, backup]), None)


def _gemini_key(settings: ApiSettings) -> str:
    return settings.gemini_api_key.get_secret_value().strip() if settings.gemini_api_key else ""


def _gateway_key(settings: ApiSettings, oidc_token: Callable[[], str | None] | None) -> str | Callable[[], str | None] | None:
    fixed = settings.ai_gateway_api_key.get_secret_value().strip() if settings.ai_gateway_api_key else ""
    return fixed or oidc_token


def _backup_provider(settings: ApiSettings, http: httpx.AsyncClient,
                     oidc_token: Callable[[], str | None] | None, primary: Provider | None) -> Provider | None:
    """The other of Gemini and AI Gateway, with its own key and default model, if it is available."""
    if primary is not None and primary.name == "gemini":
        gateway_key = _gateway_key(settings, oidc_token)
        if gateway_key:
            return OpenAICompatibleProvider(http, gateway_key, DEFAULT_GATEWAY_MODEL, GATEWAY_URL, name="gateway")
    if primary is not None and primary.name == "gateway" and _gemini_key(settings):
        return OpenAICompatibleProvider(http, _gemini_key(settings), DEFAULT_GEMINI_MODEL, GEMINI_URL, name="gemini")
    return None


def _configured_provider(settings: ApiSettings, http: httpx.AsyncClient,
                         oidc_token: Callable[[], str | None] | None) -> ProviderChoice:
    if settings.ai_provider == "none":
        return ProviderChoice(None, "Saarthi is switched off on this server (CC_AI_PROVIDER=none).")
    if settings.ai_provider == "anthropic":
        key = settings.ai_api_key or settings.anthropic_api_key
        if key is None or not key.get_secret_value().strip():
            return ProviderChoice(None, "No Claude API key is set on the server (ANTHROPIC_API_KEY).")
        return ProviderChoice(AnthropicProvider(http, key.get_secret_value().strip(),
                                                settings.ai_model or DEFAULT_ANTHROPIC_MODEL,
                                                settings.ai_base_url or ANTHROPIC_URL), None)
    if settings.ai_provider == "gateway":
        secret = settings.ai_api_key or settings.ai_gateway_api_key
        fixed = secret.get_secret_value().strip() if secret is not None else ""
        if not fixed and oidc_token is None:
            return ProviderChoice(None, "No AI Gateway key is set on the server (AI_GATEWAY_API_KEY).")
        key: str | Callable[[], str | None] = fixed or oidc_token  # type: ignore[assignment]
        return ProviderChoice(OpenAICompatibleProvider(http, key, settings.ai_model or DEFAULT_GATEWAY_MODEL,
                                                       settings.ai_base_url or GATEWAY_URL, name="gateway"), None)
    if settings.ai_provider == "gemini":
        secret = settings.ai_api_key or settings.gemini_api_key
        gemini_key = secret.get_secret_value().strip() if secret is not None else ""
        if not gemini_key:
            return ProviderChoice(None, "No Gemini API key is set on the server (GEMINI_API_KEY).")
        return ProviderChoice(OpenAICompatibleProvider(http, gemini_key, settings.ai_model or DEFAULT_GEMINI_MODEL,
                                                       settings.ai_base_url or GEMINI_URL, name="gemini"), None)
    # OpenAI-compatible
    key = settings.ai_api_key or settings.openai_api_key
    key_value = key.get_secret_value().strip() if key is not None else ""
    base_url = settings.ai_base_url or OPENAI_URL
    if not settings.ai_model:
        return ProviderChoice(None, "Set CC_AI_MODEL to the model name your OpenAI-compatible server offers.")
    if base_url == OPENAI_URL and not key_value:
        return ProviderChoice(None, "No OpenAI API key is set on the server (OPENAI_API_KEY).")
    return ProviderChoice(OpenAICompatibleProvider(http, key_value, settings.ai_model, base_url), None)


def with_model(provider: Provider | None, model: str) -> Provider | None:
    """The same provider and credentials with another model (e.g. a faster one for completions)."""
    if provider is None or not model or model == provider.model:
        return provider
    if isinstance(provider, AnthropicProvider):
        return AnthropicProvider(provider._http, provider._key, model, provider._base_url)
    if isinstance(provider, OpenAICompatibleProvider):
        return OpenAICompatibleProvider(provider._http, provider._key, model, provider._base_url, name=provider.name)
    if isinstance(provider, FallbackProvider):  # the model belongs to the first provider
        return FallbackProvider([with_model(provider.providers[0], model) or provider.providers[0],
                                 *provider.providers[1:]])
    return provider


# Anything in a provider's error text that looks like a key or token (a JWT such
# as the OIDC token, a Google "AIza..." key, or an sk-/vck- style key) is removed
# before it is logged.
_SECRET_LIKE = re.compile(r"eyJ[\w-]{8,}\.[\w-]+\.[\w-]*|\bAIza[\w-]{20,}|\b(?:sk|vck|key)[-_][\w-]{8,}",
                          re.IGNORECASE)


def _error_reason(response: httpx.Response) -> str:
    """The provider's own short reason for a refusal, for the server log only.

    Students never see it (they get the fixed messages below); it is one line,
    at most 240 characters, with anything that looks like a key removed.
    """
    try:
        payload = response.json()
    except ValueError:
        return ""
    if isinstance(payload, list) and payload and isinstance(payload[0], dict):
        payload = payload[0]  # Google's APIs may wrap the error in a list
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        parts = [str(error[k]) for k in ("type", "status", "code", "message") if error.get(k)]
    elif isinstance(error, str):
        parts = [error]
    elif isinstance(payload, dict) and isinstance(payload.get("message"), str):
        parts = [payload["message"]]
    else:
        parts = []
    text = _SECRET_LIKE.sub("[redacted]", " ".join(" | ".join(parts).split()))
    return text[:240]


def _raise_for_status(response: httpx.Response, provider: str) -> None:
    status = response.status_code
    if status < 400:
        return
    retry = response.headers.get("retry-after")
    retry_s = int(float(retry)) if retry and re.fullmatch(r"\d+(?:\.\d+)?", retry) else None
    reason = _error_reason(response)
    log.warning("%s answered HTTP %s%s", provider, status, f": {reason}" if reason else "")
    if status in (401, 403) or (status == 400 and "api key" in reason.lower()):  # Google answers 400 to a bad key
        if provider == "gateway":
            raise ProviderError(GATEWAY_REFUSED)
        raise ProviderError("The AI provider rejected the server's API key. Ask your administrator to check it.")
    if status == 402:
        raise ProviderError("The AI service has no credit left for this site. Ask the site owner to check it. "
                            "The quick notes and fixes still work.")
    if status == 404:
        raise ProviderError("The AI provider does not know the configured model (check CC_AI_MODEL).")
    if status == 429:
        raise ProviderError("The AI provider is rate-limiting this server. Try again in a minute.", retry_s or 30)
    if status in (500, 502, 503, 504, 529):
        raise ProviderError("The AI provider is overloaded or unavailable. Try again shortly.", retry_s or 15)
    raise ProviderError(f"The AI provider refused the request (HTTP {status}).")


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, http: httpx.AsyncClient, key: str, model: str, base_url: str = ANTHROPIC_URL) -> None:
        self._http = http
        self._key = key
        self.model = model
        self._base_url = base_url
        self._url = base_url.rstrip("/") + "/v1/messages"

    async def stream(self, *, system: str, messages: list[dict], max_tokens: int) -> AsyncIterator[str]:
        """The answer's text as it is generated (server-sent events)."""
        body = {"model": self.model, "max_tokens": max_tokens, "system": system, "messages": messages,
                "stream": True}
        headers = {"x-api-key": self._key, "anthropic-version": ANTHROPIC_VERSION,
                   "content-type": "application/json", "accept": "text/event-stream"}
        try:
            async with self._http.stream("POST", self._url, json=body, headers=headers) as response:
                if response.status_code >= 400:
                    await response.aread()
                    _raise_for_status(response, self.name)
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:].strip())
                    except ValueError:
                        continue
                    if event.get("type") == "content_block_delta":
                        delta = event.get("delta") or {}
                        if delta.get("type") == "text_delta" and delta.get("text"):
                            yield delta["text"]
                    elif event.get("type") == "error":
                        raise ProviderError("The AI provider stopped while answering. Try again.")
        except httpx.TimeoutException as exc:
            raise ProviderError("The AI provider took too long to answer. Try again.") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("The server could not reach the AI provider.") from exc

    async def complete(self, *, system: str, messages: list[dict], max_tokens: int,
                       tool: ToolSpec | None = None) -> Completion:
        # No temperature: current Claude models only accept the default.
        body: dict = {"model": self.model, "max_tokens": max_tokens, "system": system, "messages": messages}
        if tool is not None:
            body["tools"] = [{"name": tool.name, "description": tool.description,
                              "input_schema": tool.input_schema}]
            body["tool_choice"] = {"type": "tool", "name": tool.name}
        headers = {"x-api-key": self._key, "anthropic-version": ANTHROPIC_VERSION,
                   "content-type": "application/json"}
        try:
            response = await self._http.post(self._url, json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise ProviderError("The AI provider took too long to answer. Try again.") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("The server could not reach the AI provider.") from exc
        _raise_for_status(response, self.name)
        try:
            payload = response.json()
            blocks = payload.get("content") or []
            usage = payload.get("usage") or {}
        except (ValueError, AttributeError) as exc:
            raise ProviderError("The AI provider sent an answer that could not be read.") from exc
        result = Completion(input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"))
        if tool is not None:
            for block in blocks:
                if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == tool.name:
                    result.data = block.get("input") if isinstance(block.get("input"), dict) else None
                    break
            if result.data is None:
                raise ProviderError("The AI provider did not return a structured answer. Try again.")
        else:
            result.text = "".join(b.get("text", "") for b in blocks
                                  if isinstance(b, dict) and b.get("type") == "text").strip()
        return result


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


class OpenAICompatibleProvider:
    name = "openai"

    def __init__(self, http: httpx.AsyncClient, key: str | Callable[[], str | None], model: str,
                 base_url: str = OPENAI_URL, name: str = "openai") -> None:
        self._http = http
        self._key = key  # a fixed key, or a function returning the current token (Vercel OIDC)
        self.model = model
        self.name = name
        self._base_url = base_url
        self._url = base_url.rstrip("/") + "/chat/completions"

    def _headers(self) -> dict[str, str]:
        key = self._key() if callable(self._key) else self._key
        if callable(self._key) and not key:
            raise ProviderError("Saarthi cannot sign in to the AI service yet. Try again in a moment.")
        headers = {"content-type": "application/json"}
        if key:
            headers["authorization"] = f"Bearer {key}"
        return headers

    async def stream(self, *, system: str, messages: list[dict], max_tokens: int) -> AsyncIterator[str]:
        """The answer's text as it is generated (server-sent events, OpenAI format)."""
        body = {"model": self.model, "max_tokens": max_tokens, "stream": True,
                "messages": [{"role": "system", "content": system}, *messages]}
        headers = {**self._headers(), "accept": "text/event-stream"}
        try:
            async with self._http.stream("POST", self._url, json=body, headers=headers) as response:
                if response.status_code >= 400:
                    await response.aread()
                    _raise_for_status(response, self.name)
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        piece = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content")
                    except (ValueError, AttributeError, IndexError):
                        continue
                    if piece:
                        yield piece
        except httpx.TimeoutException as exc:
            raise ProviderError("The AI server took too long to answer. Try again.") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("The server could not reach the AI server.") from exc

    async def _post(self, body: dict, headers: dict[str, str]) -> httpx.Response:
        try:
            return await self._http.post(self._url, json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise ProviderError("The AI server took too long to answer. Try again.") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("The server could not reach the AI server.") from exc

    async def complete(self, *, system: str, messages: list[dict], max_tokens: int,
                       tool: ToolSpec | None = None) -> Completion:
        if tool is not None:
            system = (f"{system}\n\nReply with only one JSON object (no prose, no code fences) that "
                      f"matches this JSON Schema:\n{json.dumps(tool.input_schema)}")
        body: dict = {"model": self.model, "max_tokens": max_tokens,
                      "messages": [{"role": "system", "content": system}, *messages]}
        if tool is not None:
            body["response_format"] = {"type": "json_object"}
        headers = self._headers()
        response = await self._post(body, headers)
        if (response.status_code == 400 and "response_format" in body
                and "api key" not in _error_reason(response).lower()):
            # Not every OpenAI-compatible server offers JSON mode: ask once more without
            # it (the prompt already asks for one JSON object, and the answer is checked).
            log.info("%s refused JSON mode; asking again without it", self.name)
            body = {k: v for k, v in body.items() if k != "response_format"}
            response = await self._post(body, headers)
        _raise_for_status(response, self.name)
        try:
            payload = response.json()
            text = payload["choices"][0]["message"]["content"] or ""
            usage = payload.get("usage") or {}
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError("The AI server sent an answer that could not be read.") from exc
        result = Completion(input_tokens=usage.get("prompt_tokens"), output_tokens=usage.get("completion_tokens"))
        if tool is None:
            result.text = text.strip()
            return result
        try:
            data = json.loads(_FENCE.sub("", text.strip()))
        except ValueError as exc:
            raise ProviderError("The AI server did not return valid JSON. Try again.") from exc
        if not isinstance(data, dict):
            raise ProviderError("The AI server did not return a JSON object. Try again.")
        result.data = data
        return result


class FallbackProvider:
    """The first provider answers; when it cannot (before writing anything), the next one does.

    Its name and model are the first provider's. When none can answer, students
    see the first provider's error: that is the provider the site is set up with.
    """

    def __init__(self, providers: list[Provider]) -> None:
        self.providers = providers
        self.name = providers[0].name
        self.model = providers[0].model

    async def complete(self, *, system: str, messages: list[dict], max_tokens: int,
                       tool: ToolSpec | None = None) -> Completion:
        first: ProviderError | None = None
        for provider in self.providers:
            try:
                return await provider.complete(system=system, messages=messages, max_tokens=max_tokens, tool=tool)
            except ProviderError as exc:
                first = first or exc
                log.warning("%s could not answer (%s)", provider.name, exc.public)
        assert first is not None
        raise first

    async def stream(self, *, system: str, messages: list[dict], max_tokens: int) -> AsyncIterator[str]:
        first: ProviderError | None = None
        for provider in self.providers:
            wrote = False
            try:
                async for piece in provider.stream(system=system, messages=messages, max_tokens=max_tokens):
                    wrote = True
                    yield piece
                return
            except ProviderError as exc:
                if wrote:
                    raise  # another model cannot finish half of this one's answer
                first = first or exc
                log.warning("%s could not answer (%s)", provider.name, exc.public)
        assert first is not None
        raise first
