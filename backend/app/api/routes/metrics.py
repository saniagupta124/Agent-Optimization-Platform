from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.metrics import (
    ApiKeyUsageRow,
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
    get_usage_by_key,
)

router = APIRouter(prefix="/metrics")


def _deployment(d: str | None) -> str | None:
    return d if d in ("internal", "production") else None


@router.get("/overview", response_model=OverviewMetrics)
def overview(
    days: int = Query(default=7, ge=1),
    agent_id: str | None = Query(default=None),
    scope: str = Query(default="me", description="me | team"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_overview(
        db, days, user=user, agent_id=agent_id, scope=scope, deployment=_deployment(deployment)
    )


@router.get("/by-agent", response_model=list[GroupedMetric])
def by_agent(
    days: int = Query(default=7, ge=1),
    scope: str = Query(default="me", description="me | team"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_by_agent(db, days, user=user, scope=scope, deployment=_deployment(deployment))


@router.get("/by-customer", response_model=list[GroupedMetric])
def by_customer(
    days: int = Query(default=7, ge=1),
    scope: str = Query(default="me", description="me | team"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_by_customer(db, days, user=user, scope=scope, deployment=_deployment(deployment))


@router.get("/by-provider", response_model=list[GroupedMetric])
def by_provider(
    days: int = Query(default=7, ge=1),
    scope: str = Query(default="me", description="me | team"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_by_provider(db, days, user=user, scope=scope, deployment=_deployment(deployment))


@router.get("/outliers", response_model=list[OutlierRecord])
def outliers(
    limit: int = Query(default=20, ge=1),
    scope: str = Query(default="me", description="me | team"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_outliers(db, limit, user=user, scope=scope, deployment=_deployment(deployment))


@router.get("/usage-by-key", response_model=list[ApiKeyUsageRow])
def usage_by_key(
    days: int = Query(default=7, ge=1),
    scope: str = Query(default="me", description="me | team"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_usage_by_key(
        db, user, days=days, scope=scope, deployment=_deployment(deployment)
    )


@router.get("/timeseries", response_model=list[TimeseriesPoint])
def timeseries(
    days: int = Query(default=30, ge=1),
    agent_id: str | None = Query(default=None),
    scope: str = Query(default="me", description="me | team"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_timeseries(
        db,
        days,
        user=user,
        agent_id=agent_id,
        scope=scope,
        deployment=_deployment(deployment),
    )
