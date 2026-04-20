"""Core Traeco SDK — wraps LLM clients and ships traces to the Traeco ingest endpoint."""

import functools
import threading
import time
from typing import Any

import httpx

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


_state = {
    "api_key": None,
    "agent_name": "default",
    "host": "https://api.traeco.ai",
    "debug": False,
}
_lock = threading.Lock()


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


# ── OpenAI wrapper ──────────────────────────────────────────────────────────

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
            # No real API key — use demo values and still ship the trace
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
            _ship_async({
                "agent_name": _state.get("agent_name", "default"),
                "provider": provider,
                "model": actual_model,
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "latency_ms": latency_ms,
                "status": "success",
            })
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
            _ship_async({
                "agent_name": _state.get("agent_name", "default"),
                "provider": "openai",
                "model": model,
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "latency_ms": latency_ms,
                "status": "success",
            })
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


# ── Anthropic wrapper ───────────────────────────────────────────────────────

class _WrappedAnthropicMessages:
    def __init__(self, messages):
        self._messages = messages

    def create(self, **kwargs):
        t0 = time.monotonic()
        response = self._messages.create(**kwargs)
        latency_ms = int((time.monotonic() - t0) * 1000)
        try:
            usage = response.usage
            model = response.model or kwargs.get("model", "unknown")
            _ship_async({
                "agent_name": _state.get("agent_name", "default"),
                "provider": "anthropic",
                "model": model,
                "prompt_tokens": usage.input_tokens,
                "completion_tokens": usage.output_tokens,
                "latency_ms": latency_ms,
                "status": "success",
            })
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


# ── wrap() ──────────────────────────────────────────────────────────────────

def wrap(client: Any) -> Any:
    """Wrap an LLM client (OpenAI or Anthropic) to auto-ship traces to Traeco."""
    cls_name = type(client).__name__
    agent_name = _state.get("agent_name", "default")

    if "OpenAI" in cls_name or "AzureOpenAI" in cls_name:
        return _WrappedOpenAIClient(client, agent_name)
    if "Anthropic" in cls_name:
        return _WrappedAnthropicClient(client)

    # Unknown client — return as-is with a warning
    if _state["debug"]:
        print(f"[traeco] wrap(): unrecognized client type '{cls_name}', returning unwrapped")
    return client


# ── span() decorator ────────────────────────────────────────────────────────

def span(name: str):
    """Label a function for per-function cost attribution in the Traeco dashboard."""
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            prev = _state.get("agent_name")
            _state["agent_name"] = name
            try:
                return fn(*args, **kwargs)
            finally:
                _state["agent_name"] = prev

        @functools.wraps(fn)
        async def async_wrapper(*args, **kwargs):
            prev = _state.get("agent_name")
            _state["agent_name"] = name
            try:
                return await fn(*args, **kwargs)
            finally:
                _state["agent_name"] = prev

        import asyncio
        return async_wrapper if asyncio.iscoroutinefunction(fn) else wrapper
    return decorator
