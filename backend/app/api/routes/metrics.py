from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.metrics import (
    GroupedMetric,
    OutlierRecord,
    OverviewMetrics,
    TimeseriesPoint,
)
from app.services.metrics_service import (
    get_by_agent,
    get_by_customer,
    get_by_provider,
    get_outliers,
    get_overview,
    get_timeseries,
)

router = APIRouter(prefix="/metrics")


@router.get("/overview", response_model=OverviewMetrics)
def overview(
    days: int = Query(default=7, ge=1),
    agent_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_overview(db, days, user_id=user.id, agent_id=agent_id)


@router.get("/by-agent", response_model=list[GroupedMetric])
def by_agent(
    days: int = Query(default=7, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_by_agent(db, days, user_id=user.id)


@router.get("/by-customer", response_model=list[GroupedMetric])
def by_customer(
    days: int = Query(default=7, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_by_customer(db, days, user_id=user.id)


@router.get("/by-provider", response_model=list[GroupedMetric])
def by_provider(
    days: int = Query(default=7, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_by_provider(db, days, user_id=user.id)


@router.get("/outliers", response_model=list[OutlierRecord])
def outliers(
    limit: int = Query(default=20, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_outliers(db, limit, user_id=user.id)


@router.get("/timeseries", response_model=list[TimeseriesPoint])
def timeseries(
    days: int = Query(default=30, ge=1),
    agent_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_timeseries(db, days, user_id=user.id, agent_id=agent_id)
