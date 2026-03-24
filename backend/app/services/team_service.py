"""Team management: create, join, leave, overview."""

from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, Request, Team, User
from app.schemas.team import MemberAgentRow, MemberDetailResponse, TeamMemberRow, TeamOverviewResponse
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


def get_team_member_detail(
    db: Session, requesting_user: User, member_id: str
) -> MemberDetailResponse | None:
    """Return detailed agent/usage stats for a specific team member."""
    if not requesting_user.team_id:
        return None

    member = db.query(User).filter(
        User.id == member_id,
        User.team_id == requesting_user.team_id,
    ).first()
    if not member:
        return None

    agents = db.query(Agent).filter(Agent.user_id == member.id).all()
    cutoff_7d = datetime.utcnow() - timedelta(days=7)
    cutoff_30d = datetime.utcnow() - timedelta(days=30)

    agent_rows: list[MemberAgentRow] = []
    for agent in agents:
        row_7d = (
            db.query(
                func.coalesce(func.sum(Request.cost_usd), 0.0),
                func.count(Request.id),
                func.coalesce(func.avg(Request.total_tokens), 0.0),
            )
            .filter(Request.agent_id == agent.id, Request.timestamp >= cutoff_7d)
            .first()
        )
        row_30d = (
            db.query(
                func.coalesce(func.sum(Request.cost_usd), 0.0),
                func.count(Request.id),
            )
            .filter(Request.agent_id == agent.id, Request.timestamp >= cutoff_30d)
            .first()
        )
        agent_rows.append(
            MemberAgentRow(
                id=agent.id,
                name=agent.name,
                purpose=agent.purpose or "",
                model=agent.model,
                provider=agent.provider,
                cost_7d=round(float(row_7d[0]), 4) if row_7d else 0.0,
                requests_7d=int(row_7d[1]) if row_7d else 0,
                avg_tokens_7d=round(float(row_7d[2]), 0) if row_7d else 0.0,
                cost_30d=round(float(row_30d[0]), 4) if row_30d else 0.0,
                requests_30d=int(row_30d[1]) if row_30d else 0,
            )
        )

    agent_rows.sort(key=lambda a: a.cost_7d, reverse=True)

    return MemberDetailResponse(
        id=member.id,
        name=member.name,
        email=member.email,
        plan_tier=member.plan_tier,
        agent_count=len(agent_rows),
        total_cost_7d=round(sum(a.cost_7d for a in agent_rows), 4),
        total_requests_7d=sum(a.requests_7d for a in agent_rows),
        total_cost_30d=round(sum(a.cost_30d for a in agent_rows), 4),
        total_requests_30d=sum(a.requests_30d for a in agent_rows),
        agents=agent_rows,
    )
