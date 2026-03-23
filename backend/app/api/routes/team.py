from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.team import (
    CreateTeamRequest,
    JoinTeamRequest,
    TeamInfoResponse,
    TeamOverviewResponse,
)
from app.services.team_service import (
    create_team,
    get_team_member_count,
    get_team_overview,
    join_team,
    leave_team,
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
