from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.usage import (
    UsageBreakdownResponse,
    UsageSummaryResponse,
    UsageTimelineResponse,
)
from app.services.usage_service import (
    get_usage_breakdown,
    get_usage_summary,
    get_usage_timeline,
)

router = APIRouter(prefix="/usage")


@router.get("/summary", response_model=UsageSummaryResponse)
def summary(
    days: int = Query(default=7, ge=1, le=90, description="Comparison window length"),
    scope: str = Query(
        default="me",
        description="'me' = your agents only; 'team' = all agents in your organization",
    ),
    deployment: str | None = Query(
        default=None,
        description="Optional: internal | production — filter by agent deployment tag",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if scope not in ("me", "team"):
        scope = "me"
    dep = deployment if deployment in ("internal", "production") else None
    return get_usage_summary(db, user, period_days=days, scope=scope, deployment=dep)


@router.get("/breakdown", response_model=UsageBreakdownResponse)
def breakdown(
    days: int = Query(default=7, ge=1, le=90),
    scope: str = Query(default="me"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if scope not in ("me", "team"):
        scope = "me"
    dep = deployment if deployment in ("internal", "production") else None
    return get_usage_breakdown(db, user, period_days=days, scope=scope, deployment=dep)


@router.get("/timeline", response_model=UsageTimelineResponse)
def timeline(
    days: int = Query(default=14, ge=1, le=90),
    scope: str = Query(default="me"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if scope not in ("me", "team"):
        scope = "me"
    dep = deployment if deployment in ("internal", "production") else None
    return get_usage_timeline(db, user, period_days=days, scope=scope, deployment=dep)
