import random

from sqlalchemy.orm import Session

from app.core.api_key_crypto import hash_provider_api_key
from app.core.config import settings
from app.core.pricing import calculate_cost
from app.db.models import Agent, Request, User
from app.schemas.request import LogRequestInput
from app.services.agent_service import get_agent_by_provider_and_key_hash
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import BaseProvider
from app.providers.google_provider import GoogleProvider
from app.providers.openai_provider import OpenAIProvider
from app.providers.perplexity_provider import PerplexityProvider

PROVIDER_MAP: dict[str, BaseProvider] = {
    "openai": OpenAIProvider(),
    "anthropic": AnthropicProvider(),
    "perplexity": PerplexityProvider(),
    "google": GoogleProvider(),
}


def _get_provider_name(model_key: str) -> str:
    return model_key.split("/")[0] if "/" in model_key else model_key


def _resolve_agent_id(db: Session, payload: LogRequestInput) -> str:
    provider_name = _get_provider_name(payload.model)
    if payload.api_key and payload.api_key.strip():
        h = hash_provider_api_key(provider_name, payload.api_key.strip())
        agent = get_agent_by_provider_and_key_hash(db, provider_name, h)
        if not agent:
            raise ValueError(
                "Unknown api_key for this provider — register the key on an agent first"
            )
        if payload.agent_id and payload.agent_id.strip() and payload.agent_id != agent.id:
            raise ValueError("agent_id does not match api_key")
        return agent.id
    if payload.agent_id and payload.agent_id.strip():
        return payload.agent_id.strip()
    raise ValueError("Provide agent_id or api_key")


def _agent_attribution(db: Session, agent_id: str, payload: LogRequestInput) -> tuple[Agent, str | None, str]:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise ValueError("Agent not found")
    owner = db.query(User).filter(User.id == agent.user_id).first()
    team_id = owner.team_id if owner else None
    raw_env = payload.environment or agent.deployment_environment or "production"
    env = raw_env if raw_env in ("internal", "production") else "production"
    return agent, team_id, env


async def ingest_request(db: Session, payload: LogRequestInput) -> Request:
    agent_id = _resolve_agent_id(db, payload)
    agent_row, team_id, environment = _agent_attribution(db, agent_id, payload)
    provider_name = _get_provider_name(payload.model)
    err_tail = (payload.error_detail or "")[:2000]
    route = (payload.endpoint_route or "")[:512]

    if settings.REQUIRE_REAL_USAGE:
        if payload.prompt_tokens is None or payload.completion_tokens is None:
            raise ValueError(
                "Server requires real usage: set prompt_tokens and completion_tokens "
                "(enable REQUIRE_REAL_USAGE only in production with real provider metrics)"
            )

    # If the caller provides real token usage, trust it and skip the provider simulation.
    if payload.prompt_tokens is not None and payload.completion_tokens is not None:
        prompt_tokens = payload.prompt_tokens
        completion_tokens = payload.completion_tokens
        total_tokens = (
            payload.total_tokens
            if payload.total_tokens is not None
            else prompt_tokens + completion_tokens
        )
        cost = (
            float(payload.cost_usd)
            if payload.cost_usd is not None
            else calculate_cost(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                model_key=payload.model,
            )
        )
        tool_calls = payload.tool_calls if payload.tool_calls is not None else 1
        record = Request(
            agent_id=agent_id,
            user_id=agent_row.user_id,
            team_id=team_id,
            project_id=payload.project_id,
            customer_id=payload.customer_id,
            provider=provider_name,
            model=payload.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=cost,
            latency_ms=int(payload.latency_ms) if payload.latency_ms is not None else 0,
            status=payload.status or "success",
            feature_tag=payload.feature_tag,
            tool_calls=max(0, int(tool_calls)),
            environment=environment,
            endpoint_route=route,
            error_detail=err_tail,
        )
    else:
        # Otherwise, simulate token usage via the provider abstraction.
        if not payload.messages:
            raise ValueError(
                "messages required when simulating (or send prompt_tokens + completion_tokens for real usage)"
            )
        provider = PROVIDER_MAP.get(provider_name)
        if provider is None:
            raise ValueError(f"Unsupported provider: {provider_name}")

        result = await provider.call_model(
            {"model": payload.model, "messages": payload.messages}
        )

        cost = calculate_cost(
            prompt_tokens=result["prompt_tokens"],
            completion_tokens=result["completion_tokens"],
            model_key=payload.model,
        )

        tool_calls = payload.tool_calls
        if tool_calls is None:
            tool_calls = int(result.get("tool_calls") or random.randint(1, 4))

        record = Request(
            agent_id=agent_id,
            user_id=agent_row.user_id,
            team_id=team_id,
            project_id=payload.project_id,
            customer_id=payload.customer_id,
            provider=provider_name,
            model=payload.model,
            prompt_tokens=result["prompt_tokens"],
            completion_tokens=result["completion_tokens"],
            total_tokens=result["total_tokens"],
            cost_usd=cost,
            latency_ms=result["latency_ms"],
            status=result["status"],
            feature_tag=payload.feature_tag,
            tool_calls=max(0, tool_calls),
            environment=environment,
            endpoint_route=route,
            error_detail=err_tail,
        )

    db.add(record)
    db.commit()
    db.refresh(record)
    return record
