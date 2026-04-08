"""SDK-facing ingestion endpoint — auth via X-Traeco-Key header."""

import hashlib
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.pricing import calculate_cost
from app.db.models import Agent, Request, SdkApiKey, User
from app.db.session import get_db

router = APIRouter(prefix="/ingest", tags=["ingest"])


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _resolve_user(db: Session, traeco_key: str) -> User:
    h = _hash_key(traeco_key)
    row = db.query(SdkApiKey).filter(SdkApiKey.key_hash == h).first()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid Traeco API key")
    row.last_used_at = datetime.utcnow()
    db.commit()
    user = db.query(User).filter(User.id == row.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def _get_or_create_agent(db: Session, user: User, agent_name: str, provider: str, model: str) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id, Agent.name == agent_name).first()
    if not agent:
        agent = Agent(
            id=str(uuid.uuid4()),
            user_id=user.id,
            name=agent_name,
            purpose="Auto-registered via SDK",
            provider=provider,
            model=model,
            deployment_environment="production",
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
    return agent


class SdkTraceIn(BaseModel):
    agent_name: str = "default"
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int = 0
    feature_tag: str = ""
    endpoint_route: str = ""
    status: str = "success"
    cost_usd: float | None = None
    environment: str = "production"


class SdkTraceOut(BaseModel):
    id: str
    agent_id: str
    cost_usd: float
    total_tokens: int


@router.post("", response_model=SdkTraceOut)
def ingest_trace(
    payload: SdkTraceIn,
    x_traeco_key: str = Header(..., alias="X-Traeco-Key"),
    db: Session = Depends(get_db),
):
    user = _resolve_user(db, x_traeco_key)
    total_tokens = payload.prompt_tokens + payload.completion_tokens
    cost = (
        float(payload.cost_usd)
        if payload.cost_usd is not None
        else calculate_cost(
            prompt_tokens=payload.prompt_tokens,
            completion_tokens=payload.completion_tokens,
            model_key=payload.model,
        )
    )
    agent = _get_or_create_agent(db, user, payload.agent_name, payload.provider, payload.model)
    record = Request(
        id=str(uuid.uuid4()),
        agent_id=agent.id,
        user_id=user.id,
        team_id=user.team_id,
        customer_id="",
        provider=payload.provider,
        model=payload.model,
        prompt_tokens=payload.prompt_tokens,
        completion_tokens=payload.completion_tokens,
        total_tokens=total_tokens,
        cost_usd=cost,
        latency_ms=payload.latency_ms,
        status=payload.status,
        feature_tag=payload.feature_tag,
        environment=payload.environment,
        endpoint_route=payload.endpoint_route,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return SdkTraceOut(id=record.id, agent_id=agent.id, cost_usd=record.cost_usd, total_tokens=record.total_tokens)
