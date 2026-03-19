from sqlalchemy.orm import Session

from app.core.pricing import calculate_cost
from app.db.models import Request
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import BaseProvider
from app.providers.google_provider import GoogleProvider
from app.providers.openai_provider import OpenAIProvider
from app.providers.perplexity_provider import PerplexityProvider
from app.schemas.request import LogRequestInput

PROVIDER_MAP: dict[str, BaseProvider] = {
    "openai": OpenAIProvider(),
    "anthropic": AnthropicProvider(),
    "perplexity": PerplexityProvider(),
    "google": GoogleProvider(),
}


def _get_provider_name(model_key: str) -> str:
    return model_key.split("/")[0] if "/" in model_key else model_key


async def ingest_request(db: Session, payload: LogRequestInput) -> Request:
    provider_name = _get_provider_name(payload.model)
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

    record = Request(
        agent_id=payload.agent_id,
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
    )

    db.add(record)
    db.commit()
    db.refresh(record)
    return record
