"""
OpenLLMetry-compatible trace ingestion.

Authentication: Authorization: Bearer tk_live_<sdk_key>
The SDK token identifies the user via sdk_api_keys table.
Agents are auto-created on first trace using the agent_name field.

Supports standard OpenLLMetry span attributes:
  llm.model / gen_ai.request.model
  llm.usage.prompt_tokens / gen_ai.usage.input_tokens
  llm.usage.completion_tokens / gen_ai.usage.output_tokens
  llm.request.type  (maps to feature_tag)
  traceloop.workflow.name  (fallback feature_tag)
  gen_ai.prompt  (first message — stored as prompt_preview)
  user.id  (maps to customer_id)
"""
import hashlib
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.pricing import calculate_cost
from app.db.models import Agent, Request, SdkApiKey
from app.db.session import get_db

router = APIRouter(prefix="/traces")


# ---------------------------------------------------------------------------
# Auth helper — resolves Bearer tk_live_... → (user_id, SdkApiKey)
# ---------------------------------------------------------------------------

def _resolve_sdk_key(authorization: str, db: Session) -> SdkApiKey:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    key_hash = hashlib.sha256(token.encode()).hexdigest()
    key = db.query(SdkApiKey).filter(SdkApiKey.key_hash == key_hash).first()
    if not key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid SDK key")
    key.last_used_at = datetime.utcnow()
    db.commit()
    return key


def _upsert_agent(db: Session, user_id: str, agent_name: str, model: str, provider: str) -> Agent:
    """Find or create an agent by (user_id, name)."""
    agent = (
        db.query(Agent)
        .filter(Agent.user_id == user_id, Agent.name == agent_name)
        .first()
    )
    if not agent:
        agent = Agent(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=agent_name,
            purpose="",
            provider=provider,
            model=model,
            api_key_hint="",
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
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
    The SDK key in the Authorization header identifies the user.
    agent_name is used to find or auto-create the agent.
    """
    spans: list[OTLPSpan]
    agent_name: str = "my_agent"


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
    agent_name: str = "my_agent"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/ingest", response_model=TraceIngestionResponse)
def ingest_traces(
    payload: TracePayload,
    authorization: str = Header(...),
    db: Session = Depends(get_db),
):
    """
    Ingest a batch of OpenLLMetry spans.
    Each span that contains LLM usage data becomes a Request record.
    """
    sdk_key = _resolve_sdk_key(authorization, db)
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

        # Resolve agent name: span attribute takes priority over payload-level default
        agent_name = (
            attrs.get("traceloop.workflow.name")
            or attrs.get("traeco.agent_name")
            or payload.agent_name
        )
        agent = _upsert_agent(db, sdk_key.user_id, agent_name, model, provider)

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
            user_id=sdk_key.user_id,
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
    authorization: str = Header(...),
    db: Session = Depends(get_db),
):
    """
    Log a single LLM call manually (after the call has completed).
    Use this if you're not using the OpenLLMetry SDK.

    Example:
        response = openai_client.chat.completions.create(...)
        requests.post("/traces/log",
            headers={"Authorization": "Bearer tk_live_<your_sdk_key>"},
            json={
                "model": "openai/gpt-4o",
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "latency_ms": elapsed_ms,
                "agent_name": "my_agent",
            }
        )
    """
    sdk_key = _resolve_sdk_key(authorization, db)

    # Normalize model key
    model = payload.model
    if ":" in model and "/" not in model:
        model = model.replace(":", "/", 1)

    provider = model.split("/")[0] if "/" in model else "unknown"
    total_tokens = payload.prompt_tokens + payload.completion_tokens
    cost = calculate_cost(payload.prompt_tokens, payload.completion_tokens, model)

    agent = _upsert_agent(db, sdk_key.user_id, payload.agent_name, model, provider)

    req = Request(
        agent_id=agent.id,
        user_id=sdk_key.user_id,
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
