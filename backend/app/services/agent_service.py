from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.api_key_crypto import hash_provider_api_key, hint_from_key
from app.db.models import Agent, Request, User


def create_agent(
    db: Session,
    user_id: str,
    name: str,
    purpose: str,
    provider: str,
    model: str,
    api_key_hint: str = "",
    api_key: str | None = None,
    deployment_environment: str = "production",
    system_prompt: str | None = None,
    max_tokens: int | None = None,
) -> Agent:
    key_hash: str | None = None
    hint = api_key_hint
    if api_key and api_key.strip():
        key_hash = hash_provider_api_key(provider, api_key.strip())
        dup = db.query(Agent).filter(Agent.api_key_hash == key_hash).first()
        if dup:
            raise ValueError("This API key is already registered to another agent")
        hint = hint_from_key(api_key)

    dep = deployment_environment if deployment_environment in ("internal", "production") else "production"
    agent = Agent(
        user_id=user_id,
        name=name,
        purpose=purpose,
        provider=provider,
        model=model,
        api_key_hint=hint,
        api_key_hash=key_hash,
        deployment_environment=dep,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def update_agent(
    db: Session,
    agent: Agent,
    *,
    name: str | None = None,
    purpose: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    deployment_environment: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
) -> Agent:
    if name is not None:
        agent.name = name
    if purpose is not None:
        agent.purpose = purpose
    if provider is not None:
        agent.provider = provider
    if model is not None:
        agent.model = model
    if deployment_environment is not None:
        agent.deployment_environment = (
            deployment_environment
            if deployment_environment in ("internal", "production")
            else agent.deployment_environment
        )
    if api_key is not None and api_key.strip():
        prov = agent.provider
        key_hash = hash_provider_api_key(prov, api_key.strip())
        dup = (
            db.query(Agent)
            .filter(Agent.api_key_hash == key_hash, Agent.id != agent.id)
            .first()
        )
        if dup:
            raise ValueError("This API key is already registered to another agent")
        agent.api_key_hash = key_hash
        agent.api_key_hint = hint_from_key(api_key)
    if system_prompt is not None:
        agent.system_prompt = system_prompt
    if max_tokens is not None:
        agent.max_tokens = max_tokens
    db.commit()
    db.refresh(agent)
    return agent


def get_user_agents(db: Session, user_id: str) -> list[Agent]:
    return (
        db.query(Agent)
        .filter(Agent.user_id == user_id)
        .order_by(Agent.created_at.desc())
        .all()
    )


def get_agents_for_users(db: Session, user_ids: list[str]) -> list[Agent]:
    if not user_ids:
        return []
    return (
        db.query(Agent)
        .filter(Agent.user_id.in_(user_ids))
        .order_by(Agent.created_at.desc())
        .all()
    )


def get_agent_for_viewer(db: Session, agent_id: str, viewer: User) -> Agent | None:
    """Owner always; teammates with same team_id or organization_name may view."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        return None
    if agent.user_id == viewer.id:
        return agent
    owner = db.query(User).filter(User.id == agent.user_id).first()
    if not owner:
        return None
    if viewer.team_id and owner.team_id and viewer.team_id == owner.team_id:
        return agent
    vo = (viewer.organization_name or "").strip().lower()
    oo = (owner.organization_name or "").strip().lower()
    if vo and oo and vo == oo:
        return agent
    return None


def get_agent_by_provider_and_key_hash(
    db: Session, provider: str, key_hash: str
) -> Agent | None:
    return (
        db.query(Agent)
        .filter(Agent.api_key_hash == key_hash, Agent.provider == provider)
        .first()
    )


def get_agent(db: Session, agent_id: str, user_id: str) -> Agent | None:
    return (
        db.query(Agent)
        .filter(Agent.id == agent_id, Agent.user_id == user_id)
        .first()
    )


def delete_agent(db: Session, agent_id: str, user_id: str) -> bool:
    agent = get_agent(db, agent_id, user_id)
    if not agent:
        return False
    db.delete(agent)
    db.commit()
    return True


def get_agent_stats_7d(db: Session, agent_id: str) -> dict:
    since = datetime.utcnow() - timedelta(days=7)
    result = (
        db.query(
            func.coalesce(func.sum(Request.cost_usd), 0).label("total_cost"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("total_tokens"),
            func.count(Request.id).label("request_count"),
        )
        .filter(Request.agent_id == agent_id, Request.timestamp >= since)
        .one()
    )
    return {
        "total_cost_7d": float(result.total_cost),
        "total_tokens_7d": int(result.total_tokens),
        "request_count_7d": int(result.request_count),
    }
