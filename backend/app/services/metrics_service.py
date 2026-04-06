from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Agent, Request, User
from app.services.agent_service import get_agent_for_viewer
from app.schemas.metrics import (
    ApiKeyUsageRow,
    GroupedMetric,
    OutlierRecord,
    OverviewMetrics,
    TimeseriesPoint,
)
from app.services.scope import resolve_agent_ids


def _default_start(days: int = 7) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


def _visible_agent_ids(
    db: Session, user: User, scope: str, deployment: str | None = None
) -> list[str]:
    s = scope if scope in ("me", "team") else "me"
    dep = deployment if deployment in ("internal", "production") else None
    return resolve_agent_ids(db, user, s, dep)


def get_overview(
    db: Session,
    days: int = 7,
    user: User | None = None,
    agent_id: str | None = None,
    scope: str = "me",
    deployment: str | None = None,
) -> OverviewMetrics:
    since = _default_start(days)
    query = db.query(
        func.coalesce(func.sum(Request.cost_usd), 0).label("total_cost"),
        func.coalesce(func.sum(Request.total_tokens), 0).label("total_tokens"),
        func.count(Request.id).label("request_count"),
        func.coalesce(func.avg(Request.latency_ms), 0).label("avg_latency"),
    ).filter(Request.timestamp >= since)

    if agent_id:
        if not user or not get_agent_for_viewer(db, agent_id, user):
            return OverviewMetrics(
                total_cost=0, total_tokens=0, request_count=0, avg_latency=0
            )
        query = query.filter(Request.agent_id == agent_id)
    elif user:
        agent_ids = _visible_agent_ids(db, user, scope, deployment)
        if not agent_ids:
            return OverviewMetrics(
                total_cost=0, total_tokens=0, request_count=0, avg_latency=0
            )
        query = query.filter(Request.agent_id.in_(agent_ids))
    else:
        return OverviewMetrics(
            total_cost=0, total_tokens=0, request_count=0, avg_latency=0
        )

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
    agent_ids: list[str] | None = None,
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
    elif agent_ids is not None:
        if not agent_ids:
            return []
        query = query.filter(Request.agent_id.in_(agent_ids))
    else:
        return []

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
    db: Session,
    days: int = 7,
    user: User | None = None,
    scope: str = "me",
    deployment: str | None = None,
) -> list[GroupedMetric]:
    if not user:
        return []
    agent_ids = _visible_agent_ids(db, user, scope, deployment)
    return _grouped_query(db, Request.agent_id, days, agent_ids=agent_ids)


def get_by_customer(
    db: Session,
    days: int = 7,
    user: User | None = None,
    scope: str = "me",
    deployment: str | None = None,
) -> list[GroupedMetric]:
    if not user:
        return []
    agent_ids = _visible_agent_ids(db, user, scope, deployment)
    return _grouped_query(db, Request.customer_id, days, agent_ids=agent_ids)


def get_by_provider(
    db: Session,
    days: int = 7,
    user: User | None = None,
    scope: str = "me",
    deployment: str | None = None,
) -> list[GroupedMetric]:
    if not user:
        return []
    agent_ids = _visible_agent_ids(db, user, scope, deployment)
    return _grouped_query(db, Request.provider, days, agent_ids=agent_ids)


def get_outliers(
    db: Session,
    limit: int = 20,
    user: User | None = None,
    scope: str = "me",
    deployment: str | None = None,
) -> list[OutlierRecord]:
    query = db.query(Request)

    if user:
        agent_ids = _visible_agent_ids(db, user, scope, deployment)
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
    user: User | None = None,
    agent_id: str | None = None,
    scope: str = "me",
    deployment: str | None = None,
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
        if not user or not get_agent_for_viewer(db, agent_id, user):
            return []
        query = query.filter(Request.agent_id == agent_id)
    elif user:
        agent_ids = _visible_agent_ids(db, user, scope, deployment)
        if not agent_ids:
            return []
        query = query.filter(Request.agent_id.in_(agent_ids))
    else:
        return []

    rows = query.group_by(date_col).order_by(date_col).all()
    return [
        TimeseriesPoint(
            date=str(r.date),
            total_cost=round(float(r.total_cost), 4),
            total_tokens=int(r.total_tokens),
        )
        for r in rows
    ]


def get_usage_by_key(
    db: Session,
    user: User,
    days: int = 7,
    scope: str = "me",
    deployment: str | None = None,
) -> list[ApiKeyUsageRow]:
    """Per-agent totals (each agent can hold one hashed API key)."""
    agent_ids = _visible_agent_ids(db, user, scope, deployment)
    if not agent_ids:
        return []
    since = _default_start(days)
    agents = (
        db.query(Agent)
        .filter(Agent.id.in_(agent_ids))
        .order_by(Agent.name)
        .all()
    )
    out: list[ApiKeyUsageRow] = []
    for agent in agents:
        row = (
            db.query(
                func.coalesce(func.sum(Request.cost_usd), 0).label("tc"),
                func.coalesce(func.sum(Request.total_tokens), 0).label("tt"),
                func.count(Request.id).label("cnt"),
            )
            .filter(Request.agent_id == agent.id, Request.timestamp >= since)
            .one()
        )
        out.append(
            ApiKeyUsageRow(
                agent_id=agent.id,
                agent_name=agent.name,
                api_key_hint=agent.api_key_hint or "",
                total_cost=round(float(row.tc), 4),
                total_tokens=int(row.tt),
                request_count=int(row.cnt),
            )
        )
    out.sort(key=lambda r: r.total_cost, reverse=True)
    return out
