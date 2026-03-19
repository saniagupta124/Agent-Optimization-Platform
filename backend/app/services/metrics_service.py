from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, Request
from app.schemas.metrics import (
    GroupedMetric,
    OutlierRecord,
    OverviewMetrics,
    TimeseriesPoint,
)


def _default_start(days: int = 7) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


def _user_agent_ids(db: Session, user_id: str) -> list[str]:
    rows = db.query(Agent.id).filter(Agent.user_id == user_id).all()
    return [r.id for r in rows]


def get_overview(
    db: Session,
    days: int = 7,
    user_id: str | None = None,
    agent_id: str | None = None,
) -> OverviewMetrics:
    since = _default_start(days)
    query = db.query(
        func.coalesce(func.sum(Request.cost_usd), 0).label("total_cost"),
        func.coalesce(func.sum(Request.total_tokens), 0).label("total_tokens"),
        func.count(Request.id).label("request_count"),
        func.coalesce(func.avg(Request.latency_ms), 0).label("avg_latency"),
    ).filter(Request.timestamp >= since)

    if agent_id:
        query = query.filter(Request.agent_id == agent_id)
    elif user_id:
        agent_ids = _user_agent_ids(db, user_id)
        if not agent_ids:
            return OverviewMetrics(
                total_cost=0, total_tokens=0, request_count=0, avg_latency=0
            )
        query = query.filter(Request.agent_id.in_(agent_ids))

    rows = query.one()
    return OverviewMetrics(
        total_cost=float(rows.total_cost),
        total_tokens=int(rows.total_tokens),
        request_count=int(rows.request_count),
        avg_latency=round(float(rows.avg_latency), 1),
    )


def _grouped_query(
    db: Session,
    group_col,
    days: int = 7,
    user_id: str | None = None,
    agent_id: str | None = None,
) -> list[GroupedMetric]:
    since = _default_start(days)
    query = (
        db.query(
            group_col.label("group"),
            func.sum(Request.cost_usd).label("total_cost"),
            func.sum(Request.total_tokens).label("total_tokens"),
            func.count(Request.id).label("request_count"),
        )
        .filter(Request.timestamp >= since)
    )

    if agent_id:
        query = query.filter(Request.agent_id == agent_id)
    elif user_id:
        agent_ids = _user_agent_ids(db, user_id)
        if not agent_ids:
            return []
        query = query.filter(Request.agent_id.in_(agent_ids))

    rows = (
        query.group_by(group_col)
        .order_by(func.sum(Request.cost_usd).desc())
        .all()
    )
    return [
        GroupedMetric(
            group=r.group,
            total_cost=float(r.total_cost),
            total_tokens=int(r.total_tokens),
            request_count=int(r.request_count),
        )
        for r in rows
    ]


def get_by_agent(
    db: Session, days: int = 7, user_id: str | None = None
) -> list[GroupedMetric]:
    return _grouped_query(db, Request.agent_id, days, user_id=user_id)


def get_by_customer(
    db: Session, days: int = 7, user_id: str | None = None
) -> list[GroupedMetric]:
    return _grouped_query(db, Request.customer_id, days, user_id=user_id)


def get_by_provider(
    db: Session, days: int = 7, user_id: str | None = None
) -> list[GroupedMetric]:
    return _grouped_query(db, Request.provider, days, user_id=user_id)


def get_outliers(
    db: Session, limit: int = 20, user_id: str | None = None
) -> list[OutlierRecord]:
    query = db.query(Request)

    if user_id:
        agent_ids = _user_agent_ids(db, user_id)
        if not agent_ids:
            return []
        query = query.filter(Request.agent_id.in_(agent_ids))

    rows = query.order_by(Request.cost_usd.desc()).limit(limit).all()
    return [
        OutlierRecord(
            id=r.id,
            timestamp=r.timestamp,
            agent_id=r.agent_id,
            customer_id=r.customer_id,
            provider=r.provider,
            model=r.model,
            total_tokens=r.total_tokens,
            cost_usd=r.cost_usd,
            latency_ms=r.latency_ms,
        )
        for r in rows
    ]


def get_timeseries(
    db: Session,
    days: int = 30,
    user_id: str | None = None,
    agent_id: str | None = None,
) -> list[TimeseriesPoint]:
    since = _default_start(days)
    date_col = func.date(Request.timestamp).label("date")
    query = (
        db.query(
            date_col,
            func.sum(Request.cost_usd).label("total_cost"),
            func.sum(Request.total_tokens).label("total_tokens"),
        )
        .filter(Request.timestamp >= since)
    )

    if agent_id:
        query = query.filter(Request.agent_id == agent_id)
    elif user_id:
        agent_ids = _user_agent_ids(db, user_id)
        if not agent_ids:
            return []
        query = query.filter(Request.agent_id.in_(agent_ids))

    rows = query.group_by(date_col).order_by(date_col).all()
    return [
        TimeseriesPoint(
            date=str(r.date),
            total_cost=round(float(r.total_cost), 4),
            total_tokens=int(r.total_tokens),
        )
        for r in rows
    ]
