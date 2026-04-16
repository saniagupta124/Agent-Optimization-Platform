"""Aggregated usage for dashboard: summary, behavioral comparison, insights."""

from datetime import datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.plans import limits_for_user
from app.db.models import Agent, Request, User
from app.schemas.usage import (
    BehavioralComparison,
    BreakdownRow,
    TopChangeItem,
    UsageBreakdownResponse,
    UsageSummaryResponse,
    UsageTimelineResponse,
    TimelinePoint,
)
from app.services.recommendations_agg import get_top_recommendations_for_scope
from app.services.scope import count_team_members, resolve_agent_ids, team_view_available


def _month_window_utc(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or datetime.utcnow()
    start = datetime(now.year, now.month, 1)
    if now.month == 12:
        next_start = datetime(now.year + 1, 1, 1)
    else:
        next_start = datetime(now.year, now.month + 1, 1)
    return start, next_start


def _window_aggregate(
    db: Session,
    agent_ids: list[str],
    start: datetime,
    end: datetime,
) -> dict:
    if not agent_ids:
        return {
            "total_cost": 0.0,
            "total_tokens": 0,
            "count": 0,
            "total_tool_calls": 0,
            "avg_latency": 0.0,
            "success_count": 0,
        }
    row = (
        db.query(
            func.coalesce(func.sum(Request.cost_usd), 0).label("tc"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tt"),
            func.count(Request.id).label("cnt"),
            func.coalesce(func.sum(Request.tool_calls), 0).label("tools"),
            func.coalesce(func.avg(Request.latency_ms), 0).label("lat"),
            func.coalesce(
                func.sum(case((Request.status == "success", 1), else_=0)), 0
            ).label("ok"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= start,
            Request.timestamp < end,
        )
        .one()
    )
    return {
        "total_cost": float(row.tc),
        "total_tokens": int(row.tt),
        "count": int(row.cnt),
        "total_tool_calls": int(row.tools),
        "avg_latency": float(row.lat),
        "success_count": int(row.ok),
    }


def _pct_change(before: float, after: float) -> float:
    if before == 0:
        return 100.0 if after > 0 else 0.0
    return (after - before) / before * 100.0


def _build_insights(
    cur: dict,
    prev: dict,
    cost_change_pct: float | None,
) -> list[str]:
    out: list[str] = []
    if cur["count"] == 0:
        out.append("No requests in this period. Add agents or send traffic to see trends.")
        return out
    if prev["count"] == 0:
        out.append("Activity started this period; compare again after the next window.")
        return out

    if cost_change_pct is not None:
        if cost_change_pct > 15:
            out.append(
                f"Spend is up about {cost_change_pct:.0f}% vs the prior period. Review model mix and volume."
            )
        elif cost_change_pct < -15:
            out.append(
                f"Spend is down about {abs(cost_change_pct):.0f}% vs the prior period."
            )

    tok_ch = _pct_change(
        prev["total_tokens"] / max(prev["count"], 1),
        cur["total_tokens"] / max(cur["count"], 1),
    )
    if cost_change_pct is not None and cost_change_pct > 10 and tok_ch > 10:
        out.append("Higher cost aligns with higher average tokens per request.")

    tc_ch = _pct_change(
        prev["total_tool_calls"] / max(prev["count"], 1),
        cur["total_tool_calls"] / max(cur["count"], 1),
    )
    if abs(tc_ch) > 20:
        out.append(
            f"Tool calls per request shifted about {tc_ch:+.0f}%. Check agent or routing changes."
        )

    stab = cur["success_count"] / max(cur["count"], 1) * 100
    if stab < 95:
        out.append(f"Success rate is {stab:.1f}%. Investigate errors and timeouts.")

    lat_ch = _pct_change(prev["avg_latency"], cur["avg_latency"])
    if abs(lat_ch) > 15 and cur["count"] > 20:
        out.append(
            f"Average latency moved about {lat_ch:+.0f}% between periods."
        )

    return out[:6]


def get_usage_summary(
    db: Session,
    user: User,
    period_days: int = 7,
    scope: str = "me",
    deployment: str | None = None,
) -> UsageSummaryResponse:
    if scope not in ("me", "team"):
        scope = "me"
    if deployment is not None and deployment not in ("internal", "production"):
        deployment = None
    limits = limits_for_user(
        user.plan_tier,
        monthly_token_budget_override=user.monthly_token_budget_override,
        monthly_cost_budget_usd_override=user.monthly_cost_budget_usd_override,
    )
    agent_ids = resolve_agent_ids(db, user, scope, deployment)
    t_avail = team_view_available(user)
    t_members = count_team_members(db, user) if scope == "team" else 1

    potential_savings, raw_recs = get_top_recommendations_for_scope(
        db,
        user,
        scope,
        limit=3,
        period_days=period_days,
        deployment=deployment,
    )
    top_changes = [
        TopChangeItem(
            rank=i + 1,
            title=r["title"],
            description=r["description"],
            action=r["action"],
            estimated_savings_usd=float(r["estimated_savings_usd"]),
            severity=r.get("severity", "medium"),
            type=r.get("type", "general"),
            agent_id=r["agent_id"],
            agent_name=r["agent_name"],
        )
        for i, r in enumerate(raw_recs)
    ]
    now = datetime.utcnow()

    cur_start = now - timedelta(days=period_days)
    prev_start = now - timedelta(days=2 * period_days)
    prev_end = cur_start

    cur = _window_aggregate(db, agent_ids, cur_start, now)
    prev = _window_aggregate(db, agent_ids, prev_start, prev_end)

    cost_change_pct: float | None = None
    if prev["total_cost"] > 0:
        cost_change_pct = round(_pct_change(prev["total_cost"], cur["total_cost"]), 2)
    elif cur["total_cost"] > 0:
        cost_change_pct = None

    avg_tokens = cur["total_tokens"] / cur["count"] if cur["count"] else 0.0
    avg_tools = cur["total_tool_calls"] / cur["count"] if cur["count"] else 0.0
    stability = (
        (cur["success_count"] / cur["count"] * 100) if cur["count"] else 100.0
    )

    m_start, m_next = _month_window_utc(now)
    month_stats = _window_aggregate(db, agent_ids, m_start, m_next)
    tok_budget = limits["monthly_token_budget"]
    cost_budget = limits["monthly_cost_budget_usd"]
    tok_util = (
        (month_stats["total_tokens"] / tok_budget * 100) if tok_budget else 0.0
    )
    cost_util = (
        (month_stats["total_cost"] / cost_budget * 100) if cost_budget else 0.0
    )

    def _avg_tokens(d: dict) -> float:
        return d["total_tokens"] / d["count"] if d["count"] else 0.0

    def _avg_tools(d: dict) -> float:
        return d["total_tool_calls"] / d["count"] if d["count"] else 0.0

    def _cpr(d: dict) -> float:
        return d["total_cost"] / d["count"] if d["count"] else 0.0

    behavioral = BehavioralComparison(
        window_days=period_days,
        before_period_label=f"Prior {period_days}d",
        after_period_label=f"Last {period_days}d",
        avg_tokens_before=round(_avg_tokens(prev), 2),
        avg_tokens_after=round(_avg_tokens(cur), 2),
        tokens_pct_change=round(_pct_change(_avg_tokens(prev), _avg_tokens(cur)), 2),
        avg_tool_calls_before=round(_avg_tools(prev), 3),
        avg_tool_calls_after=round(_avg_tools(cur), 3),
        tool_calls_pct_change=round(
            _pct_change(_avg_tools(prev), _avg_tools(cur)), 2
        ),
        avg_latency_ms_before=round(prev["avg_latency"], 1),
        avg_latency_ms_after=round(cur["avg_latency"], 1),
        latency_pct_change=round(
            _pct_change(prev["avg_latency"], cur["avg_latency"]), 2
        ),
        cost_per_request_before=round(_cpr(prev), 6),
        cost_per_request_after=round(_cpr(cur), 6),
        cost_per_request_pct_change=round(_pct_change(_cpr(prev), _cpr(cur)), 2),
    )

    rule_insights = _build_insights(cur, prev, cost_change_pct)
    rec_insights = [
        f"{r['title']} (~${float(r['estimated_savings_usd']):.0f} est. savings · {r['agent_name']})"
        for r in raw_recs
    ]
    insights = rec_insights + [x for x in rule_insights if x not in rec_insights]
    insights = insights[:8]
    if not insights and cur["count"] == 0:
        insights = [
            "No usage in this window yet. Connect agents or send traffic to see savings ideas."
        ]
    elif not insights:
        insights = ["No notable automated patterns this period. Check optimization cards on each agent for model-specific ideas."]

    return UsageSummaryResponse(
        scope=scope,
        team_view_available=t_avail,
        team_member_count=t_members,
        potential_savings_usd=potential_savings,
        top_changes=top_changes,
        period_days=period_days,
        current_total_cost_usd=round(cur["total_cost"], 4),
        previous_total_cost_usd=round(prev["total_cost"], 4),
        cost_change_pct=cost_change_pct,
        total_tokens=cur["total_tokens"],
        request_count=cur["count"],
        avg_tokens_per_request=round(avg_tokens, 2),
        avg_tool_calls_per_request=round(avg_tools, 3),
        stability_score=round(stability, 2),
        monthly_cost_usd=round(month_stats["total_cost"], 4),
        monthly_tokens=month_stats["total_tokens"],
        monthly_token_budget=tok_budget,
        monthly_cost_budget_usd=cost_budget,
        plan_tier=user.plan_tier,
        token_budget_utilization_pct=round(tok_util, 2),
        cost_budget_utilization_pct=round(cost_util, 2),
        behavioral=behavioral,
        insights=insights,
    )


def get_usage_breakdown(
    db: Session,
    user: User,
    period_days: int = 7,
    scope: str = "me",
    deployment: str | None = None,
) -> UsageBreakdownResponse:
    if scope not in ("me", "team"):
        scope = "me"
    if deployment is not None and deployment not in ("internal", "production"):
        deployment = None
    agent_ids = resolve_agent_ids(db, user, scope, deployment)
    now = datetime.utcnow()
    since = now - timedelta(days=period_days)

    if not agent_ids:
        return UsageBreakdownResponse(
            scope=scope, period_days=period_days, by_model=[], by_endpoint=[]
        )

    by_model_rows = (
        db.query(
            Request.model.label("label"),
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tok"),
            func.count(Request.id).label("cnt"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= since,
            Request.timestamp <= now,
        )
        .group_by(Request.model)
        .order_by(func.sum(Request.cost_usd).desc())
        .all()
    )
    total_cost = sum(float(r.cost) for r in by_model_rows) or 1.0
    by_model = [
        BreakdownRow(
            label=r.label,
            total_cost_usd=round(float(r.cost), 4),
            total_tokens=int(r.tok),
            request_count=int(r.cnt),
            share_of_cost_pct=round(float(r.cost) / total_cost * 100, 1),
        )
        for r in by_model_rows
    ]

    route_or_tag = func.coalesce(
        func.nullif(Request.endpoint_route, ""),
        func.nullif(Request.feature_tag, ""),
        "default",
    )
    ep_rows = (
        db.query(
            route_or_tag.label("tag"),
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tok"),
            func.count(Request.id).label("cnt"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= since,
            Request.timestamp <= now,
        )
        .group_by(route_or_tag)
        .order_by(func.sum(Request.cost_usd).desc())
        .all()
    )
    ep_total = sum(float(r.cost) for r in ep_rows) or 1.0
    by_endpoint = [
        BreakdownRow(
            label=(r.tag or "default").strip() or "default",
            total_cost_usd=round(float(r.cost), 4),
            total_tokens=int(r.tok),
            request_count=int(r.cnt),
            share_of_cost_pct=round(float(r.cost) / ep_total * 100, 1),
        )
        for r in ep_rows
    ]

    # by_step — group by feature_tag (set via @span decorator), skip empty tags
    step_rows = (
        db.query(
            Request.feature_tag.label("label"),
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tok"),
            func.count(Request.id).label("cnt"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= since,
            Request.timestamp <= now,
            Request.feature_tag != "",
            Request.feature_tag.isnot(None),
        )
        .group_by(Request.feature_tag)
        .order_by(func.sum(Request.cost_usd).desc())
        .all()
    )
    step_total = sum(float(r.cost) for r in step_rows) or 1.0
    by_step = [
        BreakdownRow(
            label=r.label or "unknown",
            total_cost_usd=round(float(r.cost), 4),
            total_tokens=int(r.tok),
            request_count=int(r.cnt),
            share_of_cost_pct=round(float(r.cost) / step_total * 100, 1),
        )
        for r in step_rows
    ]

    # by_provider — group by provider field (anthropic | openai | google | …)
    provider_rows = (
        db.query(
            Request.provider.label("label"),
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tok"),
            func.count(Request.id).label("cnt"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= since,
            Request.timestamp <= now,
        )
        .group_by(Request.provider)
        .order_by(func.sum(Request.cost_usd).desc())
        .all()
    )
    provider_total = sum(float(r.cost) for r in provider_rows) or 1.0
    by_provider = [
        BreakdownRow(
            label=r.label or "unknown",
            total_cost_usd=round(float(r.cost), 4),
            total_tokens=int(r.tok),
            request_count=int(r.cnt),
            share_of_cost_pct=round(float(r.cost) / provider_total * 100, 1),
        )
        for r in provider_rows
    ]

    # by_agent — group by agent, joining name from the agents table
    agent_rows = (
        db.query(
            Request.agent_id.label("agent_id"),
            Agent.name.label("name"),
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tok"),
            func.count(Request.id).label("cnt"),
        )
        .join(Agent, Agent.id == Request.agent_id)
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= since,
            Request.timestamp <= now,
        )
        .group_by(Request.agent_id, Agent.name)
        .order_by(func.sum(Request.cost_usd).desc())
        .all()
    )
    agent_total = sum(float(r.cost) for r in agent_rows) or 1.0
    by_agent = [
        BreakdownRow(
            label=r.name or r.agent_id,
            total_cost_usd=round(float(r.cost), 4),
            total_tokens=int(r.tok),
            request_count=int(r.cnt),
            share_of_cost_pct=round(float(r.cost) / agent_total * 100, 1),
        )
        for r in agent_rows
    ]

    return UsageBreakdownResponse(
        scope=scope,
        period_days=period_days,
        by_model=by_model,
        by_endpoint=by_endpoint,
        by_step=by_step,
        by_provider=by_provider,
        by_agent=by_agent,
    )


def get_usage_timeline(
    db: Session,
    user: User,
    period_days: int = 14,
    scope: str = "me",
    deployment: str | None = None,
) -> UsageTimelineResponse:
    if scope not in ("me", "team"):
        scope = "me"
    if deployment is not None and deployment not in ("internal", "production"):
        deployment = None
    agent_ids = resolve_agent_ids(db, user, scope, deployment)
    now = datetime.utcnow()
    since = now - timedelta(days=period_days)

    if not agent_ids:
        return UsageTimelineResponse(scope=scope, period_days=period_days, points=[])

    date_col = func.date(Request.timestamp).label("d")
    rows = (
        db.query(
            date_col,
            func.coalesce(func.sum(Request.cost_usd), 0).label("cost"),
            func.coalesce(func.sum(Request.total_tokens), 0).label("tok"),
            func.count(Request.id).label("cnt"),
        )
        .filter(
            Request.agent_id.in_(agent_ids),
            Request.timestamp >= since,
            Request.timestamp <= now,
        )
        .group_by(date_col)
        .order_by(date_col)
        .all()
    )
    points = [
        TimelinePoint(
            date=str(r.d),
            cost_usd=round(float(r.cost), 4),
            total_tokens=int(r.tok),
            request_count=int(r.cnt),
        )
        for r in rows
    ]
    return UsageTimelineResponse(scope=scope, period_days=period_days, points=points)
