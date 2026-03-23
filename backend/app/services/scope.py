"""Resolve which agents to include for metrics (solo vs team)."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, User


def team_view_available(user: User) -> bool:
    """User can see team view if they belong to a team or have an org name."""
    if user.team_id:
        return True
    return bool((user.organization_name or "").strip())


def _team_user_ids(db: Session, user: User) -> list[str]:
    """Get all user IDs in the same team."""
    if user.team_id:
        rows = db.query(User.id).filter(User.team_id == user.team_id).all()
        return [r[0] for r in rows]
    # Fallback to organization_name matching
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


def resolve_agent_ids(db: Session, user: User, scope: str) -> list[str]:
    """scope: 'me' = only current user's agents; 'team' = all agents for team."""
    if scope != "team":
        rows = db.query(Agent.id).filter(Agent.user_id == user.id).all()
        return [r[0] for r in rows]

    user_ids = _team_user_ids(db, user)
    if not user_ids:
        return []
    rows = db.query(Agent.id).filter(Agent.user_id.in_(user_ids)).all()
    return [r[0] for r in rows]


def resolve_team_user_ids(db: Session, user: User) -> list[str]:
    """User ids that share the viewer's team."""
    return _team_user_ids(db, user)


def count_team_members(db: Session, user: User) -> int:
    if user.team_id:
        n = db.query(func.count(User.id)).filter(User.team_id == user.team_id).scalar()
        return int(n) if n else 1
    org = (user.organization_name or "").strip()
    if not org:
        return 1
    norm = org.lower()
    n = db.query(func.count(User.id)).filter(
        func.lower(func.trim(User.organization_name)) == norm
    ).scalar()
    return int(n) if n else 1
