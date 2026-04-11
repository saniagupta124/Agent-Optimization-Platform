"""Core Traeco SDK — wraps LLM clients and ships traces to the Traeco ingest endpoint."""

import asyncio
import functools
import threading
import time
from contextvars import ContextVar
from typing import Any, Iterator, AsyncIterator

import httpx

# ── Per-call cost table (input_rate, output_rate) per token ─────────────────
_COST_PER_TOKEN: dict[str, tuple[float, float]] = {
    # OpenAI
    "gpt-4o":                         (5e-6,     15e-6),
    "gpt-4o-mini":                     (0.15e-6,  0.6e-6),
    "gpt-3.5-turbo":                   (0.5e-6,   1.5e-6),
    "gpt-3.5-turbo-0125":              (0.5e-6,   1.5e-6),
    "o1":                              (15e-6,    60e-6),
    "o1-mini":                         (3e-6,     12e-6),
    "o3-mini":                         (1.1e-6,   4.4e-6),
    # Anthropic — Claude 4.x (current as of April 2026)
    "claude-opus-4-6":                 (15e-6,    75e-6),
    "claude-sonnet-4-6":               (3e-6,     15e-6),
    "claude-haiku-4-5":                (0.8e-6,   4e-6),
    "claude-haiku-4-5-20251001":       (0.8e-6,   4e-6),
    # Anthropic — Claude 3.x (still in use)
    "claude-3-5-sonnet":               (3e-6,     15e-6),
    "claude-3-5-sonnet-20240620":      (3e-6,     15e-6),
    "claude-3-5-sonnet-20241022":      (3e-6,     15e-6),
    "claude-sonnet-4-5":               (3e-6,     15e-6),
    "claude-3-haiku":                  (0.25e-6,  1.25e-6),
    "claude-3-haiku-20240307":         (0.25e-6,  1.25e-6),
    "claude-3-5-haiku":                (0.8e-6,   4e-6),
    "claude-3-5-haiku-20241022":       (0.8e-6,   4e-6),
    "claude-3-opus":                   (15e-6,    75e-6),
    "claude-3-opus-20240229":          (15e-6,    75e-6),
    "claude-3-sonnet":                 (3e-6,     15e-6),
    "claude-3-sonnet-20240229":        (3e-6,     15e-6),
}


def _local_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    """Return cost in USD or None if model not in table."""
    rates = _COST_PER_TOKEN.get(model)
    if rates is None:
        # Prefix match handles dated suffixes like "claude-sonnet-4-6-20260101"
        for key, r in _COST_PER_TOKEN.items():
            if model.startswith(key):
                rates = r
                break
    if rates is None:
        return None
    return prompt_tokens * rates[0] + completion_tokens * rates[1]


# ── Global state ─────────────────────────────────────────────────────────────

_state: dict[str, Any] = {
    "api_key": None,
    "agent_name": "default",
    "host": "https://api.traeco.ai",
    "debug": False,
}
_lock = threading.Lock()

# Thread/async-safe span tracking — each coroutine/thread gets its own value
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
    if debug:
        print(f"[traeco] initialized — agent={agent_name!r}, host={_state['host']}")


# ── Trace shipping ───────────────────────────────────────────────────────────

def _ship(payload: dict) -> None:
    """Blocking trace ship — always called from a background daemon=False thread."""
    key = _state.get("api_key")
    host = _state.get("host")
    if not key:
        return
    try:
        with httpx.Client(timeout=8) as client:
            r = client.post(
                f"{host}/ingest",
                json=payload,
                headers={"X-Traeco-Key": key},
            )
            if _state["debug"]:
                print(f"[traeco] → {r.status_code} | {payload.get('feature_tag') or 'root'} | "
                      f"${payload.get('cost_usd', 0):.6f} | {payload.get('model')}")
    except Exception as exc:
        if _state["debug"]:
            print(f"[traeco] ship failed: {exc}")


def _ship_async(payload: dict) -> None:
    """Fire-and-forget — non-daemon so the process stays alive until trace is sent."""
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
    error: str = "",
) -> dict:
    cost = _local_cost(model, prompt_tokens, completion_tokens)
    payload: dict = {
        "agent_name": _state.get("agent_name", "default"),
        "provider": provider,
        "model": model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "latency_ms": latency_ms,
        "status": status,
        "feature_tag": _current_span.get(),
    }
    if cost is not None:
        payload["cost_usd"] = cost
    if error:
        payload["error_detail"] = error
    return payload


def _provider_from_model(model: str) -> str:
    if model.startswith("claude"):
        return "anthropic"
    if model.startswith("gemini"):
        return "google"
    if model.startswith("gpt") or model.startswith("o1") or model.startswith("o3"):
        return "openai"
    return "openai"


# ── OpenAI wrapper ───────────────────────────────────────────────────────────

class _WrappedCompletions:
    def __init__(self, completions):
        self._c = completions

    def create(self, **kwargs):
        stream = kwargs.get("stream", False)
        model = kwargs.get("model", "unknown")
        t0 = time.monotonic()

        if stream:
            return self._create_streaming(model, t0, **kwargs)

        try:
            response = self._c.create(**kwargs)
        except Exception as exc:
            latency_ms = int((time.monotonic() - t0) * 1000)
            _ship_async(_build_payload(
                model=model, provider=_provider_from_model(model),
                prompt_tokens=0, completion_tokens=0,
                latency_ms=latency_ms, status="error", error=str(exc),
            ))
            raise

        latency_ms = int((time.monotonic() - t0) * 1000)
        actual_model = getattr(response, "model", None) or model
        usage = response.usage
        _ship_async(_build_payload(
            model=actual_model,
            provider=_provider_from_model(actual_model),
            prompt_tokens=getattr(usage, "prompt_tokens", 0),
            completion_tokens=getattr(usage, "completion_tokens", 0),
            latency_ms=latency_ms,
        ))
        return response

    def _create_streaming(self, model: str, t0: float, **kwargs):
        """Wrap a streaming OpenAI response — yields chunks, ships trace at end."""
        raw_stream = self._c.create(**kwargs)
        prompt_tokens = 0
        completion_tokens = 0

        for chunk in raw_stream:
            # OpenAI sends usage in final chunk when stream_options.include_usage=True
            if hasattr(chunk, "usage") and chunk.usage:
                prompt_tokens = getattr(chunk.usage, "prompt_tokens", 0)
                completion_tokens = getattr(chunk.usage, "completion_tokens", 0)
            yield chunk

        latency_ms = int((time.monotonic() - t0) * 1000)
        _ship_async(_build_payload(
            model=model, provider=_provider_from_model(model),
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            latency_ms=latency_ms,
        ))

    async def acreate(self, **kwargs):
        model = kwargs.get("model", "unknown")
        t0 = time.monotonic()
        try:
            response = await self._c.acreate(**kwargs)
        except Exception as exc:
            latency_ms = int((time.monotonic() - t0) * 1000)
            _ship_async(_build_payload(
                model=model, provider=_provider_from_model(model),
                prompt_tokens=0, completion_tokens=0,
                latency_ms=latency_ms, status="error", error=str(exc),
            ))
            raise

        latency_ms = int((time.monotonic() - t0) * 1000)
        actual_model = getattr(response, "model", None) or model
        usage = response.usage
        _ship_async(_build_payload(
            model=actual_model,
            provider=_provider_from_model(actual_model),
            prompt_tokens=getattr(usage, "prompt_tokens", 0),
            completion_tokens=getattr(usage, "completion_tokens", 0),
            latency_ms=latency_ms,
        ))
        return response


class _WrappedChat:
    def __init__(self, chat):
        self.completions = _WrappedCompletions(chat.completions)


class _WrappedOpenAIClient:
    def __init__(self, client):
        self._client = client
        self.chat = _WrappedChat(client.chat)

    def __getattr__(self, name: str):
        return getattr(self._client, name)


# ── Anthropic wrapper ────────────────────────────────────────────────────────

class _TracedAnthropicStream:
    """
    Wraps an Anthropic streaming response (returned by messages.create(stream=True)).
    Passes all events through unchanged and ships a trace when the stream is exhausted.
    """
    def __init__(self, raw_stream, model: str, t0: float):
        self._stream = raw_stream
        self._model = model
        self._t0 = t0
        self._input_tokens = 0
        self._output_tokens = 0

    def __iter__(self) -> Iterator:
        try:
            for event in self._stream:
                self._capture_usage(event)
                yield event
        finally:
            self._ship()

    async def __aiter__(self) -> AsyncIterator:
        try:
            async for event in self._stream:
                self._capture_usage(event)
                yield event
        finally:
            self._ship()

    def _capture_usage(self, event) -> None:
        # message_start event carries input_tokens
        if getattr(event, "type", None) == "message_start":
            msg = getattr(event, "message", None)
            usage = getattr(msg, "usage", None) if msg else None
            if usage:
                self._input_tokens = getattr(usage, "input_tokens", 0)
        # message_delta carries output_tokens at the end
        if getattr(event, "type", None) == "message_delta":
            usage = getattr(event, "usage", None)
            if usage:
                self._output_tokens = getattr(usage, "output_tokens", 0)

    def _ship(self) -> None:
        latency_ms = int((time.monotonic() - self._t0) * 1000)
        _ship_async(_build_payload(
            model=self._model,
            provider="anthropic",
            prompt_tokens=self._input_tokens,
            completion_tokens=self._output_tokens,
            latency_ms=latency_ms,
        ))

    # Passthrough for any attribute the caller expects on the raw stream
    def __getattr__(self, name: str):
        return getattr(self._stream, name)


class _WrappedAnthropicMessages:
    def __init__(self, messages):
        self._m = messages

    def create(self, **kwargs):
        model = kwargs.get("model", "unknown")
        stream = kwargs.get("stream", False)
        t0 = time.monotonic()

        if stream:
            raw = self._m.create(**kwargs)
            return _TracedAnthropicStream(raw, model, t0)

        try:
            response = self._m.create(**kwargs)
        except Exception as exc:
            latency_ms = int((time.monotonic() - t0) * 1000)
            _ship_async(_build_payload(
                model=model, provider="anthropic",
                prompt_tokens=0, completion_tokens=0,
                latency_ms=latency_ms, status="error", error=str(exc),
            ))
            raise

        latency_ms = int((time.monotonic() - t0) * 1000)
        actual_model = getattr(response, "model", None) or model
        usage = response.usage
        _ship_async(_build_payload(
            model=actual_model,
            provider="anthropic",
            prompt_tokens=getattr(usage, "input_tokens", 0),
            completion_tokens=getattr(usage, "output_tokens", 0),
            latency_ms=latency_ms,
        ))
        return response

    async def acreate(self, **kwargs):
        """Async version — for agents running in asyncio event loops."""
        model = kwargs.get("model", "unknown")
        t0 = time.monotonic()
        try:
            response = await self._m.acreate(**kwargs)
        except Exception as exc:
            latency_ms = int((time.monotonic() - t0) * 1000)
            _ship_async(_build_payload(
                model=model, provider="anthropic",
                prompt_tokens=0, completion_tokens=0,
                latency_ms=latency_ms, status="error", error=str(exc),
            ))
            raise

        latency_ms = int((time.monotonic() - t0) * 1000)
        actual_model = getattr(response, "model", None) or model
        usage = response.usage
        _ship_async(_build_payload(
            model=actual_model,
            provider="anthropic",
            prompt_tokens=getattr(usage, "input_tokens", 0),
            completion_tokens=getattr(usage, "output_tokens", 0),
            latency_ms=latency_ms,
        ))
        return response

    def stream(self, **kwargs):
        """
        Supports the context-manager streaming pattern:
            with client.messages.stream(...) as s:
                for text in s.text_stream: ...
            final = s.get_final_message()
        """
        model = kwargs.get("model", "unknown")
        t0 = time.monotonic()
        raw = self._m.stream(**kwargs)
        return _TracedAnthropicStreamContext(raw, model, t0)


class _TracedAnthropicStreamContext:
    """Wraps the context-manager style anthropic stream (.stream(...))."""

    def __init__(self, raw, model: str, t0: float):
        self._raw = raw
        self._model = model
        self._t0 = t0

    def __enter__(self):
        self._raw.__enter__()
        return self

    def __exit__(self, *args):
        result = self._raw.__exit__(*args)
        # Ship trace using the final message usage
        final = getattr(self._raw, "_MessageStream__final_message", None)
        if final is None:
            try:
                final = self._raw.get_final_message()
            except Exception:
                pass
        if final:
            usage = getattr(final, "usage", None)
            _ship_async(_build_payload(
                model=self._model,
                provider="anthropic",
                prompt_tokens=getattr(usage, "input_tokens", 0) if usage else 0,
                completion_tokens=getattr(usage, "output_tokens", 0) if usage else 0,
                latency_ms=int((time.monotonic() - self._t0) * 1000),
            ))
        return result

    def __getattr__(self, name: str):
        return getattr(self._raw, name)


class _WrappedAnthropicClient:
    def __init__(self, client):
        self._client = client
        self.messages = _WrappedAnthropicMessages(client.messages)

    def __getattr__(self, name: str):
        return getattr(self._client, name)


# ── wrap() ───────────────────────────────────────────────────────────────────

def wrap(client: Any) -> Any:
    """
    Wrap an OpenAI or Anthropic client to auto-ship traces to Traeco.

    Usage:
        client = wrap(Anthropic())
        client = wrap(OpenAI())
    """
    if not _state.get("api_key"):
        if _state["debug"]:
            print("[traeco] wrap(): no API key set — call traeco.init() first. Returning unwrapped client.")
        return client

    cls_name = type(client).__name__
    if "Anthropic" in cls_name:
        return _WrappedAnthropicClient(client)
    if "OpenAI" in cls_name or "AzureOpenAI" in cls_name:
        return _WrappedOpenAIClient(client)

    if _state["debug"]:
        print(f"[traeco] wrap(): unrecognized client type '{cls_name}', returning unwrapped")
    return client


# ── span() decorator ─────────────────────────────────────────────────────────

def span(name: str):
    """
    Tag a function for per-function cost breakdown in the Traeco dashboard.

    Every LLM call inside the decorated function is tagged with this name.
    Works with both sync and async functions.
    Thread-safe and async-safe via Python contextvars.

    Example:
        @span("market_analysis")
        def analyze(data):
            return client.messages.create(...)

        @span("trade_decision")
        async def decide(analysis):
            return await client.messages.acreate(...)
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
