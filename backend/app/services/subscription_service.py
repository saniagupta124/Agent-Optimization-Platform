from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.plans import limits_for_tier
from app.db.models import Request, User
from app.schemas.subscription import SubscriptionUsageResponse, UsageBreakdown
from app.services.scope import count_team_members, resolve_agent_ids, team_view_available


def _month_window_utc(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Return [month_start, next_month_start) in UTC for filtering."""
    now = now or datetime.utcnow()
    start = datetime(now.year, now.month, 1)
    if now.month == 12:
        next_start = datetime(now.year + 1, 1, 1)
    else:
        next_start = datetime(now.year, now.month + 1, 1)
    return start, next_start


def get_subscription_usage(
    db: Session, user: User, scope: str = "me"
) -> SubscriptionUsageResponse:
    if scope not in ("me", "team"):
        scope = "me"
    limits = limits_for_tier(user.plan_tier)
    start, next_start = _month_window_utc()
    agent_ids = resolve_agent_ids(db, user, scope)

    period_end_day = (next_start - timedelta(days=1)).date()

    team_agg = scope == "team" and team_view_available(user) and count_team_members(db, user) > 1

    empty = SubscriptionUsageResponse(
        scope=scope,
        is_team_aggregate=team_agg,
        plan_tier=user.plan_tier,
        monthly_token_budget=limits["monthly_token_budget"],
        monthly_cost_budget_usd=limits["monthly_cost_budget_usd"],
        tokens_used=0,
        cost_usd=0.0,
        period_start=start.date().isoformat(),
        period_end=period_end_day.isoformat(),
        token_utilization=0.0,
        cost_utilization=0.0,
        by_provider=[],
        by_model=[],
    )

    if not agent_ids:
        return empty

    totals = (
        db.query(
            func.coalesce(func.sum(Request.total_tokens), 0).label("tokens"),
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= start,
            Request.timestamp < next_start,
        )
        .one()
    )
    tokens_used = int(totals.tokens)
    cost_usd = float(totals.cost)

    tok_budget = limits["monthly_token_budget"]
    cost_budget = limits["monthly_cost_budget_usd"]
    token_util = (tokens_used / tok_budget * 100) if tok_budget else 0.0
    cost_util = (cost_usd / cost_budget * 100) if cost_budget else 0.0

    prov_rows = (
        db.query(
            Request.provider.label("label"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tokens"),
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= start,
            Request.timestamp < next_start,
        )
        .group_by(Request.provider)
        .order_by(func.sum(Request.cost_usd).desc())
        .all()
    )
    by_provider = [
        UsageBreakdown(
            label=r.label,
            total_tokens=int(r.tokens),
            total_cost_usd=float(r.cost),
        )
        for r in prov_rows
    ]

    model_rows = (
        db.query(
            Request.model.label("label"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tokens"),
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= start,
            Request.timestamp < next_start,
        )
        .group_by(Request.model)
        .order_by(func.sum(Request.cost_usd).desc())
        .all()
    )
    by_model = [
        UsageBreakdown(
            label=r.label,
            total_tokens=int(r.tokens),
            total_cost_usd=float(r.cost),
        )
        for r in model_rows
    ]

    return SubscriptionUsageResponse(
        scope=scope,
        is_team_aggregate=team_agg,
        plan_tier=user.plan_tier,
        monthly_token_budget=tok_budget,
        monthly_cost_budget_usd=cost_budget,
        tokens_used=tokens_used,
        cost_usd=round(cost_usd, 4),
        period_start=start.date().isoformat(),
        period_end=period_end_day.isoformat(),
        token_utilization=round(token_util, 2),
        cost_utilization=round(cost_util, 2),
        by_provider=by_provider,
        by_model=by_model,
    )
