"""
Simulation service: for a given recommendation type, computes what metrics
would look like if the recommendation were applied. Uses real request data
to produce projected costs, quality retention scores, and token distributions.
"""
from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.pricing import MODEL_PRICING
from app.db.models import Agent, Request
from app.services.optimization_service import CHEAP_ALTERNATIVES, _infer_task_complexity


def simulate_recommendation(
    db: Session, agent: Agent, rec_type: str, period_days: int = 30
) -> dict:
    since = datetime.utcnow() - timedelta(days=period_days)
    requests = (
        db.query(Request)
        .filter(Request.agent_id == agent.id, Request.timestamp >= since)
        .all()
    )

    if rec_type == "model_switch":
        return _simulate_model_switch(agent, requests)
    elif rec_type == "prompt_efficiency":
        return _simulate_prompt_efficiency(agent, requests)
    elif rec_type == "token_limits":
        return _simulate_token_limits(agent, requests)
    elif rec_type == "tool_calls":
        return _simulate_tool_calls(agent, requests)
    return {"rec_type": rec_type, "empty": True}


# ---------------------------------------------------------------------------
# Model switch
# ---------------------------------------------------------------------------

def _simulate_model_switch(agent: Agent, requests: list) -> dict:
    alt = CHEAP_ALTERNATIVES.get(agent.model)
    current_pricing = MODEL_PRICING.get(agent.model, {})
    alt_pricing = MODEL_PRICING.get(alt, {}) if alt else {}

    total_prompt = sum(r.prompt_tokens for r in requests)
    total_completion = sum(r.completion_tokens for r in requests)

    current_cost = (
        total_prompt * current_pricing.get("input", 0)
        + total_completion * current_pricing.get("output", 0)
    )
    projected_cost = (
        total_prompt * alt_pricing.get("input", 0)
        + total_completion * alt_pricing.get("output", 0)
        if alt_pricing
        else current_cost
    )

    savings = current_cost - projected_cost
    savings_pct = (savings / max(current_cost, 0.001)) * 100

    task_complexity = _infer_task_complexity(requests)
    quality_score = _quality_retention_score(task_complexity, agent)

    avg_tokens = sum(r.total_tokens for r in requests) / max(len(requests), 1)
    avg_prompt = sum(r.prompt_tokens for r in requests) / max(len(requests), 1)

    quality_factors = [
        {
            "factor": "Task complexity",
            "value": task_complexity.capitalize(),
            "impact": (
                "positive" if task_complexity == "simple"
                else "neutral" if task_complexity == "moderate"
                else "negative"
            ),
        },
        {
            "factor": "Avg tokens/request",
            "value": f"{avg_tokens:.0f}",
            "impact": (
                "positive" if avg_tokens < 800
                else "neutral" if avg_tokens < 1500
                else "negative"
            ),
        },
        {
            "factor": "Quality sensitivity",
            "value": getattr(agent, "quality_sensitivity", "medium").capitalize(),
            "impact": (
                "positive" if getattr(agent, "quality_sensitivity", "medium") == "low"
                else "neutral"
            ),
        },
    ]

    tags = Counter(r.feature_tag.lower() for r in requests if r.feature_tag)
    top_tags = [{"tag": t, "count": c} for t, c in tags.most_common(5)]

    all_tokens = sorted(r.total_tokens for r in requests)
    token_dist = _token_distribution(all_tokens)

    return {
        "rec_type": "model_switch",
        "current_model": agent.model,
        "target_model": alt,
        "cost_simulation": {
            "current_monthly_cost": round(current_cost, 4),
            "projected_monthly_cost": round(projected_cost, 4),
            "savings_usd": round(savings, 4),
            "savings_pct": round(savings_pct, 1),
            "current_input_cost_per_1k": round(current_pricing.get("input", 0) * 1000, 6),
            "projected_input_cost_per_1k": round(
                alt_pricing.get("input", 0) * 1000, 6
            ) if alt_pricing else 0,
        },
        "quality_simulation": {
            "task_complexity": task_complexity,
            "retention_score": quality_score,
            "retention_label": _quality_label(quality_score),
            "quality_factors": quality_factors,
        },
        "token_distribution": token_dist,
        "top_task_tags": top_tags,
        "request_count": len(requests),
    }


# ---------------------------------------------------------------------------
# Prompt efficiency
# ---------------------------------------------------------------------------

def _simulate_prompt_efficiency(agent: Agent, requests: list) -> dict:
    if not requests:
        return {"rec_type": "prompt_efficiency", "empty": True}

    total_prompt = sum(r.prompt_tokens for r in requests)
    total_completion = sum(r.completion_tokens for r in requests)
    avg_prompt = total_prompt / len(requests)
    avg_completion = total_completion / len(requests)
    ratio = total_completion / max(total_prompt, 1)

    pricing = MODEL_PRICING.get(agent.model, {})
    current_cost = (
        total_prompt * pricing.get("input", 0)
        + total_completion * pricing.get("output", 0)
    )
    projected_prompt = total_prompt * 0.70
    projected_cost = (
        projected_prompt * pricing.get("input", 0)
        + total_completion * pricing.get("output", 0)
    )
    savings = current_cost - projected_cost

    token_flow = [
        {
            "label": "System prompt (est.)",
            "tokens": int(avg_prompt * 0.55),
            "reducible": True,
            "reduction_pct": 35,
        },
        {
            "label": "Context / history",
            "tokens": int(avg_prompt * 0.30),
            "reducible": True,
            "reduction_pct": 20,
        },
        {
            "label": "User message",
            "tokens": int(avg_prompt * 0.15),
            "reducible": False,
            "reduction_pct": 0,
        },
        {
            "label": "Completion (output)",
            "tokens": int(avg_completion),
            "reducible": False,
            "reduction_pct": 0,
        },
    ]

    prompt_sizes = sorted(r.prompt_tokens for r in requests)
    percentiles = _percentiles(prompt_sizes)

    return {
        "rec_type": "prompt_efficiency",
        "current": {
            "avg_prompt_tokens": round(avg_prompt, 1),
            "avg_completion_tokens": round(avg_completion, 1),
            "ratio": round(ratio, 3),
            "prompt_share_pct": round(
                total_prompt / max(total_prompt + total_completion, 1) * 100, 1
            ),
        },
        "projected": {
            "avg_prompt_tokens": round(avg_prompt * 0.70, 1),
            "monthly_cost_current": round(current_cost, 4),
            "monthly_cost_projected": round(projected_cost, 4),
            "savings_usd": round(savings, 4),
            "savings_pct": round(savings / max(current_cost, 0.001) * 100, 1),
        },
        "token_flow": token_flow,
        "prompt_percentiles": percentiles,
        "request_count": len(requests),
    }


# ---------------------------------------------------------------------------
# Token limits
# ---------------------------------------------------------------------------

def _simulate_token_limits(agent: Agent, requests: list) -> dict:
    if len(requests) < 5:
        return {"rec_type": "token_limits", "empty": True}

    completion_sizes = sorted(r.completion_tokens for r in requests)
    p = _percentiles(completion_sizes)

    recommended_cap = int(p["p95"] * 1.10)

    outliers = [r for r in requests if r.completion_tokens > p["p95"]]
    outlier_cost = sum(r.cost_usd for r in outliers)
    savings = outlier_cost * 0.60

    cost_dist = _cost_distribution_buckets(requests)

    return {
        "rec_type": "token_limits",
        "percentiles": p,
        "recommended_max_tokens": recommended_cap,
        "current_max_tokens": agent.max_tokens,
        "outlier_count": len(outliers),
        "outlier_cost_usd": round(outlier_cost, 4),
        "projected_savings_usd": round(savings, 4),
        "cost_distribution": cost_dist,
        "request_count": len(requests),
    }


# ---------------------------------------------------------------------------
# Tool calls
# ---------------------------------------------------------------------------

def _simulate_tool_calls(agent: Agent, requests: list) -> dict:
    if not requests:
        return {"rec_type": "tool_calls", "empty": True}

    tool_counts = [r.tool_calls for r in requests]
    avg_calls = sum(tool_counts) / len(tool_counts)

    dist: Counter = Counter()
    for c in tool_counts:
        if c <= 2:
            dist["1-2"] += 1
        elif c <= 5:
            dist["3-5"] += 1
        elif c <= 10:
            dist["6-10"] += 1
        else:
            dist["10+"] += 1

    distribution = [
        {"range": k, "count": dist[k]} for k in ["1-2", "3-5", "6-10", "10+"]
    ]

    total_cost = sum(r.cost_usd for r in requests)
    redundant_pct = (
        min(max((avg_calls - 3) / avg_calls * 100, 0), 60) if avg_calls > 3 else 0
    )
    projected_savings = total_cost * (redundant_pct / 100) * 0.5

    return {
        "rec_type": "tool_calls",
        "avg_tool_calls": round(avg_calls, 1),
        "tool_call_distribution": distribution,
        "estimated_redundant_pct": round(redundant_pct, 1),
        "projected_savings_usd": round(projected_savings, 4),
        "request_count": len(requests),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _quality_retention_score(task_complexity: str, agent: Agent) -> int:
    base = {"simple": 96, "moderate": 88, "complex": 76}.get(task_complexity, 88)
    quality = getattr(agent, "quality_sensitivity", "medium")
    if quality == "high":
        base -= 8
    elif quality == "low":
        base += 3
    return min(max(base, 50), 99)


def _quality_label(score: int) -> str:
    if score >= 93:
        return "Minimal degradation expected"
    elif score >= 85:
        return "Slight quality trade-off"
    elif score >= 75:
        return "Moderate quality trade-off"
    return "Significant quality difference likely"


def _token_distribution(tokens: list) -> list:
    if not tokens:
        return []
    max_t = max(tokens)
    bucket_size = max(100, int(max_t / 8))
    buckets: dict = {}
    for t in tokens:
        b = (t // bucket_size) * bucket_size
        label = f"{b}-{b + bucket_size}"
        buckets[label] = buckets.get(label, 0) + 1
    total = len(tokens)
    return [
        {"bucket": k, "count": v, "pct": round(v / total * 100, 1)}
        for k, v in sorted(buckets.items(), key=lambda x: int(x[0].split("-")[0]))
    ]


def _percentiles(values: list) -> dict:
    if not values:
        return {"p50": 0, "p75": 0, "p90": 0, "p95": 0, "p99": 0}
    s = sorted(values)
    n = len(s)

    def p(pct: int) -> int:
        return s[min(int(n * pct / 100), n - 1)]

    return {"p50": p(50), "p75": p(75), "p90": p(90), "p95": p(95), "p99": p(99)}


def _cost_distribution_buckets(requests: list) -> list:
    if not requests:
        return []
    costs = [r.cost_usd for r in requests]
    max_c = max(costs)
    if max_c <= 0:
        return []
    bucket_size = max(0.0001, max_c / 6)
    buckets: dict = {}
    for r in requests:
        b = int(r.cost_usd / bucket_size) * bucket_size
        label = f"${b:.4f}"
        if label not in buckets:
            buckets[label] = {"bucket": label, "count": 0, "total_cost": 0.0, "upper": b + bucket_size}
        buckets[label]["count"] += 1
        buckets[label]["total_cost"] = round(buckets[label]["total_cost"] + r.cost_usd, 6)
    return sorted(buckets.values(), key=lambda x: x["upper"])
