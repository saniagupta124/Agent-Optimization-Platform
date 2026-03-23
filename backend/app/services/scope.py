"""Resolve which agents to include for metrics (solo vs organization team)."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, User


def team_view_available(user: User) -> bool:
    return bool((user.organization_name or "").strip())


def resolve_agent_ids(db: Session, user: User, scope: str) -> list[str]:
    """scope: 'me' = only current user's agents; 'team' = all agents for users in same org."""
    if scope != "team":
        rows = db.query(Agent.id).filter(Agent.user_id == user.id).all()
        return [r[0] for r in rows]

    org = (user.organization_name or "").strip()
    if not org:
        rows = db.query(Agent.id).filter(Agent.user_id == user.id).all()
        return [r[0] for r in rows]

    norm = org.lower()
    user_ids = [
        r[0]
        for r in db.query(User.id)
        .filter(func.lower(func.trim(User.organization_name)) == norm)
        .all()
    ]
    if not user_ids:
        return []
    rows = db.query(Agent.id).filter(Agent.user_id.in_(user_ids)).all()
    return [r[0] for r in rows]


def resolve_team_user_ids(db: Session, user: User) -> list[str]:
    """User ids that share the viewer's organization (or [self] if no org)."""
    org = (user.organization_name or "").strip()
    if not org:
        return [user.id]
    norm = org.lower()
    rows = (
        db.query(User.id)
        .filter(func.lower(func.trim(User.organization_name)) == norm)
        .all()
    )
    return [r[0] for r in rows]


def count_team_members(db: Session, user: User) -> int:
    org = (user.organization_name or "").strip()
    if not org:
        return 1
    norm = org.lower()
    n = db.query(func.count(User.id)).filter(
        func.lower(func.trim(User.organization_name)) == norm
    ).scalar()
    return int(n) if n else 1
