"""Resolve which agents to include for metrics (solo vs team)."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, TeamMember, User


def team_view_available(user: User) -> bool:
    """User can see team view if they belong to a team or have an org name."""
    if user.team_id:
        return True
    return bool((user.organization_name or "").strip())


def _team_user_ids(db: Session, user: User) -> list[str]:
    """User IDs in the same team (active memberships)."""
    if user.team_id:
        rows = (
            db.query(TeamMember.user_id)
            .filter(
                TeamMember.team_id == user.team_id,
                TeamMember.status == "active",
            )
            .all()
        )
        ids = [r[0] for r in rows]
        if ids:
            return ids
        # Legacy: membership row missing but user.team_id set
        return [user.id]
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


def resolve_agent_ids(
    db: Session,
    user: User,
    scope: str,
    deployment: str | None = None,
) -> list[str]:
    """scope: 'me' = only current user's agents; 'team' = all agents for team.

    deployment: optional filter on agents.deployment_environment (internal | production).
    """
    if scope != "team":
        q = db.query(Agent.id).filter(Agent.user_id == user.id)
        if deployment in ("internal", "production"):
            q = q.filter(Agent.deployment_environment == deployment)
        return [r[0] for r in q.all()]

    user_ids = _team_user_ids(db, user)
    if not user_ids:
        return []
    q = db.query(Agent.id).filter(Agent.user_id.in_(user_ids))
    if deployment in ("internal", "production"):
        q = q.filter(Agent.deployment_environment == deployment)
    rows = q.all()
    return [r[0] for r in rows]


def resolve_team_user_ids(db: Session, user: User) -> list[str]:
    """User ids that share the viewer's team."""
    return _team_user_ids(db, user)


def count_team_members(db: Session, user: User) -> int:
    if user.team_id:
        n = (
            db.query(func.count(TeamMember.id))
            .filter(
                TeamMember.team_id == user.team_id,
                TeamMember.status == "active",
            )
            .scalar()
        )
        if n:
            return int(n)
        return 1
    org = (user.organization_name or "").strip()
    if not org:
        return 1
    norm = org.lower()
    n = (
        db.query(func.count(User.id))
        .filter(
            func.lower(func.trim(User.organization_name)) == norm,
        )
        .scalar()
    )
    return int(n) if n else 1
