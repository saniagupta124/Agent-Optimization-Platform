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
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.pricing import (
    CHEAP_ALTERNATIVES,
    HIGH_COST_MODELS,
    MODEL_PRICING,
    calculate_cost,
)
from app.db.models import Agent, RecDecision, Request as LLMRequest, SdkApiKey, SpanRecommendation, User
from app.db.session import get_db
from app.services.auth_service import decode_access_token
from app.services.quality_service import compute_quality_signals, derive_confidence_rating

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
    session_since = now - timedelta(hours=6)
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

    # ── Retry loop detection ──────────────────────────────────────────────────
    # Flags ≥6 calls of the same span within 60 s that are NOT a concurrent
    # burst. A concurrent burst (all calls within 3 s) means parallel threads
    # fired by design — not a stuck retry loop. A real retry loop is sustained:
    # calls keep repeating across a longer window with sequential gaps.
    RETRY_MIN_CALLS = 6
    RETRY_WINDOW_SECS = 60
    CONCURRENT_BURST_SECS = 3  # tighter than 3 s = parallel threads, skip

    span_timestamps: dict[str, list[datetime]] = defaultdict(list)
    for r in alltime_reqs:
        tag = r.feature_tag or "untagged"
        span_timestamps[tag].append(r.timestamp)

    retry_loops = []
    for span_name, timestamps in span_timestamps.items():
        timestamps.sort()
        n = len(timestamps)
        flagged = False
        for i in range(n):
            # Collect all calls within RETRY_WINDOW_SECS of timestamps[i]
            burst = [timestamps[i]]
            for j in range(i + 1, n):
                if (timestamps[j] - timestamps[i]).total_seconds() <= RETRY_WINDOW_SECS:
                    burst.append(timestamps[j])
                else:
                    break
            if len(burst) < RETRY_MIN_CALLS:
                continue
            spread = (burst[-1] - burst[0]).total_seconds()
            # Skip tight concurrent bursts — parallel threads firing at once
            if spread <= CONCURRENT_BURST_SECS:
                continue
            # Looks like a real retry loop — sequential repeats over time
            retry_loops.append(
                {
                    "span_name": span_name,
                    "occurrences": len(burst),
                    "window_seconds": round(spread, 1),
                }
            )
            flagged = True
            break
        if flagged:
            continue  # one flag per span is enough

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


# Known speed multipliers: switching from key→value model gives this speedup factor
_MODEL_SPEED_RATIO: dict[tuple[str, str], float] = {
    ("gpt-4o", "gpt-4o-mini"):                           3.5,
    ("gpt-4-turbo", "gpt-4o-mini"):                      4.0,
    ("gpt-4", "gpt-4o-mini"):                            5.0,
    ("claude-opus-4-6", "claude-haiku-4-5"):             4.0,
    ("claude-sonnet-4-6", "claude-haiku-4-5"):           2.5,
    ("claude-3-5-sonnet", "claude-3-haiku"):             2.0,
    ("claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"): 2.0,
    ("claude-3-opus", "claude-3-haiku"):                 4.0,
}
_CACHE_HIT_MS = 30  # typical in-memory/Redis cache lookup latency


def _predict_quality_impact(
    rec_type: str,
    span_reqs: list,
    savings_fraction: float,
    current_model: str = "",
    alt_model: str = "",
    actual_prompt_reduction_pct: float | None = None,
    waste_fraction: float = 0.0,
) -> dict:
    """Predict quality impact of implementing this recommendation from existing data."""
    n = len(span_reqs)
    avg_completion = sum(r.completion_tokens for r in span_reqs) / max(n, 1) if span_reqs else 0
    avg_prompt = sum(r.prompt_tokens for r in span_reqs) / max(n, 1) if span_reqs else 0
    lat_vals = [r.latency_ms for r in span_reqs if r.latency_ms]
    avg_latency = sum(lat_vals) / len(lat_vals) if lat_vals else 0
    has_data = n >= 5

    if rec_type in ("model_swap", "model_overkill"):
        speed_ratio = _MODEL_SPEED_RATIO.get((current_model, alt_model))
        if speed_ratio:
            latency_delta_pct = -int((1 - 1 / speed_ratio) * 100)
        else:
            latency_delta_pct = -min(60, int(savings_fraction * 65))
        error_rate_delta = "+low risk"
        truncation_delta = "none"
        if not has_data:
            schema_risk = "unknown"; faithfulness_risk = "unknown"
            basis = f"Smaller model ~{abs(latency_delta_pct)}% faster (estimated from {int(savings_fraction*100)}% cost reduction). Schema/faithfulness risk unknown — no output data yet."
        elif avg_completion > 300:
            schema_risk = "medium"; faithfulness_risk = "medium"
            basis = f"Smaller model ~{abs(latency_delta_pct)}% faster. Medium risk: avg {avg_completion:.0f} completion tokens/call — cheaper models less reliable on complex outputs."
        elif avg_completion > 100:
            schema_risk = "low"; faithfulness_risk = "low"
            basis = f"Smaller model ~{abs(latency_delta_pct)}% faster. Low risk: avg {avg_completion:.0f} completion tokens/call is manageable."
        else:
            schema_risk = "none"; faithfulness_risk = "none"
            basis = f"Smaller model ~{abs(latency_delta_pct)}% faster. Minimal risk: avg {avg_completion:.0f} completion tokens/call — short outputs well within cheap model capability."

    elif rec_type == "context_bloat":
        prompt_reduction = actual_prompt_reduction_pct if actual_prompt_reduction_pct is not None else 0.40
        if has_data and avg_latency > 0 and avg_completion > 0:
            input_time_ms = avg_prompt / 10.0
            output_time_ms = avg_completion / 1.0
            input_fraction = input_time_ms / max(input_time_ms + output_time_ms, 1)
            latency_delta_pct = max(-35, -int(prompt_reduction * input_fraction * 100))
        else:
            latency_delta_pct = -int(prompt_reduction * 20)
        schema_risk = "none"; error_rate_delta = "none"; truncation_delta = "decrease"
        faithfulness_risk = "low" if (has_data and avg_prompt > 2000) else ("unknown" if not has_data else "none")
        basis = (f"Windowing reduces prompt tokens ~{int(prompt_reduction*100)}%, saving ~{abs(latency_delta_pct)}% latency. "
                 "Same model — output schema preserved. " +
                 ("Risk: long conversations may lose earlier context." if avg_prompt > 2000 else ""))

    elif rec_type == "redundant_calls":
        if has_data and avg_latency > _CACHE_HIT_MS:
            cache_speedup_pct = (avg_latency - _CACHE_HIT_MS) / avg_latency
            latency_delta_pct = -int(savings_fraction * cache_speedup_pct * 100)
        else:
            latency_delta_pct = -int(savings_fraction * 40)
        schema_risk = "none"; faithfulness_risk = "none"; error_rate_delta = "decrease"; truncation_delta = "none"
        basis = (f"Cache hits return in ~{_CACHE_HIT_MS}ms vs {avg_latency:.0f}ms average. "
                 f"{int(savings_fraction*100)}% of calls are redundant — caching saves ~{abs(latency_delta_pct)}% p95 latency.")

    elif rec_type == "retry_loop":
        backoff_ms = 1000
        if has_data and avg_latency > 0:
            latency_delta_pct = min(40, int(waste_fraction * backoff_ms / avg_latency * 100))
        else:
            latency_delta_pct = min(40, int(waste_fraction * 30))
        latency_delta_pct = max(latency_delta_pct, 5)
        schema_risk = "none"; faithfulness_risk = "none"; error_rate_delta = "decrease"; truncation_delta = "none"
        basis = (f"Backoff adds ~{latency_delta_pct}% to p95 latency on retry paths. "
                 "No schema/faithfulness impact. Error rate improves: transient failures retried gracefully.")

    elif rec_type == "prompt_caching":
        latency_delta_pct = -5
        schema_risk = "none"; faithfulness_risk = "none"; error_rate_delta = "none"; truncation_delta = "none"
        basis = "Prompt caching uses identical content — zero quality impact. Anthropic serves cached tokens ~5% faster."

    elif rec_type == "max_tokens_cap":
        outlier_fraction = savings_fraction
        latency_delta_pct = max(-15, -int(outlier_fraction * 15))
        schema_risk = "low"; faithfulness_risk = "low"; error_rate_delta = "none"; truncation_delta = "increase"
        basis = (f"Capping at p95 ({int(outlier_fraction*100)}% of calls are outliers) prevents runaway generation. "
                 "Low schema/faithfulness risk — only extreme-length responses trimmed. Truncation rate increases intentionally.")

    else:
        latency_delta_pct = 0
        schema_risk = "none"; faithfulness_risk = "none"; error_rate_delta = "none"; truncation_delta = "none"
        basis = "Quality impact not yet characterised for this recommendation type."

    return {
        "latency_delta_pct": latency_delta_pct,
        "schema_risk": schema_risk,
        "faithfulness_risk": faithfulness_risk,
        "error_rate_delta": error_rate_delta,
        "truncation_delta": truncation_delta,
        "basis": basis,
    }


def _days_spanned(reqs: list) -> int:
    return len({r.timestamp.date() for r in reqs}) if reqs else 0


def _span_confidence(n: int, days: int, pattern_score: float) -> int:
    """Score 0-100 from sample size, temporal spread, and pattern clarity."""
    size_pts = min(30, n // 10)
    days_pts = min(20, days * 4)
    pattern_pts = int(40 * min(max(pattern_score, 0.0), 1.0))
    return min(95, 10 + size_pts + days_pts + pattern_pts)


def _confidence_rating_from_score(score: int, n: int) -> str:
    if score >= 80 and n >= 500:
        return "high"
    if score >= 60 and n >= 100:
        return "medium"
    return "low"


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
        _check_prompt_caching(recs, agent.id, span_name, span_reqs)
        _check_max_tokens_cap(recs, agent.id, span_name, span_reqs, agent.max_tokens)

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
            # Refresh numbers, preserve applied state and user decision status
            existing.explanation = rec["explanation"]
            existing.current_monthly_cost = rec["current_monthly_cost"]
            existing.projected_monthly_cost = rec["projected_monthly_cost"]
            existing.savings_per_month = rec["savings_per_month"]
            existing.confidence = rec["confidence"]
            existing.updated_at = datetime.utcnow()
            rec["id"] = existing.id
            rec["applied"] = existing.applied
            rec["status"] = existing.status
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
            rec["status"] = "pending"

    db.commit()

    # Enrich recommendations with quality signals
    try:
        quality_signals = compute_quality_signals(db, agent.id)
    except Exception:
        quality_signals = {
            "latency_p95_ms": None,
            "structure_conformance_pct": None,
            "faithfulness_score": None,
            "latency_stability": None,
            "error_rate": None,
            "truncation_rate": None,
            "judge_preference_pct": None,
            "quality_impact": "none",
        }

    # Compute confidence from quality signals + request count
    confidence_n = len(reqs)
    confidence_score = min(100, int((confidence_n / 500) * 100))
    confidence_rating = derive_confidence_rating(
        confidence_n,
        schema_conformance_pct=quality_signals.get("structure_conformance_pct"),
        faithfulness_score=quality_signals.get("faithfulness_score"),
        latency_stability=quality_signals.get("latency_stability"),
        error_rate=quality_signals.get("error_rate"),
        truncation_rate=quality_signals.get("truncation_rate"),
    )

    quality_impact = quality_signals.get("quality_impact", "none")

    def _derive_verdict_local(c_rating: str, n: int, q_impact: str) -> str:
        if c_rating == "low" or n < 20:
            return "insufficient_data"
        if q_impact == "none" and c_rating in ("high", "medium"):
            return "ship_it"
        if q_impact == "low":
            return "ship_with_caution"
        if q_impact == "medium":
            return "canary_only"
        if q_impact == "high":
            return "hold"
        return "insufficient_data"

    verdict = _derive_verdict_local(confidence_rating, confidence_n, quality_impact)

    # Read judge preference from quality_evaluations cache (set by LLM-as-judge or manually)
    judge_preference_pct: float | None = None
    try:
        from app.db.models import QualityEvaluation
        eval_cutoff = datetime.utcnow() - timedelta(days=7)
        eval_row = (
            db.query(QualityEvaluation)
            .filter(
                QualityEvaluation.agent_id == agent.id,
                QualityEvaluation.evaluated_at >= eval_cutoff,
            )
            .order_by(QualityEvaluation.evaluated_at.desc())
            .first()
        )
        if eval_row is not None:
            judge_preference_pct = float(eval_row.preference_pct)
    except Exception:
        pass

    for rec in recs:
        rec["latency_p95_ms"] = quality_signals.get("latency_p95_ms")
        rec["structure_conformance_pct"] = quality_signals.get("structure_conformance_pct")
        rec["error_rate"] = quality_signals.get("error_rate")
        rec["truncation_rate"] = quality_signals.get("truncation_rate")
        rec["faithfulness_score"] = quality_signals.get("faithfulness_score")
        rec["latency_stability"] = quality_signals.get("latency_stability")
        rec["judge_preference_pct"] = judge_preference_pct
        rec["quality_impact"] = quality_impact
        # Per-recommendation confidence rating: derived from that rec's own span sample size + quality signals
        span_n = rec.pop("confidence_span_n", confidence_n)
        rec["confidence_rating"] = derive_confidence_rating(
            span_n,
            schema_conformance_pct=quality_signals.get("structure_conformance_pct"),
            faithfulness_score=quality_signals.get("faithfulness_score"),
            latency_stability=quality_signals.get("latency_stability"),
            error_rate=quality_signals.get("error_rate"),
            truncation_rate=quality_signals.get("truncation_rate"),
        )
        rec["confidence_n"] = span_n
        rec["confidence_score"] = rec["confidence"]
        rec["confidence_flags"] = []
        rec["verdict"] = _derive_verdict_local(rec["confidence_rating"], span_n, quality_impact)
        rec["verdict_rationale"] = ""

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
    row.status = "accepted"
    row.updated_at = datetime.utcnow()
    db.commit()
    return {"id": recommendation_id, "applied": True}


# ── PATCH /recommendations/{recommendation_id}/status ────────────────────────

class RecStatusUpdate(BaseModel):
    status: str  # pending | accepted | rejected | deferred
    reject_reason: str = ""


@router.patch("/recommendations/{recommendation_id}/status")
def update_span_rec_status(
    recommendation_id: str,
    body: RecStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if body.status not in ("pending", "accepted", "rejected", "deferred"):
        raise HTTPException(status_code=422, detail="Invalid status")
    user = _resolve_user(request, db)
    row = db.query(SpanRecommendation).filter(SpanRecommendation.id == recommendation_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    agent = db.query(Agent).filter(Agent.id == row.agent_id, Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="Not authorized")
    row.status = body.status
    row.updated_at = datetime.utcnow()
    db.commit()
    return {"id": recommendation_id, "status": body.status}


# ── PATCH /rec-decisions/{agent_id}/{rec_type} ───────────────────────────────

class RecDecisionBody(BaseModel):
    status: str  # pending | accepted | rejected | deferred
    reject_reason: str = ""


@router.patch("/rec-decisions/{agent_id}/{rec_type}")
def upsert_rec_decision(
    agent_id: str,
    rec_type: str,
    body: RecDecisionBody,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if body.status not in ("pending", "accepted", "rejected", "deferred"):
        raise HTTPException(status_code=422, detail="Invalid status")
    user = _resolve_user(request, db)
    existing = (
        db.query(RecDecision)
        .filter(
            RecDecision.user_id == user.id,
            RecDecision.agent_id == agent_id,
            RecDecision.rec_type == rec_type,
        )
        .first()
    )
    if existing:
        existing.status = body.status
        existing.reject_reason = body.reject_reason
        existing.updated_at = datetime.utcnow()
    else:
        db.add(RecDecision(
            user_id=user.id,
            agent_id=agent_id,
            rec_type=rec_type,
            status=body.status,
            reject_reason=body.reject_reason,
        ))
    db.commit()
    return {"agent_id": agent_id, "rec_type": rec_type, "status": body.status}


@router.get("/rec-decisions")
def get_rec_decisions(
    request: Request,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    user = _resolve_user(request, db)
    rows = db.query(RecDecision).filter(RecDecision.user_id == user.id).all()
    return [
        {"agent_id": r.agent_id, "rec_type": r.rec_type, "status": r.status}
        for r in rows
    ]


# ── POST /agents/{agent_id}/eval ─────────────────────────────────────────────

class EvalBody(BaseModel):
    baseline_model: str
    candidate_model: str
    preference_pct: float
    span_name: str = ""
    rec_type: str = ""


@router.post("/agents/{agent_id_or_name}/eval")
def store_eval(
    agent_id_or_name: str,
    body: EvalBody,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    user = _resolve_user(request, db)
    agent = _resolve_agent(db, user, agent_id_or_name)
    from app.db.models import QualityEvaluation
    row = QualityEvaluation(
        agent_id=agent.id,
        baseline_model=body.baseline_model,
        candidate_model=body.candidate_model,
        preference_pct=body.preference_pct,
        span_name=body.span_name,
        rec_type=body.rec_type,
    )
    db.add(row)
    db.commit()
    return {"agent_id": agent.id, "preference_pct": body.preference_pct}


# ── GET/PATCH /agents/{agent_id}/eval-clusters ───────────────────────────────

_DEMO_CLUSTERS = [
    {"cluster_label": "billing / cancellation", "cluster_size": 247, "example_input": "How do I cancel my subscription?", "auto_draft_criteria": "Cite the cancellation policy, give 2-step instructions, no pushy retention language"},
    {"cluster_label": "technical troubleshooting", "cluster_size": 189, "example_input": "The API keeps returning 429 errors", "auto_draft_criteria": "Give a numbered steps solution, check if solved, offer to escalate"},
    {"cluster_label": "account / login", "cluster_size": 143, "example_input": "I can't log into my account", "auto_draft_criteria": "Verify identity, give reset steps, confirm access restored"},
    {"cluster_label": "pricing / plan", "cluster_size": 98, "example_input": "What's included in the Pro plan?", "auto_draft_criteria": "List key features clearly, mention price, include upgrade CTA only once"},
    {"cluster_label": "out-of-scope / unrelated", "cluster_size": 34, "example_input": "Can you write me a poem?", "auto_draft_criteria": None},
    {"cluster_label": "feature request", "cluster_size": 27, "example_input": "Can you add dark mode?", "auto_draft_criteria": "Acknowledge request, explain current status, offer workaround if available"},
]


class CriteriaUpdateBody(BaseModel):
    good_answer_criteria: str | None = None
    skip_criteria: bool = False


@router.get("/agents/{agent_id_or_name}/eval-clusters")
def get_eval_clusters(
    agent_id_or_name: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    from app.db.models import EvalCluster
    user = _resolve_user(request, db)
    agent = _resolve_agent(db, user, agent_id_or_name)
    clusters = db.query(EvalCluster).filter(EvalCluster.agent_id == agent.id).order_by(EvalCluster.sort_order).all()
    if not clusters:
        for i, demo in enumerate(_DEMO_CLUSTERS):
            row = EvalCluster(agent_id=agent.id, cluster_label=demo["cluster_label"], cluster_size=demo["cluster_size"], example_input=demo.get("example_input"), auto_draft_criteria=demo.get("auto_draft_criteria"), sort_order=i)
            db.add(row)
        db.commit()
        clusters = db.query(EvalCluster).filter(EvalCluster.agent_id == agent.id).order_by(EvalCluster.sort_order).all()
    criteria_set = sum(1 for c in clusters if c.skip_criteria or (c.good_answer_criteria and c.good_answer_criteria.strip()))
    return {
        "agent_id": agent.id, "agent_name": agent.name,
        "clusters": [{"id": c.id, "cluster_label": c.cluster_label, "cluster_size": c.cluster_size, "example_input": c.example_input, "auto_draft_criteria": c.auto_draft_criteria, "good_answer_criteria": c.good_answer_criteria, "skip_criteria": c.skip_criteria, "sort_order": c.sort_order} for c in clusters],
        "total_clusters": len(clusters), "criteria_set": criteria_set, "rubric_active": criteria_set >= 5,
    }


@router.patch("/agents/{agent_id_or_name}/eval-clusters/{cluster_id}")
def update_eval_cluster(
    agent_id_or_name: str,
    cluster_id: str,
    body: CriteriaUpdateBody,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    from app.db.models import EvalCluster
    user = _resolve_user(request, db)
    agent = _resolve_agent(db, user, agent_id_or_name)
    cluster = db.query(EvalCluster).filter(EvalCluster.id == cluster_id, EvalCluster.agent_id == agent.id).first()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    cluster.good_answer_criteria = body.good_answer_criteria
    cluster.skip_criteria = body.skip_criteria
    cluster.updated_at = datetime.utcnow()
    db.commit()
    all_clusters = db.query(EvalCluster).filter(EvalCluster.agent_id == agent.id).all()
    criteria_set = sum(1 for c in all_clusters if c.skip_criteria or (c.good_answer_criteria and c.good_answer_criteria.strip()))
    return {"id": cluster.id, "good_answer_criteria": cluster.good_answer_criteria, "skip_criteria": cluster.skip_criteria, "rubric_active": criteria_set >= 5}


# ── POST /traces/{trace_id}/structure ────────────────────────────────────────

class StructureValidPayload(BaseModel):
    valid: bool


@router.post("/traces/{trace_id}/structure")
def update_trace_structure(
    trace_id: str,
    payload: StructureValidPayload,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    user = _resolve_user(request, db)

    trace = db.query(LLMRequest).filter(LLMRequest.id == trace_id).first()
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")

    # Verify the trace belongs to an agent owned by this user
    agent = db.query(Agent).filter(Agent.id == trace.agent_id, Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="Not authorized")

    trace.structure_valid = payload.valid
    db.commit()
    return {"trace_id": trace_id, "structure_valid": payload.valid}


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
        if model not in CHEAP_ALTERNATIVES:
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

        savings_frac = savings / max(current_cost, 1e-9)
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
            "confidence_span_n": len(model_reqs),
            "baseline_model": model,
            "candidate_model": alt,
            "quality_prediction": _predict_quality_impact("model_swap", model_reqs, savings_frac, current_model=model, alt_model=alt),
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
        "confidence_span_n": len(span_reqs),
        "quality_prediction": _predict_quality_impact("retry_loop", span_reqs, waste_fraction, waste_fraction=waste_fraction),
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
    avg_prompt = sum(r.prompt_tokens for r in span_reqs) / max(len(span_reqs), 1)
    early_cutoff = max(1, len(ordered) // 5)
    early_prompts = [r.prompt_tokens for r in ordered[:early_cutoff] if r.prompt_tokens > 0]
    if early_prompts:
        stable_prompt = sum(early_prompts) / len(early_prompts)
        actual_reduction = max(0.0, min((avg_prompt - stable_prompt) / max(avg_prompt, 1), 0.70))
    else:
        actual_reduction = 0.40
    monthly_current = _monthly_projection(total_cost)
    monthly_after = monthly_current * (1 - actual_reduction)
    monthly_savings = monthly_current - monthly_after

    n = len(span_reqs)
    days = _days_spanned(span_reqs)
    consistency = growing / max(len(growths), 1)
    confidence = _span_confidence(n, days, consistency)

    recs.append({
        "span_name": span_name,
        "rec_type": "context_bloat",
        "explanation": (
            f"Span '{span_name}' shows prompt tokens growing >20% per call in "
            f"{growing}/{len(growths)} steps. Windowing to early session size reduces prompt by {int(actual_reduction*100)}%."
        ),
        "current_monthly_cost": round(monthly_current, 4),
        "projected_monthly_cost": round(monthly_after, 4),
        "savings_per_month": round(monthly_savings, 4),
        "confidence": confidence,
        "confidence_span_n": n,
        "quality_prediction": _predict_quality_impact("context_bloat", span_reqs, actual_reduction, actual_prompt_reduction_pct=actual_reduction),
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

    n = len(span_reqs)
    days = _days_spanned(span_reqs)
    confidence = _span_confidence(n, days, savings_fraction)

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
        "confidence": confidence,
        "confidence_span_n": n,
        "quality_prediction": _predict_quality_impact("redundant_calls", span_reqs, savings_fraction),
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

        n = len(model_reqs)
        days = _days_spanned(model_reqs)
        savings_frac = savings / max(total_cost, 1e-9)
        confidence = _span_confidence(n, days, min(savings_frac, 1.0))

        recs.append({
            "span_name": span_name,
            "rec_type": "model_overkill",
            "explanation": (
                f"Span '{span_name}' uses {model} at ${avg_cost:.4f}/call, "
                f"well below the threshold where its capability is warranted. "
                f"Downgrading to {alt} saves ~${monthly_savings:.2f}/mo."
            ),
            "current_monthly_cost": round(monthly_current, 4),
            "projected_monthly_cost": round(monthly_alt, 4),
            "savings_per_month": round(monthly_savings, 4),
            "confidence": confidence,
            "confidence_span_n": n,
            "baseline_model": model,
            "candidate_model": alt,
            "quality_prediction": _predict_quality_impact("model_overkill", model_reqs, savings_frac, current_model=model, alt_model=alt),
        })


def _check_prompt_caching(
    recs: list, agent_id: str, span_name: str, span_reqs: list[LLMRequest]
) -> None:
    """Recommend Anthropic prompt caching for spans with large, stable system prompts."""
    if not span_reqs:
        return
    anthropic_reqs = [r for r in span_reqs if r.model and r.model.startswith("claude")]
    if len(anthropic_reqs) < 5:
        return
    prompt_vals = [r.prompt_tokens for r in anthropic_reqs if r.prompt_tokens > 0]
    if not prompt_vals:
        return
    avg_prompt = sum(prompt_vals) / len(prompt_vals)
    if avg_prompt < 1000:
        return
    mean_p = avg_prompt
    variance = sum((p - mean_p) ** 2 for p in prompt_vals) / max(len(prompt_vals) - 1, 1)
    cv = (variance ** 0.5) / mean_p if mean_p > 0 else 1.0
    if cv > 0.3:
        return
    cacheable_tokens = min(prompt_vals)
    cacheable_fraction = cacheable_tokens / avg_prompt
    model = next((r.model for r in anthropic_reqs), "")
    pricing = MODEL_PRICING.get(model)
    if not pricing:
        for key, p in MODEL_PRICING.items():
            if model.startswith(key):
                pricing = p
                break
    if not pricing:
        return
    n = len(anthropic_reqs)
    total_prompt_cost = sum(r.prompt_tokens * pricing["input"] for r in anthropic_reqs)
    savings = total_prompt_cost * cacheable_fraction * 0.90
    if savings <= 0:
        return
    total_cost = sum(r.cost_usd for r in anthropic_reqs)
    monthly_current = _monthly_projection(total_cost)
    monthly_savings = _monthly_projection(savings)
    days = _days_spanned(anthropic_reqs)
    confidence = _span_confidence(n, days, 1 - cv)
    recs.append({
        "span_name": span_name,
        "rec_type": "prompt_caching",
        "explanation": (
            f"Span '{span_name}' sends avg {avg_prompt:.0f} prompt tokens/call with low variance "
            f"(CV={cv:.2f}). Anthropic prompt caching saves 90% on the stable ~{cacheable_tokens:.0f} token base."
        ),
        "current_monthly_cost": round(monthly_current, 4),
        "projected_monthly_cost": round(monthly_current - monthly_savings, 4),
        "savings_per_month": round(monthly_savings, 4),
        "confidence": confidence,
        "confidence_span_n": n,
        "quality_prediction": {
            "latency_delta_pct": -5,
            "schema_risk": "none",
            "faithfulness_risk": "none",
            "error_rate_delta": "none",
            "truncation_delta": "none",
            "basis": "Prompt caching uses identical content — zero quality impact. Anthropic serves cached tokens ~5% faster.",
        },
    })


def _check_max_tokens_cap(
    recs: list, agent_id: str, span_name: str, span_reqs: list[LLMRequest],
    configured_max_tokens: int | None,
) -> None:
    """Recommend setting max_tokens when completion length varies wildly."""
    if not span_reqs:
        return
    completions = sorted(r.completion_tokens for r in span_reqs if r.completion_tokens and r.completion_tokens > 0)
    if len(completions) < 10:
        return
    p50 = completions[len(completions) // 2]
    p95 = completions[min(int(len(completions) * 0.95), len(completions) - 1)]
    if p95 < p50 * 2 or p95 < 200:
        return
    recommended_max = p95
    if configured_max_tokens is not None and configured_max_tokens <= recommended_max * 1.2:
        return
    outlier_reqs = [r for r in span_reqs if r.completion_tokens and r.completion_tokens > recommended_max]
    if not outlier_reqs:
        return
    outlier_fraction = len(outlier_reqs) / max(len(span_reqs), 1)
    total_savings = 0.0
    for r in outlier_reqs:
        excess = r.completion_tokens - recommended_max
        pricing = MODEL_PRICING.get(r.model)
        if not pricing:
            for key, p in MODEL_PRICING.items():
                if r.model and r.model.startswith(key):
                    pricing = p
                    break
        if pricing:
            total_savings += excess * pricing["output"]
    if total_savings <= 0:
        return
    total_cost = sum(r.cost_usd for r in span_reqs)
    monthly_current = _monthly_projection(total_cost)
    monthly_savings = _monthly_projection(total_savings)
    n = len(span_reqs)
    days = _days_spanned(span_reqs)
    confidence = _span_confidence(n, days, min((p95 - p50) / max(p50, 1), 1.0))
    recs.append({
        "span_name": span_name,
        "rec_type": "max_tokens_cap",
        "explanation": (
            f"Span '{span_name}' has no max_tokens cap. "
            f"Completion length varies from p50={p50} to p95={p95} tokens — "
            f"{int(outlier_fraction * 100)}% of calls exceed {recommended_max} tokens. "
            f"Setting max_tokens={recommended_max} prevents runaway generation."
        ),
        "current_monthly_cost": round(monthly_current, 4),
        "projected_monthly_cost": round(monthly_current - monthly_savings, 4),
        "savings_per_month": round(monthly_savings, 4),
        "confidence": confidence,
        "confidence_span_n": n,
        "recommended_max_tokens": recommended_max,
        "quality_prediction": {
            "latency_delta_pct": -int(outlier_fraction * 15),
            "schema_risk": "low",
            "faithfulness_risk": "low",
            "error_rate_delta": "none",
            "truncation_delta": "increase",
            "basis": f"Capping at p95 ({int(outlier_fraction*100)}% of calls are outliers) prevents runaway generation. Low schema/faithfulness risk — only extreme-length responses are trimmed.",
        },
    })
