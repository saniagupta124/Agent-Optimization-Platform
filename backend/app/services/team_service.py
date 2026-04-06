"""Team management: create, invite, join, leave, overview."""

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, Request, Team, TeamInvite, TeamMember, User
from app.schemas.team import (
    InviteCreatedResponse,
    InvitePreviewResponse,
    MemberAgentRow,
    MemberDetailResponse,
    TeamMemberRow,
    TeamOverviewResponse,
)
from app.services.auth_service import hash_password, verify_password


def _hash_invite_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _ensure_membership(
    db: Session,
    *,
    team_id: str,
    user_id: str,
    role: str,
) -> TeamMember:
    row = (
        db.query(TeamMember)
        .filter(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id,
        )
        .first()
    )
    if row:
        if row.status != "active":
            row.status = "active"
        if role == "owner":
            row.role = "owner"
        return row
    m = TeamMember(team_id=team_id, user_id=user_id, role=role, status="active")
    db.add(m)
    return m


def create_team(db: Session, user: User, name: str, password: str) -> Team:
    """Create a new team; creator becomes owner."""
    existing = db.query(Team).filter(func.lower(Team.name) == name.strip().lower()).first()
    if existing:
        raise ValueError("A team with that name already exists")

    team = Team(
        name=name.strip(),
        password_hash=hash_password(password),
        owner_user_id=user.id,
    )
    db.add(team)
    db.flush()

    user.team_id = team.id
    user.organization_name = team.name
    _ensure_membership(db, team_id=team.id, user_id=user.id, role="owner")
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
    role = "member"
    if team.owner_user_id == user.id:
        role = "owner"
    _ensure_membership(db, team_id=team.id, user_id=user.id, role=role)
    db.commit()
    db.refresh(team)
    return team


def _transfer_owner_if_needed(db: Session, team: Team, leaving_user_id: str) -> None:
    if team.owner_user_id != leaving_user_id:
        return
    other = (
        db.query(TeamMember)
        .filter(
            TeamMember.team_id == team.id,
            TeamMember.user_id != leaving_user_id,
            TeamMember.status == "active",
        )
        .order_by(TeamMember.joined_at.asc())
        .first()
    )
    if other:
        other.role = "owner"
        team.owner_user_id = other.user_id
    else:
        team.owner_user_id = None


def leave_team(db: Session, user: User) -> None:
    """Leave the current team and remove membership row."""
    if not user.team_id:
        return
    team = db.query(Team).filter(Team.id == user.team_id).first()
    if team:
        _transfer_owner_if_needed(db, team, user.id)
    db.query(TeamMember).filter(
        TeamMember.user_id == user.id,
        TeamMember.team_id == user.team_id,
    ).delete(synchronize_session=False)
    user.team_id = None
    user.organization_name = ""
    db.commit()


def get_team_member_count(db: Session, team_id: str) -> int:
    n = (
        db.query(func.count(TeamMember.id))
        .filter(TeamMember.team_id == team_id, TeamMember.status == "active")
        .scalar()
    )
    return int(n) if n else 0


def create_team_invite(
    db: Session,
    user: User,
    *,
    expires_days: int = 14,
) -> InviteCreatedResponse:
    """Owner creates a single-use invite link token."""
    if not user.team_id:
        raise ValueError("You are not in a team")
    team = db.query(Team).filter(Team.id == user.team_id).first()
    if not team:
        raise ValueError("Team not found")
    membership = (
        db.query(TeamMember)
        .filter(
            TeamMember.team_id == team.id,
            TeamMember.user_id == user.id,
            TeamMember.status == "active",
        )
        .first()
    )
    if not membership or membership.role != "owner":
        if team.owner_user_id != user.id:
            raise ValueError("Only the team owner can create invites")

    raw = secrets.token_urlsafe(32)
    th = _hash_invite_token(raw)
    now = datetime.utcnow()
    inv = TeamInvite(
        team_id=team.id,
        token_hash=th,
        created_by_user_id=user.id,
        expires_at=now + timedelta(days=max(1, min(expires_days, 90))),
    )
    db.add(inv)
    db.commit()
    return InviteCreatedResponse(
        token=raw,
        team_id=team.id,
        team_name=team.name,
        expires_at=inv.expires_at,
    )


def preview_team_invite(db: Session, raw_token: str) -> InvitePreviewResponse:
    th = _hash_invite_token(raw_token.strip())
    inv = db.query(TeamInvite).filter(TeamInvite.token_hash == th).first()
    if not inv:
        return InvitePreviewResponse(valid=False, expired=False, team_name=None, team_id=None)
    team = db.query(Team).filter(Team.id == inv.team_id).first()
    name = team.name if team else None
    now = datetime.utcnow()
    if inv.consumed_at is not None:
        return InvitePreviewResponse(valid=False, expired=True, team_name=name, team_id=inv.team_id)
    if inv.expires_at < now:
        return InvitePreviewResponse(valid=False, expired=True, team_name=name, team_id=inv.team_id)
    return InvitePreviewResponse(valid=True, expired=False, team_name=name, team_id=inv.team_id)


def accept_team_invite(db: Session, user: User, raw_token: str) -> Team:
    if user.team_id:
        raise ValueError("You must leave your current team before accepting an invite")
    th = _hash_invite_token(raw_token.strip())
    inv = db.query(TeamInvite).filter(TeamInvite.token_hash == th).first()
    if not inv or inv.consumed_at is not None:
        raise ValueError("Invalid or already used invite")
    if inv.expires_at < datetime.utcnow():
        raise ValueError("This invite has expired")
    team = db.query(Team).filter(Team.id == inv.team_id).first()
    if not team:
        raise ValueError("Team not found")

    if user.team_id == team.id:
        if inv.consumed_at is None:
            inv.consumed_at = datetime.utcnow()
            inv.consumed_by_user_id = user.id
            db.commit()
        db.refresh(team)
        return team

    user.team_id = team.id
    user.organization_name = team.name
    _ensure_membership(db, team_id=team.id, user_id=user.id, role="member")
    inv.consumed_at = datetime.utcnow()
    inv.consumed_by_user_id = user.id
    db.commit()
    db.refresh(team)
    return team


def get_team_overview(db: Session, user: User) -> TeamOverviewResponse | None:
    if not user.team_id:
        return None

    team = db.query(Team).filter(Team.id == user.team_id).first()
    if not team:
        return None

    member_rows = (
        db.query(TeamMember, User)
        .join(User, User.id == TeamMember.user_id)
        .filter(
            TeamMember.team_id == team.id,
            TeamMember.status == "active",
        )
        .all()
    )
    cutoff = datetime.utcnow() - timedelta(days=7)

    members: list[TeamMemberRow] = []
    for tm, member in member_rows:
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
                role=tm.role,
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
                deployment_environment=agent.deployment_environment,
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
