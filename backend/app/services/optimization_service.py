from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.pricing import MODEL_PRICING
from app.db.models import Agent, Request

CHEAP_ALTERNATIVES = {
    "openai/gpt-4o": "openai/gpt-4o-mini",
    "anthropic/claude-3-sonnet": "anthropic/claude-3-haiku",
}


def get_optimizations(db: Session, agent: Agent) -> dict:
    since_30d = datetime.utcnow() - timedelta(days=30)

    requests = (
        db.query(Request)
        .filter(
            Request.agent_id == agent.id,
            Request.timestamp >= since_30d,
        )
        .all()
    )

    if not requests:
        return {
            "agent_id": agent.id,
            "current_monthly_cost_estimate": 0.0,
            "recommendations": [],
            "provider_comparison": _provider_comparison(0, 0, agent.model),
        }

    total_cost = sum(r.cost_usd for r in requests)
    total_prompt = sum(r.prompt_tokens for r in requests)
    total_completion = sum(r.completion_tokens for r in requests)
    avg_tokens = sum(r.total_tokens for r in requests) / len(requests)

    recommendations = []

    # 1. Model efficiency
    _check_model_efficiency(
        recommendations, agent, avg_tokens, total_prompt, total_completion, total_cost
    )

    # 2. Prompt efficiency
    _check_prompt_efficiency(recommendations, total_prompt, total_completion, total_cost)

    # 3. Outlier detection
    _check_outliers(recommendations, requests)

    # 4. Provider comparison
    comparison = _provider_comparison(total_prompt, total_completion, agent.model)

    return {
        "agent_id": agent.id,
        "current_monthly_cost_estimate": round(total_cost, 2),
        "recommendations": recommendations,
        "provider_comparison": comparison,
    }


def _check_model_efficiency(
    recommendations: list,
    agent: Agent,
    avg_tokens: float,
    total_prompt: int,
    total_completion: int,
    total_cost: float,
) -> None:
    if agent.purpose not in ("support", "email"):
        return
    if agent.model not in CHEAP_ALTERNATIVES:
        return
    if avg_tokens >= 500:
        return

    alt = CHEAP_ALTERNATIVES[agent.model]
    alt_pricing = MODEL_PRICING.get(alt)
    if not alt_pricing:
        return

    alt_cost = (
        total_prompt * alt_pricing["input"] + total_completion * alt_pricing["output"]
    )
    savings = total_cost - alt_cost
    if savings <= 0:
        return

    severity = "high" if savings / max(total_cost, 0.01) > 0.5 else "medium"
    recommendations.append(
        {
            "type": "model_switch",
            "severity": severity,
            "title": f"Switch to {alt}",
            "description": (
                f"Your {agent.purpose} agent averages {avg_tokens:.0f} tokens/request. "
                f"{alt} handles this workload well at a fraction of the cost."
            ),
            "estimated_savings_usd": round(savings, 2),
            "action": f"Update model from {agent.model} to {alt}",
        }
    )


def _check_prompt_efficiency(
    recommendations: list,
    total_prompt: int,
    total_completion: int,
    total_cost: float,
) -> None:
    if total_prompt == 0:
        return

    ratio = total_completion / total_prompt
    if ratio >= 0.3:
        return

    recommendations.append(
        {
            "type": "prompt_efficiency",
            "severity": "medium",
            "title": "Prompts may be too verbose",
            "description": (
                f"Completion/prompt token ratio is {ratio:.2f} (below 0.3 threshold). "
                f"Consider trimming system prompts or reducing few-shot examples."
            ),
            "estimated_savings_usd": round(total_cost * 0.15, 2),
            "action": "Review and optimize prompt templates to reduce input token count",
        }
    )


def _check_outliers(recommendations: list, requests: list) -> None:
    if len(requests) < 20:
        return

    costs = sorted(r.cost_usd for r in requests)
    median_cost = costs[len(costs) // 2]

    if median_cost <= 0:
        return

    p95_idx = int(len(costs) * 0.95)
    top_5_pct = costs[p95_idx:]

    if not top_5_pct:
        return

    avg_top_5 = sum(top_5_pct) / len(top_5_pct)
    if avg_top_5 <= median_cost * 10:
        return

    outlier_total = sum(top_5_pct)
    recommendations.append(
        {
            "type": "token_limits",
            "severity": "high",
            "title": "Add max_token limits",
            "description": (
                f"Top 5% of requests cost 10x+ the median (${median_cost:.4f}). "
                f"Adding max_token limits could prevent cost spikes."
            ),
            "estimated_savings_usd": round(outlier_total * 0.5, 2),
            "action": "Set max_tokens parameter on API calls to cap runaway completions",
        }
    )


def _provider_comparison(
    total_prompt: int, total_completion: int, current_model: str
) -> list[dict]:
    current_pricing = MODEL_PRICING.get(current_model)
    current_cost = 0.0
    if current_pricing and (total_prompt + total_completion) > 0:
        current_cost = (
            total_prompt * current_pricing["input"]
            + total_completion * current_pricing["output"]
        )

    results = []
    for model_key, pricing in MODEL_PRICING.items():
        cost = (
            total_prompt * pricing["input"] + total_completion * pricing["output"]
        )

        vs = ""
        if current_cost > 0:
            diff_pct = ((cost - current_cost) / current_cost) * 100
            vs = f"{diff_pct:+.0f}%" if abs(diff_pct) > 0.5 else "same"

        results.append(
            {
                "provider": model_key.split("/")[0],
                "model": model_key,
                "estimated_monthly_cost": round(cost, 2),
                "vs_current": vs,
            }
        )

    return sorted(results, key=lambda x: x["estimated_monthly_cost"])
