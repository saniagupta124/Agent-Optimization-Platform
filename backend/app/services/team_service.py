"""Team management: create, join, leave, overview."""

from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, Request, Team, User
from app.schemas.team import TeamMemberRow, TeamOverviewResponse
from app.services.auth_service import hash_password, verify_password


def create_team(db: Session, user: User, name: str, password: str) -> Team:
    """Create a new team and add the creator as the first member."""
    existing = db.query(Team).filter(func.lower(Team.name) == name.strip().lower()).first()
    if existing:
        raise ValueError("A team with that name already exists")

    team = Team(
        name=name.strip(),
        password_hash=hash_password(password),
    )
    db.add(team)
    db.flush()

    user.team_id = team.id
    user.organization_name = team.name
    db.commit()
    db.refresh(team)
    return team


def join_team(db: Session, user: User, name: str, password: str) -> Team:
    """Join an existing team by name + password."""
    team = db.query(Team).filter(func.lower(Team.name) == name.strip().lower()).first()
    if not team:
        raise ValueError("Team not found")

    if not verify_password(password, team.password_hash):
        raise ValueError("Incorrect team password")

    user.team_id = team.id
    user.organization_name = team.name
    db.commit()
    db.refresh(team)
    return team


def leave_team(db: Session, user: User) -> None:
    """Leave the current team."""
    user.team_id = None
    user.organization_name = ""
    db.commit()


def get_team_member_count(db: Session, team_id: str) -> int:
    n = db.query(func.count(User.id)).filter(User.team_id == team_id).scalar()
    return int(n) if n else 0


def get_team_overview(db: Session, user: User) -> TeamOverviewResponse | None:
    if not user.team_id:
        return None

    team = db.query(Team).filter(Team.id == user.team_id).first()
    if not team:
        return None

    team_users = db.query(User).filter(User.team_id == team.id).all()
    cutoff = datetime.utcnow() - timedelta(days=7)

    members: list[TeamMemberRow] = []
    for member in team_users:
        agent_ids = [
            r[0] for r in db.query(Agent.id).filter(Agent.user_id == member.id).all()
        ]
        agent_count = len(agent_ids)

        total_cost = 0.0
        total_requests = 0
        if agent_ids:
            row = (
                db.query(
                    func.coalesce(func.sum(Request.cost_usd), 0.0),
                    func.count(Request.id),
                )
                .filter(
                    Request.agent_id.in_(agent_ids),
                    Request.timestamp >= cutoff,
                )
                .first()
            )
            if row:
                total_cost = float(row[0])
                total_requests = int(row[1])

        members.append(
            TeamMemberRow(
                id=member.id,
                name=member.name,
                email=member.email,
                agent_count=agent_count,
                total_cost_7d=round(total_cost, 4),
                total_requests_7d=total_requests,
                plan_tier=member.plan_tier,
            )
        )

    members.sort(key=lambda m: m.total_cost_7d, reverse=True)

    return TeamOverviewResponse(
        team_name=team.name,
        team_id=team.id,
        members=members,
    )
