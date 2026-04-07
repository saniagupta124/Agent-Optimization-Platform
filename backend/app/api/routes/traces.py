"""
OpenLLMetry-compatible trace ingestion.

Authentication: Authorization: Bearer slash_<agent_sdk_key>
The SDK token identifies the agent — no agent_id in the payload,
no user JWT required. One token per agent, auto-generated on creation.

Supports standard OpenLLMetry span attributes:
  llm.model / gen_ai.request.model
  llm.usage.prompt_tokens / gen_ai.usage.input_tokens
  llm.usage.completion_tokens / gen_ai.usage.output_tokens
  llm.request.type  (maps to feature_tag)
  traceloop.workflow.name  (fallback feature_tag)
  gen_ai.prompt  (first message — stored as prompt_preview)
  user.id  (maps to customer_id)
"""
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.pricing import calculate_cost
from app.db.models import Agent, Request
from app.db.session import get_db

router = APIRouter(prefix="/traces")


# ---------------------------------------------------------------------------
# Auth helper — resolves Bearer sdk_key → Agent
# ---------------------------------------------------------------------------

def get_agent_by_sdk_key(
    authorization: str = Header(...),
    db: Session = Depends(get_db),
) -> Agent:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    agent = db.query(Agent).filter(Agent.sdk_key == token).first()
    if not agent:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent SDK key")
    return agent


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class OTLPSpan(BaseModel):
    trace_id: str = ""
    span_id: str = ""
    name: str = ""
    start_time_unix_nano: int = 0
    end_time_unix_nano: int = 0
    attributes: dict[str, Any] = {}
    status: dict[str, Any] = {}


class TracePayload(BaseModel):
    """
    A batch of OpenTelemetry spans.
    No agent_id needed — the SDK key in the Authorization header identifies the agent.
    """
    spans: list[OTLPSpan]


class TraceIngestionResponse(BaseModel):
    ingested: int
    skipped: int


# Simple log-one-call schema (for manual instrumentation)
class LogCallRequest(BaseModel):
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int = 0
    status: str = "success"
    feature_tag: str = ""
    customer_id: str = "unknown"
    tool_calls: int = 0
    prompt_preview: str = ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/ingest", response_model=TraceIngestionResponse)
def ingest_traces(
    payload: TracePayload,
    agent: Agent = Depends(get_agent_by_sdk_key),
    db: Session = Depends(get_db),
):
    """
    Ingest a batch of OpenLLMetry spans.
    Each span that contains LLM usage data becomes a Request record.
    """
    ingested = 0
    skipped = 0

    for span in payload.spans:
        attrs = span.attributes

        model = attrs.get("llm.model") or attrs.get("gen_ai.request.model", "")
        prompt_tokens = int(attrs.get("llm.usage.prompt_tokens") or attrs.get("gen_ai.usage.input_tokens") or 0)
        completion_tokens = int(attrs.get("llm.usage.completion_tokens") or attrs.get("gen_ai.usage.output_tokens") or 0)

        if not model or (prompt_tokens == 0 and completion_tokens == 0):
            skipped += 1
            continue

        # Normalize model key (openai:gpt-4o → openai/gpt-4o)
        if ":" in model and "/" not in model:
            model = model.replace(":", "/", 1)

        provider = model.split("/")[0] if "/" in model else "unknown"
        total_tokens = prompt_tokens + completion_tokens
        cost = calculate_cost(prompt_tokens, completion_tokens, model)

        latency_ms = 0
        if span.start_time_unix_nano and span.end_time_unix_nano:
            latency_ms = max(0, int((span.end_time_unix_nano - span.start_time_unix_nano) / 1_000_000))

        status_code = span.status.get("code", "STATUS_CODE_OK")
        req_status = "error" if "ERROR" in str(status_code).upper() else "success"

        feature_tag = (
            attrs.get("llm.request.type")
            or attrs.get("traceloop.workflow.name")
            or span.name
            or ""
        )[:64]

        # Capture first 200 chars of the prompt for recommendations context
        raw_prompt = attrs.get("gen_ai.prompt") or attrs.get("llm.prompts.0.content") or ""
        prompt_preview = str(raw_prompt)[:200] if raw_prompt else ""

        req = Request(
            agent_id=agent.id,
            customer_id=str(attrs.get("user.id", "unknown")),
            provider=provider,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=cost,
            latency_ms=latency_ms,
            status=req_status,
            feature_tag=feature_tag,
            tool_calls=int(attrs.get("llm.usage.tool_calls", 0)),
        )
        db.add(req)
        ingested += 1

    if ingested > 0:
        db.commit()

    return TraceIngestionResponse(ingested=ingested, skipped=skipped)


@router.post("/log", response_model=TraceIngestionResponse)
def log_single_call(
    payload: LogCallRequest,
    agent: Agent = Depends(get_agent_by_sdk_key),
    db: Session = Depends(get_db),
):
    """
    Log a single LLM call manually (after the call has completed).
    Use this if you're not using the OpenLLMetry SDK.

    Example:
        response = openai_client.chat.completions.create(...)
        requests.post("/traces/log",
            headers={"Authorization": "Bearer slash_<your_sdk_key>"},
            json={
                "model": "openai/gpt-4o",
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "latency_ms": elapsed_ms,
                "feature_tag": "chat",
            }
        )
    """
    # Normalize model key
    model = payload.model
    if ":" in model and "/" not in model:
        model = model.replace(":", "/", 1)

    provider = model.split("/")[0] if "/" in model else "unknown"
    total_tokens = payload.prompt_tokens + payload.completion_tokens
    cost = calculate_cost(payload.prompt_tokens, payload.completion_tokens, model)

    req = Request(
        agent_id=agent.id,
        customer_id=payload.customer_id,
        provider=provider,
        model=model,
        prompt_tokens=payload.prompt_tokens,
        completion_tokens=payload.completion_tokens,
        total_tokens=total_tokens,
        cost_usd=cost,
        latency_ms=payload.latency_ms,
        status=payload.status,
        feature_tag=payload.feature_tag[:64] if payload.feature_tag else "",
        tool_calls=payload.tool_calls,
    )
    db.add(req)
    db.commit()

    return TraceIngestionResponse(ingested=1, skipped=0)
