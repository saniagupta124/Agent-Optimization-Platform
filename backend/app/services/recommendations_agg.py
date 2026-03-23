"""Aggregate optimization recommendations across agents for the dashboard."""

from sqlalchemy.orm import Session

from app.db.models import Agent
from app.services.optimization_service import get_optimizations
from app.services.scope import resolve_agent_ids


def get_top_recommendations_for_scope(
    db: Session,
    user: User,
    scope: str,
    limit: int = 3,
) -> tuple[float, list[dict]]:
    """
    Returns (sum of estimated_savings for top `limit` recs, full list for those recs).
    Each dict includes agent_id, agent_name plus optimization fields.
    """
    agent_ids = resolve_agent_ids(db, user, scope)
    if not agent_ids:
        return 0.0, []

    agents = db.query(Agent).filter(Agent.id.in_(agent_ids)).all()
    combined: list[dict] = []
    for agent in agents:
        opt = get_optimizations(db, agent)
        for rec in opt.get("recommendations", []):
            combined.append(
                {
                    **rec,
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                }
            )

    combined.sort(key=lambda x: -float(x.get("estimated_savings_usd", 0)))
    top = combined[:limit]
    total = sum(float(r.get("estimated_savings_usd", 0)) for r in top)
    return round(total, 2), top
