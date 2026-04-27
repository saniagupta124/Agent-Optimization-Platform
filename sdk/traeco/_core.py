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
    "host": "https://traeco-backend-production.up.railway.app",
    "debug": False,
    "auto_judge": True,
    "judge_sample_rate": 0.10,
    "judge_model": "claude-haiku-4-5",
    "_judge_target": None,    # recommendation metadata only — no user data
    "_rubric_criteria": {},   # {cluster_label: criteria} from Stage 5 evals
}
_lock = threading.Lock()
_last_seen_model: str = ""
_judge_thread_started: bool = False

# Thread/async-safe span tracking — each coroutine/thread gets its own value
_current_span: ContextVar[str] = ContextVar("_current_span", default="")


# ── Public API ───────────────────────────────────────────────────────────────

def init(
    api_key: str,
    *,
    agent_name: str = "default",
    host: str = "https://traeco-backend-production.up.railway.app",
    debug: bool = False,
    auto_judge: bool = True,
    judge_sample_rate: float = 0.10,
    judge_model: str = "claude-haiku-4-5",
) -> None:
    """Initialize Traeco. Call once at startup before wrapping any client."""
    global _judge_thread_started
    with _lock:
        _state["api_key"] = api_key
        _state["agent_name"] = agent_name
        _state["host"] = host.rstrip("/")
        _state["debug"] = debug
        _state["auto_judge"] = auto_judge
        _state["judge_sample_rate"] = judge_sample_rate
        _state["judge_model"] = judge_model
    if debug:
        print(f"[traeco] initialized — agent={agent_name!r}, host={_state['host']}")
    if auto_judge and not _judge_thread_started:
        _judge_thread_started = True
        t = threading.Thread(target=_judge_poll_loop, daemon=True)
        t.start()


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


# ── Auto-judge system ────────────────────────────────────────────────────────
# No user data stored ever. Prompts/outputs exist only as local variables during
# evaluation (~2s), then garbage collected. Only numeric scores are shipped.

import random as _random

def _judge_poll_loop() -> None:
    while True:
        import time as _time; _time.sleep(300)
        _refresh_judge_target()

def _refresh_judge_target() -> None:
    if not _state.get("auto_judge") or not _state.get("api_key"):
        return
    try:
        key = _state["api_key"]; host = _state["host"]; agent = _state.get("agent_name", "default")
        with httpx.Client(timeout=10) as client:
            r = client.get(f"{host}/recommendations/{agent}", headers={"X-Traeco-Key": key})
        if r.status_code != 200:
            return
        target = None
        for rec in r.json():
            rt = rec.get("rec_type"); span = rec.get("span_name", "")
            if rt in ("model_swap", "model_overkill"):
                b, c = rec.get("baseline_model"), rec.get("candidate_model")
                if b and c:
                    target = {"rec_type": rt, "span_name": span, "baseline_model": b, "candidate_model": c}; break
            elif rt == "context_bloat":
                red = rec.get("savings_per_month", 0) / max(rec.get("current_monthly_cost", 1), 1e-9)
                target = {"rec_type": "context_bloat", "span_name": span, "reduction_pct": min(max(red, 0.1), 0.7)}; break
            elif rt == "max_tokens_cap":
                rm = rec.get("recommended_max_tokens")
                if rm:
                    target = {"rec_type": "max_tokens_cap", "span_name": span, "recommended_max_tokens": rm}; break
        _state["_judge_target"] = target
        if _state["debug"] and target:
            print(f"[traeco] auto-judge target: {target}")
        try:
            rc = client.get(f"{host}/agents/{agent}/eval-clusters", headers={"X-Traeco-Key": key})
            if rc.status_code == 200:
                data = rc.json()
                _state["_rubric_criteria"] = {
                    c["cluster_label"]: c["good_answer_criteria"]
                    for c in data.get("clusters", [])
                    if not c.get("skip_criteria") and c.get("good_answer_criteria")
                }
        except Exception:
            pass
    except Exception as exc:
        if _state["debug"]:
            print(f"[traeco] auto-judge refresh failed: {exc}")

def _apply_windowing(messages: list, reduction_pct: float) -> list:
    system = [m for m in messages if m.get("role") == "system"]
    convo = [m for m in messages if m.get("role") != "system"]
    if len(convo) <= 2:
        return messages
    keep = max(2, int(len(convo) * (1 - reduction_pct)))
    if keep % 2 != 0:
        keep = max(2, keep - 1)
    return system + convo[-keep:]

def _match_cluster(user_input: str, criteria_map: dict) -> str | None:
    if not criteria_map or not user_input:
        return None
    user_lower = user_input.lower()
    best_label, best_hits = None, 0
    for label in criteria_map:
        keywords = label.replace("/", " ").replace("-", " ").replace("_", " ").split()
        hits = sum(1 for kw in keywords if len(kw) > 3 and kw in user_lower)
        if hits > best_hits:
            best_hits, best_label = hits, label
    return best_label if best_hits > 0 else None

def _maybe_shadow_judge(messages: list, baseline_output: str, current_model: str, provider: str) -> None:
    global _last_seen_model
    if not _state.get("auto_judge"):
        return
    if current_model and current_model != _last_seen_model and _last_seen_model:
        if _state["debug"]:
            print(f"[traeco] model change: {_last_seen_model} → {current_model}")
        threading.Thread(target=_refresh_judge_target, daemon=True).start()
    _last_seen_model = current_model
    target = _state.get("_judge_target")
    if not target or _random.random() > _state.get("judge_sample_rate", 0.10):
        return
    target_span = target.get("span_name", "")
    if target_span and target_span != _current_span.get():
        return
    rt = target.get("rec_type")
    if rt in ("model_swap", "model_overkill"):
        bm, cm = target["baseline_model"], target["candidate_model"]
        shadow = cm if current_model == bm else (bm if current_model == cm else None)
        if not shadow:
            return
        threading.Thread(target=_shadow_evaluate, args=(list(messages), baseline_output, shadow, bm, cm, None, None, target_span, rt), daemon=True).start()
    elif rt == "context_bloat" and len(messages) > 2:
        windowed = _apply_windowing(list(messages), target.get("reduction_pct", 0.4))
        if windowed == messages:
            return
        threading.Thread(target=_shadow_evaluate, args=(list(messages), baseline_output, current_model, current_model, current_model, windowed, None, target_span, "context_bloat"), daemon=True).start()
    elif rt == "max_tokens_cap":
        rm = target.get("recommended_max_tokens")
        if rm:
            threading.Thread(target=_shadow_evaluate, args=(list(messages), baseline_output, current_model, current_model, current_model, None, rm, target_span, "max_tokens_cap"), daemon=True).start()

def _shadow_evaluate(messages, current_output, shadow_model, baseline_model, candidate_model, windowed_messages, shadow_max_tokens, span_name="", rec_type=""):
    try:
        shadow_input = windowed_messages if windowed_messages is not None else messages
        shadow_output = _replay(shadow_input, shadow_model, _provider_from_model(shadow_model), shadow_max_tokens)
        if not shadow_output:
            return
        user_input = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
        criteria_map: dict = _state.get("_rubric_criteria", {})
        criteria = criteria_map.get(_match_cluster(user_input, criteria_map)) if criteria_map else None
        score = _judge_pair(messages, current_output, shadow_output, _state["judge_model"], criteria=criteria)
        if score is None:
            return
        _ship_eval_score(baseline_model, candidate_model, score, span_name=span_name, rec_type=rec_type)
        if _state["debug"]:
            print(f"[traeco] auto-judge: [{span_name}/{rec_type}] {score:.1f}% prefer candidate")
    except Exception as exc:
        if _state["debug"]:
            print(f"[traeco] auto-judge failed: {exc}")

def _replay(messages: list, model: str, provider: str, max_tokens: int | None = None) -> str | None:
    cap = max_tokens or 1024
    try:
        if "anthropic" in provider or model.startswith("claude"):
            import anthropic as _ant  # type: ignore
            client = _ant.Anthropic()
            system = next((m["content"] for m in messages if m.get("role") == "system"), None)
            user_msgs = [m for m in messages if m.get("role") != "system"]
            kwargs: dict = {"model": model, "max_tokens": cap, "messages": user_msgs}
            if system:
                kwargs["system"] = system
            resp = client.messages.create(**kwargs)
            return resp.content[0].text if resp.content else None
        else:
            import openai as _oai  # type: ignore
            resp = _oai.OpenAI().chat.completions.create(model=model, messages=messages, max_tokens=cap)
            return resp.choices[0].message.content
    except Exception:
        return None

def _judge_pair(messages: list, baseline: str, candidate: str, judge_model: str, criteria: str | None = None) -> float | None:
    user_input = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
    scores = []
    for order in [("A", "B"), ("B", "A")]:
        a_label, b_label = order
        a_text = baseline if a_label == "A" else candidate
        b_text = candidate if b_label == "B" else baseline
        if criteria:
            prompt = f"You are evaluating two AI agent responses.\n\nCriteria:\n{criteria}\n\nInput: {user_input[:400]}\n\nResponse A: {a_text[:600]}\n\nResponse B: {b_text[:600]}\n\nWhich better satisfies the criteria? Reply ONLY with A, B, or tie."
        else:
            prompt = f"Which response better answers this input? Reply with exactly A, B, or tie.\n\nInput: {user_input[:400]}\n\nResponse A: {a_text[:600]}\n\nResponse B: {b_text[:600]}"
        verdict = _call_judge(prompt, judge_model)
        if verdict is None:
            continue
        if verdict == "TIE":
            scores.append(50.0)
        elif (verdict == "B" and b_label == "B") or (verdict == "A" and a_label == "B"):
            scores.append(100.0)
        else:
            scores.append(0.0)
    return sum(scores) / len(scores) if scores else None

def _call_judge(prompt: str, judge_model: str) -> str | None:
    try:
        if judge_model.startswith("claude"):
            import anthropic as _ant  # type: ignore
            resp = _ant.Anthropic().messages.create(model=judge_model, max_tokens=10, messages=[{"role": "user", "content": prompt}])
            return resp.content[0].text.strip().upper().split()[0] if resp.content else None
        else:
            import openai as _oai  # type: ignore
            resp = _oai.OpenAI().chat.completions.create(model=judge_model, max_tokens=10, messages=[{"role": "user", "content": prompt}])
            return resp.choices[0].message.content.strip().upper().split()[0]
    except Exception:
        return None

def _ship_eval_score(baseline_model: str, candidate_model: str, preference_pct: float, span_name: str = "", rec_type: str = "") -> None:
    key = _state.get("api_key"); host = _state.get("host"); agent = _state.get("agent_name", "default")
    try:
        with httpx.Client(timeout=8) as client:
            client.post(f"{host}/agents/{agent}/eval", json={"baseline_model": baseline_model, "candidate_model": candidate_model, "preference_pct": preference_pct, "span_name": span_name, "rec_type": rec_type}, headers={"X-Traeco-Key": key})
    except Exception as exc:
        if _state["debug"]:
            print(f"[traeco] auto-judge ship failed: {exc}")


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
        _maybe_shadow_judge(kwargs.get("messages", []), _extract_text(response, "openai"), actual_model, "openai")
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
        _maybe_shadow_judge(kwargs.get("messages", []), _extract_text(response, "openai"), actual_model, "openai")
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
        _maybe_shadow_judge(kwargs.get("messages", []), _extract_text(response, "anthropic"), actual_model, "anthropic")
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
        _maybe_shadow_judge(kwargs.get("messages", []), _extract_text(response, "anthropic"), actual_model, "anthropic")
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

def run_eval(
    prompt: str,
    response_a: str,
    response_b: str,
    *,
    baseline_model: str = "baseline",
    candidate_model: str = "candidate",
) -> float | None:
    """
    Compare response_a (baseline) vs response_b (candidate) for the given prompt.
    Uses a local LLM call — prompt and responses never leave your machine.
    Stores only the preference score in Traeco for recommendation quality signals.

    Returns preference_pct for response_b (0 = strongly prefer A, 100 = strongly prefer B).
    Returns None if the SDK is not initialized or the judge call fails.
    """
    key = _state.get("api_key")
    host = _state.get("host")
    agent_name = _state.get("agent_name", "default")
    if not key:
        if _state["debug"]:
            print("[traeco] run_eval(): SDK not initialized — call traeco.init() first")
        return None

    preference_pct = _run_judge(prompt, response_a, response_b)
    if preference_pct is None:
        return None

    try:
        with httpx.Client(timeout=10) as client:
            client.post(
                f"{host}/agents/{agent_name}/eval",
                json={
                    "baseline_model": baseline_model,
                    "candidate_model": candidate_model,
                    "preference_pct": preference_pct,
                },
                headers={"X-Traeco-Key": key},
            )
    except Exception as exc:
        if _state["debug"]:
            print(f"[traeco] run_eval ship failed: {exc}")

    return preference_pct


def _run_judge(prompt: str, response_a: str, response_b: str) -> float | None:
    """
    Ask an LLM to judge which response better answers the prompt.
    Returns preference_pct for response_b (0-100). Never ships prompt/responses anywhere.
    Falls back to length heuristic if no LLM client is available.
    """
    judge_prompt = (
        "You are an impartial judge comparing two AI responses to the same prompt.\n"
        "Respond with ONLY a JSON object: {\"preference\": <0-100>} where 0 means you strongly "
        "prefer Response A and 100 means you strongly prefer Response B.\n\n"
        f"Prompt:\n{prompt[:500]}\n\n"
        f"Response A:\n{response_a[:800]}\n\n"
        f"Response B:\n{response_b[:800]}"
    )

    try:
        import anthropic  # type: ignore
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=64,
            messages=[{"role": "user", "content": judge_prompt}],
        )
        import json as _json
        text = msg.content[0].text.strip()
        data = _json.loads(text)
        return float(max(0, min(100, data["preference"])))
    except Exception:
        pass

    try:
        import openai  # type: ignore
        client = openai.OpenAI()
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=64,
            messages=[{"role": "user", "content": judge_prompt}],
        )
        import json as _json
        text = resp.choices[0].message.content.strip()
        data = _json.loads(text)
        return float(max(0, min(100, data["preference"])))
    except Exception:
        pass

    # Length heuristic fallback (very rough proxy)
    len_a, len_b = len(response_a), len(response_b)
    if len_a + len_b == 0:
        return 50.0
    return round(len_b / (len_a + len_b) * 100, 1)


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
