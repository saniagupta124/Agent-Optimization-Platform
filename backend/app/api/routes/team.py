from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.team import (
    CreateTeamRequest,
    JoinTeamRequest,
    MemberDetailResponse,
    TeamInfoResponse,
    TeamOverviewResponse,
)
from pydantic import BaseModel


class CreateInviteRequest(BaseModel):
    expires_days: int = 14


class PreviewInviteRequest(BaseModel):
    token: str


class AcceptInviteRequest(BaseModel):
    token: str
from app.services.team_service import (
    accept_team_invite,
    create_team,
    create_team_invite,
    get_team_member_count,
    get_team_member_detail,
    get_team_overview,
    join_team,
    leave_team,
    preview_team_invite,
)

router = APIRouter(prefix="/team")


@router.post("/create", response_model=TeamInfoResponse)
def create(
    payload: CreateTeamRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must leave your current team before creating a new one",
        )
    try:
        team = create_team(db, user, payload.name, payload.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return TeamInfoResponse(
        id=team.id,
        name=team.name,
        member_count=get_team_member_count(db, team.id),
    )


@router.post("/join", response_model=TeamInfoResponse)
def join(
    payload: JoinTeamRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must leave your current team before joining another",
        )
    try:
        team = join_team(db, user, payload.name, payload.password)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        )
    return TeamInfoResponse(
        id=team.id,
        name=team.name,
        member_count=get_team_member_count(db, team.id),
    )


@router.post("/leave")
def leave(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user.team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are not in a team",
        )
    leave_team(db, user)
    return {"ok": True}


@router.post("/invites")
def create_invite(
    payload: CreateInviteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        inv = create_team_invite(db, user, expires_days=payload.expires_days)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    from app.core.config import settings
    base = settings.PUBLIC_APP_URL.rstrip("/")
    invite_url = f"{base}/join?token={inv.token}" if base else None
    return {
        "token": inv.token,
        "team_id": inv.team_id,
        "team_name": inv.team_name,
        "expires_at": inv.expires_at,
        "invite_url": invite_url,
    }


@router.post("/invites/preview")
def preview_invite(payload: PreviewInviteRequest, db: Session = Depends(get_db)):
    result = preview_team_invite(db, payload.token)
    return result


@router.post("/invites/accept")
def accept_invite(
    payload: AcceptInviteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        team = accept_team_invite(db, user, payload.token)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return TeamInfoResponse(
        id=team.id,
        name=team.name,
        member_count=get_team_member_count(db, team.id),
    )


@router.get("/members", response_model=TeamOverviewResponse)
def team_members(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    overview = get_team_overview(db, user)
    if not overview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not in a team",
        )
    return overview


@router.get("/members/{member_id}", response_model=MemberDetailResponse)
def team_member_detail(
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    detail = get_team_member_detail(db, user, member_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found or not in your team",
        )
    return detail
