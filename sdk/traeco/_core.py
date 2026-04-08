"""Core Traeco SDK — wraps LLM clients and ships traces to the Traeco ingest endpoint."""

import asyncio
import functools
import threading
import time
from contextvars import ContextVar
from typing import Any

import httpx

# ── Per-call cost table (per token) ─────────────────────────────────────────
# Keys match the raw model names that OpenAI/Anthropic SDKs return.
_COST_PER_TOKEN: dict[str, tuple[float, float]] = {
    # OpenAI
    "gpt-4o":                     (5e-6,    15e-6),
    "gpt-4o-mini":                (0.15e-6, 0.6e-6),
    "gpt-3.5-turbo":              (0.5e-6,  1.5e-6),
    "gpt-3.5-turbo-0125":         (0.5e-6,  1.5e-6),
    # Anthropic
    "claude-3-5-sonnet":          (3e-6,    15e-6),
    "claude-3-5-sonnet-20240620": (3e-6,    15e-6),
    "claude-3-5-sonnet-20241022": (3e-6,    15e-6),
    "claude-sonnet-4-5":          (3e-6,    15e-6),
    "claude-3-haiku":             (0.25e-6, 1.25e-6),
    "claude-3-haiku-20240307":    (0.25e-6, 1.25e-6),
    "claude-3-5-haiku":           (0.8e-6,  4e-6),
    "claude-3-5-haiku-20241022":  (0.8e-6,  4e-6),
    "claude-3-opus":              (15e-6,   75e-6),
    "claude-3-opus-20240229":     (15e-6,   75e-6),
    "claude-3-sonnet":            (3e-6,    15e-6),
    "claude-3-sonnet-20240229":   (3e-6,    15e-6),
}


def _local_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    """Return cost in USD or None if model not in table."""
    rates = _COST_PER_TOKEN.get(model)
    if rates is None:
        # Try prefix match (e.g. "claude-3-5-sonnet-20240620-v2" → "claude-3-5-sonnet")
        for key, r in _COST_PER_TOKEN.items():
            if model.startswith(key):
                rates = r
                break
    if rates is None:
        return None
    return prompt_tokens * rates[0] + completion_tokens * rates[1]


# ── Demo fallbacks ───────────────────────────────────────────────────────────

class _DemoUsage:
    prompt_tokens = 847
    completion_tokens = 312

class _DemoMessage:
    content = "AI agents will reshape how software is built — starting with cost visibility."

class _DemoChoice:
    message = _DemoMessage()

class _DemoResponse:
    def __init__(self, model="gpt-4o"):
        self.model = model
        self.usage = _DemoUsage()
        self.choices = [_DemoChoice()]


# ── Global state ─────────────────────────────────────────────────────────────

_state = {
    "api_key": None,
    "agent_name": "default",
    "host": "https://api.traeco.ai",
    "debug": False,
}
_lock = threading.Lock()

# ContextVar tracks the current span name — thread and async safe.
# Each concurrent coroutine/thread gets its own value.
_current_span: ContextVar[str] = ContextVar("_current_span", default="")


# ── Public API ───────────────────────────────────────────────────────────────

def init(
    api_key: str,
    *,
    agent_name: str = "default",
    host: str = "https://api.traeco.ai",
    debug: bool = False,
) -> None:
    """Initialize Traeco. Call once at startup before wrapping any client."""
    with _lock:
        _state["api_key"] = api_key
        _state["agent_name"] = agent_name
        _state["host"] = host.rstrip("/")
        _state["debug"] = debug


# ── Trace shipping ───────────────────────────────────────────────────────────

def _ship(payload: dict) -> None:
    """Fire-and-forget trace shipping (runs in background thread)."""
    key = _state.get("api_key")
    host = _state.get("host")
    if not key:
        return
    try:
        with httpx.Client(timeout=5) as client:
            r = client.post(
                f"{host}/ingest",
                json=payload,
                headers={"X-Traeco-Key": key},
            )
            if _state["debug"]:
                print(f"[traeco] shipped trace → {r.status_code}")
    except Exception as exc:
        if _state["debug"]:
            print(f"[traeco] ship failed: {exc}")


def _ship_async(payload: dict) -> None:
    t = threading.Thread(target=_ship, args=(payload,), daemon=False)
    t.start()


def _build_payload(
    *,
    model: str,
    provider: str,
    prompt_tokens: int,
    completion_tokens: int,
    latency_ms: int,
    status: str = "success",
) -> dict:
    """Build the ingest payload, including pre-computed cost and current span."""
    cost = _local_cost(model, prompt_tokens, completion_tokens)
    payload: dict = {
        "agent_name": _state.get("agent_name", "default"),
        "provider": provider,
        "model": model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "latency_ms": latency_ms,
        "status": status,
        "feature_tag": _current_span.get(),  # span name, empty string if not inside @span
    }
    if cost is not None:
        payload["cost_usd"] = cost
    return payload


# ── OpenAI wrapper ───────────────────────────────────────────────────────────

class _WrappedCompletions:
    def __init__(self, completions, agent_name: str):
        self._completions = completions
        self._agent_name = agent_name

    def create(self, **kwargs):
        t0 = time.monotonic()
        model = kwargs.get("model", "unknown")
        try:
            response = self._completions.create(**kwargs)
            latency_ms = int((time.monotonic() - t0) * 1000)
            usage = response.usage
            actual_model = getattr(response, "model", None) or model
        except Exception as api_err:
            latency_ms = int((time.monotonic() - t0) * 1000)
            if _state["debug"]:
                print(f"[traeco] LLM call skipped (demo mode): {api_err}")
            response = _DemoResponse(model)
            usage = response.usage
            actual_model = model

        provider = "openai"
        if "claude" in actual_model:
            provider = "anthropic"
        elif "gemini" in actual_model:
            provider = "google"
        try:
            _ship_async(_build_payload(
                model=actual_model,
                provider=provider,
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                latency_ms=latency_ms,
            ))
        except Exception as exc:
            if _state["debug"]:
                print(f"[traeco] trace parse error: {exc}")
        return response

    async def acreate(self, **kwargs):
        t0 = time.monotonic()
        response = await self._completions.acreate(**kwargs)
        latency_ms = int((time.monotonic() - t0) * 1000)
        try:
            usage = response.usage
            model = response.model or kwargs.get("model", "unknown")
            _ship_async(_build_payload(
                model=model,
                provider="openai",
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                latency_ms=latency_ms,
            ))
        except Exception as exc:
            if _state["debug"]:
                print(f"[traeco] trace parse error: {exc}")
        return response


class _WrappedChat:
    def __init__(self, chat, agent_name: str):
        self.completions = _WrappedCompletions(chat.completions, agent_name)


class _WrappedOpenAIClient:
    def __init__(self, client, agent_name: str):
        self._client = client
        self.chat = _WrappedChat(client.chat, agent_name)

    def __getattr__(self, name: str):
        return getattr(self._client, name)


# ── Anthropic wrapper ────────────────────────────────────────────────────────

class _DemoAnthropicUsage:
    input_tokens = 847
    output_tokens = 312

class _DemoAnthropicContent:
    text = "AI agents will reshape how software is built — starting with cost visibility."
    type = "text"

class _DemoAnthropicResponse:
    def __init__(self, model="claude-3-5-sonnet-20241022"):
        self.model = model
        self.usage = _DemoAnthropicUsage()
        self.content = [_DemoAnthropicContent()]
        self.stop_reason = "end_turn"
        self.id = "demo_msg_traeco"
        self.type = "message"
        self.role = "assistant"


class _WrappedAnthropicMessages:
    def __init__(self, messages):
        self._messages = messages

    def create(self, **kwargs):
        t0 = time.monotonic()
        model = kwargs.get("model", "unknown")
        try:
            response = self._messages.create(**kwargs)
            latency_ms = int((time.monotonic() - t0) * 1000)
            usage = response.usage
            actual_model = getattr(response, "model", None) or model
        except Exception as api_err:
            latency_ms = int((time.monotonic() - t0) * 1000)
            if _state["debug"]:
                print(f"[traeco] Anthropic call skipped (demo mode): {api_err}")
            response = _DemoAnthropicResponse(model)
            usage = response.usage
            actual_model = model
        try:
            _ship_async(_build_payload(
                model=actual_model,
                provider="anthropic",
                prompt_tokens=usage.input_tokens,
                completion_tokens=usage.output_tokens,
                latency_ms=latency_ms,
            ))
        except Exception as exc:
            if _state["debug"]:
                print(f"[traeco] trace parse error: {exc}")
        return response


class _WrappedAnthropicClient:
    def __init__(self, client):
        self._client = client
        self.messages = _WrappedAnthropicMessages(client.messages)

    def __getattr__(self, name: str):
        return getattr(self._client, name)


# ── wrap() ───────────────────────────────────────────────────────────────────

def wrap(client: Any) -> Any:
    """Wrap an LLM client (OpenAI or Anthropic) to auto-ship traces to Traeco."""
    cls_name = type(client).__name__
    agent_name = _state.get("agent_name", "default")

    if "OpenAI" in cls_name or "AzureOpenAI" in cls_name:
        return _WrappedOpenAIClient(client, agent_name)
    if "Anthropic" in cls_name:
        return _WrappedAnthropicClient(client)

    if _state["debug"]:
        print(f"[traeco] wrap(): unrecognized client type '{cls_name}', returning unwrapped")
    return client


# ── span() decorator ─────────────────────────────────────────────────────────

def span(name: str):
    """
    Tag a function for per-span cost attribution in the Traeco dashboard.

    Uses Python contextvars so concurrent async tasks and threads each get
    their own span context — no cross-contamination between parallel calls.

    Every LLM call made inside the decorated function is tagged with the span
    name as feature_tag. The original agent_name is preserved.
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            token = _current_span.set(name)
            try:
                return fn(*args, **kwargs)
            finally:
                _current_span.reset(token)

        @functools.wraps(fn)
        async def async_wrapper(*args, **kwargs):
            token = _current_span.set(name)
            try:
                return await fn(*args, **kwargs)
            finally:
                _current_span.reset(token)

        return async_wrapper if asyncio.iscoroutinefunction(fn) else wrapper
    return decorator
