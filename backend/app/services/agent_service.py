from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, Request, User


def create_agent(
    db: Session,
    user_id: str,
    name: str,
    purpose: str,
    provider: str,
    model: str,
    api_key_hint: str = "",
) -> Agent:
    agent = Agent(
        user_id=user_id,
        name=name,
        purpose=purpose,
        provider=provider,
        model=model,
        api_key_hint=api_key_hint,
    )
    db.add(agent)
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
    """Owner always; teammates with same organization_name may view."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        return None
    if agent.user_id == viewer.id:
        return agent
    owner = db.query(User).filter(User.id == agent.user_id).first()
    if not owner:
        return None
    vo = (viewer.organization_name or "").strip().lower()
    oo = (owner.organization_name or "").strip().lower()
    if vo and oo and vo == oo:
        return agent
    return None


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
