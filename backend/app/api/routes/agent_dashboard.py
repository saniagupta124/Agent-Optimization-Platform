"""
Agent-level dashboard and span recommendation endpoints.

Auth: accepts either a Bearer JWT token (dashboard UI) or an X-Traeco-Key
header (SDK / CLI), whichever is present.

Routes
------
GET  /dashboard/{agent_id_or_name}      — live cost stats by span/model
GET  /recommendations/{agent_id_or_name} — ranked recommendations with savings
POST /apply/{recommendation_id}          — mark a recommendation as applied
"""

from __future__ import annotations

import hashlib
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.pricing import (
    CHEAP_ALTERNATIVES,
    HIGH_COST_MODELS,
    MODEL_PRICING,
    calculate_cost,
)
from app.db.models import Agent, Request as LLMRequest, SdkApiKey, SpanRecommendation, User
from app.db.session import get_db
from app.services.auth_service import decode_access_token

router = APIRouter(tags=["agent-dashboard"])


# ── Auth helpers ─────────────────────────────────────────────────────────────

def _resolve_user(request: Request, db: Session) -> User:
    """Resolve user from Bearer JWT or X-Traeco-Key, whichever header is present."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        payload = decode_access_token(token)
        if payload:
            user = db.query(User).filter(User.id == payload["sub"]).first()
            if user:
                return user

    traeco_key = request.headers.get("X-Traeco-Key", "")
    if traeco_key:
        h = hashlib.sha256(traeco_key.encode()).hexdigest()
        row = db.query(SdkApiKey).filter(SdkApiKey.key_hash == h).first()
        if row:
            user = db.query(User).filter(User.id == row.user_id).first()
            if user:
                row.last_used_at = datetime.utcnow()
                db.commit()
                return user

    raise HTTPException(status_code=401, detail="Authentication required")


def _resolve_agent(db: Session, user: User, agent_id_or_name: str) -> Agent:
    """Find agent by UUID or by name (user-scoped)."""
    agent = (
        db.query(Agent)
        .filter(Agent.id == agent_id_or_name, Agent.user_id == user.id)
        .first()
    )
    if not agent:
        agent = (
            db.query(Agent)
            .filter(Agent.name == agent_id_or_name, Agent.user_id == user.id)
            .first()
        )
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id_or_name}' not found")
    return agent


# ── GET /dashboard/{agent_id_or_name} ────────────────────────────────────────

@router.get("/dashboard/{agent_id_or_name}")
def get_agent_dashboard(
    agent_id_or_name: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    user = _resolve_user(request, db)
    agent = _resolve_agent(db, user, agent_id_or_name)

    now = datetime.utcnow()
    session_since = now - timedelta(hours=1)
    alltime_since = now - timedelta(days=30)

    session_reqs = (
        db.query(LLMRequest)
        .filter(LLMRequest.agent_id == agent.id, LLMRequest.timestamp >= session_since)
        .order_by(LLMRequest.timestamp)
        .all()
    )
    alltime_reqs = (
        db.query(LLMRequest)
        .filter(LLMRequest.agent_id == agent.id, LLMRequest.timestamp >= alltime_since)
        .order_by(LLMRequest.timestamp)
        .all()
    )

    # ── Aggregate costs ───────────────────────────────────────────────────────
    session_cost = sum(r.cost_usd for r in session_reqs)
    alltime_cost = sum(r.cost_usd for r in alltime_reqs)

    # ── Cost by span (feature_tag — only @span-tagged requests) ──────────────
    span_cost: dict[str, float] = defaultdict(float)
    span_count: dict[str, int] = defaultdict(int)
    for r in alltime_reqs:
        tag = r.feature_tag or ""
        if not tag:
            continue  # skip untagged — show only explicit @span names
        span_cost[tag] += r.cost_usd
        span_count[tag] += 1

    by_span = [
        {
            "span_name": k,
            "total_cost": round(v, 6),
            "request_count": span_count[k],
        }
        for k, v in sorted(span_cost.items(), key=lambda x: x[1], reverse=True)
    ]

    # ── Cost by model ─────────────────────────────────────────────────────────
    model_cost: dict[str, float] = defaultdict(float)
    model_count: dict[str, int] = defaultdict(int)
    for r in alltime_reqs:
        model_cost[r.model] += r.cost_usd
        model_count[r.model] += 1

    by_model = [
        {
            "model": k,
            "total_cost": round(v, 6),
            "request_count": model_count[k],
        }
        for k, v in sorted(model_cost.items(), key=lambda x: x[1], reverse=True)
    ]

    # ── Cost by tool (endpoint_route, fallback to feature_tag) ───────────────
    tool_cost: dict[str, float] = defaultdict(float)
    tool_count: dict[str, int] = defaultdict(int)
    for r in alltime_reqs:
        label = (r.endpoint_route or "").strip() or (r.feature_tag or "").strip() or "default"
        tool_cost[label] += r.cost_usd
        tool_count[label] += 1

    by_tool = [
        {
            "label": k,
            "total_cost": round(v, 6),
            "request_count": tool_count[k],
        }
        for k, v in sorted(tool_cost.items(), key=lambda x: x[1], reverse=True)
    ]

    # ── Requests per minute (session window) ─────────────────────────────────
    elapsed_minutes = max((now - session_since).total_seconds() / 60, 1)
    rpm = round(len(session_reqs) / elapsed_minutes, 2)

    # ── Retry loop detection: ≥3 calls in same span within 10 s ──────────────
    span_timestamps: dict[str, list[datetime]] = defaultdict(list)
    for r in alltime_reqs:
        tag = r.feature_tag or "untagged"
        span_timestamps[tag].append(r.timestamp)

    retry_loops = []
    for span_name, timestamps in span_timestamps.items():
        timestamps.sort()
        for i in range(len(timestamps) - 2):
            window_secs = (timestamps[i + 2] - timestamps[i]).total_seconds()
            if window_secs <= 10:
                retry_loops.append(
                    {
                        "span_name": span_name,
                        "occurrences": 3,
                        "window_seconds": round(window_secs, 1),
                    }
                )
                break  # one flag per span is enough

    return {
        "agent_id": agent.id,
        "agent_name": agent.name,
        "session_cost_usd": round(session_cost, 6),
        "alltime_cost_usd": round(alltime_cost, 6),
        "session_request_count": len(session_reqs),
        "alltime_request_count": len(alltime_reqs),
        "requests_per_minute": rpm,
        "by_span": by_span,
        "by_model": by_model,
        "by_tool": by_tool,
        "retry_loops": retry_loops,
    }


# ── GET /recommendations/{agent_id_or_name} ──────────────────────────────────

def _monthly_projection(cost_in_window: float, days: int = 30) -> float:
    """Extrapolate cost to a 30-day month."""
    return cost_in_window * (30 / max(days, 1))


@router.get("/recommendations/{agent_id_or_name}")
def get_span_recommendations(
    agent_id_or_name: str,
    request: Request,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    user = _resolve_user(request, db)
    agent = _resolve_agent(db, user, agent_id_or_name)

    since = datetime.utcnow() - timedelta(days=30)
    reqs = (
        db.query(LLMRequest)
        .filter(LLMRequest.agent_id == agent.id, LLMRequest.timestamp >= since)
        .order_by(LLMRequest.timestamp)
        .all()
    )

    if not reqs:
        return []

    # Group by span
    by_span: dict[str, list[LLMRequest]] = defaultdict(list)
    for r in reqs:
        tag = r.feature_tag or "untagged"
        by_span[tag].append(r)

    recs: list[dict] = []

    for span_name, span_reqs in by_span.items():
        _check_model_swap(recs, agent.id, span_name, span_reqs)
        _check_retry_loop(recs, agent.id, span_name, span_reqs)
        _check_context_bloat(recs, agent.id, span_name, span_reqs)
        _check_redundant_calls(recs, agent.id, span_name, span_reqs)
        _check_model_overkill(recs, agent.id, span_name, span_reqs)

    # Sort by savings descending
    recs.sort(key=lambda r: r["savings_per_month"], reverse=True)

    # Upsert into DB so apply endpoint can reference them
    for rec in recs:
        existing = (
            db.query(SpanRecommendation)
            .filter(
                SpanRecommendation.agent_id == agent.id,
                SpanRecommendation.span_name == rec["span_name"],
                SpanRecommendation.rec_type == rec["rec_type"],
            )
            .first()
        )
        if existing:
            # Refresh numbers, preserve applied state
            existing.explanation = rec["explanation"]
            existing.current_monthly_cost = rec["current_monthly_cost"]
            existing.projected_monthly_cost = rec["projected_monthly_cost"]
            existing.savings_per_month = rec["savings_per_month"]
            existing.confidence = rec["confidence"]
            existing.updated_at = datetime.utcnow()
            rec["id"] = existing.id
            rec["applied"] = existing.applied
        else:
            row = SpanRecommendation(
                id=str(uuid.uuid4()),
                agent_id=agent.id,
                span_name=rec["span_name"],
                rec_type=rec["rec_type"],
                explanation=rec["explanation"],
                current_monthly_cost=rec["current_monthly_cost"],
                projected_monthly_cost=rec["projected_monthly_cost"],
                savings_per_month=rec["savings_per_month"],
                confidence=rec["confidence"],
            )
            db.add(row)
            rec["id"] = row.id
            rec["applied"] = False

    db.commit()
    return recs


# ── POST /apply/{recommendation_id} ──────────────────────────────────────────

@router.post("/apply/{recommendation_id}")
def apply_recommendation(
    recommendation_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    user = _resolve_user(request, db)

    row = db.query(SpanRecommendation).filter(SpanRecommendation.id == recommendation_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    # Verify the recommendation belongs to an agent owned by this user
    agent = db.query(Agent).filter(Agent.id == row.agent_id, Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="Not authorized")

    row.applied = True
    row.updated_at = datetime.utcnow()
    db.commit()
    return {"id": recommendation_id, "applied": True}


# ── Recommendation check functions ───────────────────────────────────────────

def _check_model_swap(
    recs: list, agent_id: str, span_name: str, span_reqs: list[LLMRequest]
) -> None:
    """Recommend cheaper model when avg completion is under 500 tokens."""
    if not span_reqs:
        return

    models = {r.model for r in span_reqs}
    for model in models:
        model_reqs = [r for r in span_reqs if r.model == model]
        if model not in (CHEAP_ALTERNATIVES | {k for k in CHEAP_ALTERNATIVES}):
            continue

        avg_completion = sum(r.completion_tokens for r in model_reqs) / len(model_reqs)
        if avg_completion >= 500:
            continue

        alt = CHEAP_ALTERNATIVES.get(model)
        if not alt or alt not in MODEL_PRICING:
            continue

        current_cost = sum(r.cost_usd for r in model_reqs)
        alt_pricing = MODEL_PRICING[alt]
        alt_cost = sum(
            r.prompt_tokens * alt_pricing["input"] + r.completion_tokens * alt_pricing["output"]
            for r in model_reqs
        )
        savings = current_cost - alt_cost
        if savings <= 0:
            continue

        monthly_current = _monthly_projection(current_cost)
        monthly_alt = _monthly_projection(alt_cost)
        monthly_savings = monthly_current - monthly_alt
        confidence = min(95, 60 + int(savings / max(current_cost, 0.001) * 35))

        recs.append({
            "span_name": span_name,
            "rec_type": "model_swap",
            "explanation": (
                f"Span '{span_name}' uses {model} with avg {avg_completion:.0f} completion "
                f"tokens/call. {alt} handles this workload at a fraction of the cost."
            ),
            "current_monthly_cost": round(monthly_current, 4),
            "projected_monthly_cost": round(monthly_alt, 4),
            "savings_per_month": round(monthly_savings, 4),
            "confidence": confidence,
        })


def _check_retry_loop(
    recs: list, agent_id: str, span_name: str, span_reqs: list[LLMRequest]
) -> None:
    """Flag spans where ≥3 calls occur within 10 seconds."""
    timestamps = sorted(r.timestamp for r in span_reqs)
    loop_count = 0
    loop_cost = 0.0
    for i in range(len(timestamps) - 2):
        window = (timestamps[i + 2] - timestamps[i]).total_seconds()
        if window <= 10:
            loop_count += 1
            loop_cost += sum(r.cost_usd for r in span_reqs[i:i + 3])

    if loop_count == 0:
        return

    total_cost = sum(r.cost_usd for r in span_reqs)
    waste_fraction = min(loop_cost / max(total_cost, 1e-9), 0.8)
    monthly_current = _monthly_projection(total_cost)
    monthly_saved = monthly_current * waste_fraction
    confidence = min(90, 50 + loop_count * 5)

    recs.append({
        "span_name": span_name,
        "rec_type": "retry_loop",
        "explanation": (
            f"Span '{span_name}' fired 3+ times within 10 s on {loop_count} occasion(s). "
            "Add exponential backoff and cache results to eliminate redundant calls."
        ),
        "current_monthly_cost": round(monthly_current, 4),
        "projected_monthly_cost": round(monthly_current - monthly_saved, 4),
        "savings_per_month": round(monthly_saved, 4),
        "confidence": confidence,
    })


def _check_context_bloat(
    recs: list, agent_id: str, span_name: str, span_reqs: list[LLMRequest]
) -> None:
    """Detect prompt_tokens growing 20%+ across sequential calls in the same span."""
    if len(span_reqs) < 4:
        return

    ordered = sorted(span_reqs, key=lambda r: r.timestamp)
    growths = []
    for i in range(1, len(ordered)):
        prev, curr = ordered[i - 1].prompt_tokens, ordered[i].prompt_tokens
        if prev > 0:
            growths.append((curr - prev) / prev)

    growing = sum(1 for g in growths if g >= 0.20)
    if growing < len(growths) * 0.5:
        return

    total_cost = sum(r.cost_usd for r in span_reqs)
    monthly_current = _monthly_projection(total_cost)
    # Windowing could reduce prompt tokens by ~40% on average
    monthly_after = monthly_current * 0.60
    monthly_savings = monthly_current - monthly_after

    recs.append({
        "span_name": span_name,
        "rec_type": "context_bloat",
        "explanation": (
            f"Span '{span_name}' shows prompt tokens growing >20% per call in "
            f"{growing}/{len(growths)} steps. Implement conversation windowing to cap context size."
        ),
        "current_monthly_cost": round(monthly_current, 4),
        "projected_monthly_cost": round(monthly_after, 4),
        "savings_per_month": round(monthly_savings, 4),
        "confidence": 72,
    })


def _check_redundant_calls(
    recs: list, agent_id: str, span_name: str, span_reqs: list[LLMRequest]
) -> None:
    """Flag spans where identical prompt token counts appear 3+ times (proxy for same prompt)."""
    if len(span_reqs) < 3:
        return

    token_counts: dict[int, int] = defaultdict(int)
    for r in span_reqs:
        token_counts[r.prompt_tokens] += 1

    repeated = {k: v for k, v in token_counts.items() if v >= 3}
    if not repeated:
        return

    # Cost attributable to repeated calls (all but the first per unique count)
    redundant_reqs = [
        r for r in span_reqs if token_counts[r.prompt_tokens] >= 3
    ]
    redundant_cost = sum(r.cost_usd for r in redundant_reqs)
    # Each repeated token count saves (count - 1)/count of those calls via caching
    savings_fraction = sum(
        (v - 1) / v for v in repeated.values()
    ) / max(len(repeated), 1)
    savings = redundant_cost * savings_fraction

    total_cost = sum(r.cost_usd for r in span_reqs)
    monthly_current = _monthly_projection(total_cost)
    monthly_savings = _monthly_projection(savings)

    recs.append({
        "span_name": span_name,
        "rec_type": "redundant_calls",
        "explanation": (
            f"Span '{span_name}' made {sum(repeated.values())} calls with identical prompt "
            "sizes. Semantic caching could eliminate most of these."
        ),
        "current_monthly_cost": round(monthly_current, 4),
        "projected_monthly_cost": round(monthly_current - monthly_savings, 4),
        "savings_per_month": round(monthly_savings, 4),
        "confidence": 65,
    })


def _check_model_overkill(
    recs: list, agent_id: str, span_name: str, span_reqs: list[LLMRequest]
) -> None:
    """Flag expensive models where avg cost per call is under $0.01."""
    if not span_reqs:
        return

    for model in {r.model for r in span_reqs}:
        if model not in HIGH_COST_MODELS:
            continue
        model_reqs = [r for r in span_reqs if r.model == model]
        avg_cost = sum(r.cost_usd for r in model_reqs) / len(model_reqs)
        if avg_cost >= 0.01:
            continue

        total_cost = sum(r.cost_usd for r in model_reqs)
        # Recommend gpt-4o-mini or claude-3-haiku as default downgrade
        alt = "gpt-4o-mini" if "gpt" in model else "claude-3-haiku"
        alt_pricing = MODEL_PRICING.get(alt)
        if not alt_pricing:
            continue

        alt_cost = sum(
            r.prompt_tokens * alt_pricing["input"] + r.completion_tokens * alt_pricing["output"]
            for r in model_reqs
        )
        savings = total_cost - alt_cost
        if savings <= 0:
            continue

        monthly_current = _monthly_projection(total_cost)
        monthly_alt = _monthly_projection(alt_cost)
        monthly_savings = monthly_current - monthly_alt

        recs.append({
            "span_name": span_name,
            "rec_type": "model_overkill",
            "explanation": (
                f"Span '{span_name}' uses {model} at ${avg_cost:.4f}/call — "
                f"well below the threshold where its capability is warranted. "
                f"Downgrading to {alt} saves ~${monthly_savings:.2f}/mo."
            ),
            "current_monthly_cost": round(monthly_current, 4),
            "projected_monthly_cost": round(monthly_alt, 4),
            "savings_per_month": round(monthly_savings, 4),
            "confidence": 80,
        })
