from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.pricing import CHEAP_ALTERNATIVES, MODEL_PRICING
from app.db.models import Agent, Request

# ── Task-capability profiles ──────────────────────────────────────────────────
# Each purpose maps to:
#   complexity  — "simple" | "moderate" | "complex"
#   rationale   — why this task doesn't need a frontier model (shown in description)
#   token_cap   — avg tokens/request above which we stop recommending a downgrade
#                 (high token counts signal the task may genuinely need the model)
_PURPOSE_PROFILES: dict[str, dict] = {
    "support": {
        "complexity": "simple",
        "rationale": "Support ticket classification, FAQ lookup, and short responses don't require frontier reasoning.",
        "token_cap": 1_000,
    },
    "email": {
        "complexity": "simple",
        "rationale": "Email drafting and summarization are well within fast model capabilities.",
        "token_cap": 800,
    },
    "sales": {
        "complexity": "simple",
        "rationale": "Lead qualification, CRM enrichment, and short-form outreach don't need frontier models.",
        "token_cap": 1_000,
    },
    "general": {
        "complexity": "moderate",
        "rationale": "General-purpose tasks rarely require frontier reasoning unless average request length is high.",
        "token_cap": 600,
    },
    "code_review": {
        "complexity": "complex",
        "rationale": "Code review benefits from stronger reasoning, but a balanced model is sufficient for most diffs.",
        "token_cap": 2_500,
    },
    "research": {
        "complexity": "complex",
        "rationale": "Research summaries and synthesis benefit from capable models, but mid-tier handles most cases well.",
        "token_cap": 2_000,
    },
}

# Frontier models — using these for simple/moderate tasks is overkill
_FRONTIER_MODELS = {
    "openai/gpt-4o", "openai/o1", "openai/o1-mini",
    "anthropic/claude-opus-4-6", "anthropic/claude-3-opus",
    "anthropic/claude-sonnet-4-6", "anthropic/claude-3-5-sonnet",
    "anthropic/claude-sonnet-4-5", "anthropic/claude-3-5-sonnet-20241022",
}

# Mid-tier models — fine for moderate tasks, overkill for simple ones
_MID_TIER_MODELS = {
    "openai/gpt-4o-mini", "openai/o3-mini",
    "anthropic/claude-3-5-haiku", "anthropic/claude-haiku-4-5",
    "google/gemini-1.5-pro",
}

# Best-fit model recommendations per purpose, per provider
_RECOMMENDED_MODELS: dict[str, dict[str, str]] = {
    "support":     {"openai": "openai/gpt-4o-mini",      "anthropic": "anthropic/claude-haiku-4-5",    "google": "google/gemini-1.5-flash", "perplexity": "perplexity/pplx-70b"},
    "email":       {"openai": "openai/gpt-4o-mini",      "anthropic": "anthropic/claude-haiku-4-5",    "google": "google/gemini-1.5-flash", "perplexity": "perplexity/pplx-70b"},
    "sales":       {"openai": "openai/gpt-4o-mini",      "anthropic": "anthropic/claude-haiku-4-5",    "google": "google/gemini-1.5-flash", "perplexity": "perplexity/pplx-70b"},
    "general":     {"openai": "openai/gpt-4o-mini",      "anthropic": "anthropic/claude-3-5-haiku",    "google": "google/gemini-1.5-flash", "perplexity": "perplexity/pplx-70b"},
    "code_review": {"openai": "openai/gpt-4o",           "anthropic": "anthropic/claude-sonnet-4-6",   "google": "google/gemini-1.5-pro",   "perplexity": "perplexity/pplx-70b"},
    "research":    {"openai": "openai/gpt-4o",           "anthropic": "anthropic/claude-sonnet-4-6",   "google": "google/gemini-1.5-pro",   "perplexity": "perplexity/pplx-70b"},
}


def get_optimizations(db: Session, agent: Agent, period_days: int = 30) -> dict:
    since_30d = datetime.utcnow() - timedelta(days=period_days)

    requests = (
        db.query(Request)
        .filter(
            Request.agent_id == agent.id,
            Request.timestamp >= since_30d,
        )
        .all()
    )

    if not requests:
        day0_recs: list = []
        _check_context_bloat(day0_recs, agent, 0)
        _check_token_scaling(day0_recs, agent)
        return {
            "agent_id": agent.id,
            "current_monthly_cost_estimate": 0.0,
            "recommendations": day0_recs,
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

    # 4. Context bloat — savings based on actual prompt token spend
    _check_context_bloat(recommendations, agent, len(requests), total_prompt, total_cost)

    # 5. Non-linear token scaling — savings based on actual total spend
    _check_token_scaling(recommendations, agent, len(requests), total_cost)

    # 6. Retry logic — detect error bursts and compounding request cost
    _check_retry_logic(recommendations, requests, total_cost)

    # 7. Provider comparison
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
    profile = _PURPOSE_PROFILES.get(agent.purpose)
    if not profile:
        return

    # Don't recommend a downgrade if the agent is already using an appropriate model
    # or if avg token usage is high enough to justify the current model
    if avg_tokens > profile["token_cap"]:
        return

    # Determine the right-sized model for this purpose and provider
    provider = agent.provider.lower() if agent.provider else ""
    recommended = _RECOMMENDED_MODELS.get(agent.purpose, {}).get(provider)

    # Fall back to the CHEAP_ALTERNATIVES map if no purpose-specific recommendation
    if not recommended:
        recommended = CHEAP_ALTERNATIVES.get(agent.model)

    if not recommended or recommended == agent.model:
        return

    # Verify there's actually a cost difference
    alt_pricing = MODEL_PRICING.get(recommended)
    if not alt_pricing:
        return

    alt_cost = total_prompt * alt_pricing["input"] + total_completion * alt_pricing["output"]
    savings = total_cost - alt_cost
    if savings <= 0:
        return

    savings_pct = savings / max(total_cost, 0.01)
    severity = "high" if savings_pct > 0.5 else "medium"

    complexity = profile["complexity"]
    rationale = profile["rationale"]

    # Build a description that names the task type and explains the fit
    if complexity == "simple":
        fit_note = f"{rationale} Your average of {avg_tokens:.0f} tokens/request confirms this."
    elif complexity == "moderate":
        fit_note = f"{rationale} At {avg_tokens:.0f} avg tokens/request, a mid-tier model covers this workload."
    else:
        fit_note = f"{rationale} At {avg_tokens:.0f} avg tokens/request, the current model may be over-engineered."

    recommendations.append(
        {
            "type": "model_switch",
            "severity": severity,
            "title": f"Switch to {recommended}",
            "description": (
                f"Cheaper model handles this workload. "
                f"Switch from {agent.model} to {recommended} — saves ${savings:.2f}/mo ({savings_pct * 100:.0f}%)."
            ),
            "estimated_savings_usd": round(savings, 2),
            "action": f"Update model from {agent.model} to {recommended}",
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
                f"Output/input ratio is {ratio:.2f} — you're sending far more tokens in than you get back. "
                "Trim system prompts or reduce few-shot examples."
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
                f"Top 5% of requests cost 10x+ the median (${median_cost:.4f} each). "
                "A max_tokens cap would eliminate these outliers."
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


_CHARS_PER_TOKEN = 4
_CONTEXT_BLOAT_THRESHOLD = 1_500
_ESTIMATED_MONTHLY_RUNS = 10_000

# Agentic purposes where multi-turn tool-call chains are common
_AGENTIC_PURPOSES = {"research", "code_review", "general"}


def _check_context_bloat(
    recommendations: list,
    agent: Agent,
    actual_request_count: int,
    actual_prompt_tokens: int = 0,
    actual_total_cost: float = 0.0,
) -> None:
    if not agent.system_prompt:
        return

    prompt_tokens = len(agent.system_prompt) // _CHARS_PER_TOKEN
    if prompt_tokens <= _CONTEXT_BLOAT_THRESHOLD:
        return

    severity = "high" if prompt_tokens > 3_000 else "medium"
    excess_tokens = prompt_tokens - _CONTEXT_BLOAT_THRESHOLD

    if actual_request_count > 0 and actual_prompt_tokens > 0 and actual_total_cost > 0:
        # Savings based on observed spend:
        # system prompt fraction of total prompt tokens → fraction of total cost
        system_prompt_fraction = min(prompt_tokens / max(actual_prompt_tokens / actual_request_count, 1), 1.0)
        system_prompt_cost = actual_total_cost * system_prompt_fraction
        excess_fraction = excess_tokens / prompt_tokens
        potential_savings = system_prompt_cost * excess_fraction
        cost_note = f"${system_prompt_cost:.2f} spent on system prompt tokens last 30 days"
    else:
        monthly_runs = max(actual_request_count, _ESTIMATED_MONTHLY_RUNS)
        pricing = MODEL_PRICING.get(agent.model)
        potential_savings = 0.0
        system_prompt_cost = 0.0
        if pricing:
            system_prompt_cost = prompt_tokens * pricing["input"] * monthly_runs
            potential_savings = excess_tokens * pricing["input"] * monthly_runs
        cost_note = f"~${system_prompt_cost:.2f}/mo projected at {max(actual_request_count, _ESTIMATED_MONTHLY_RUNS):,} runs"

    recommendations.append(
        {
            "type": "context_bloat",
            "severity": severity,
            "title": "System prompt re-sent on every request",
            "description": (
                f"System prompt is ~{prompt_tokens:,} tokens — {excess_tokens:,} tokens of overhead billed on every request. "
                f"Trim to under {_CONTEXT_BLOAT_THRESHOLD:,} tokens."
            ),
            "estimated_savings_usd": round(potential_savings, 2),
            "action": (
                f"Reduce system prompt from ~{prompt_tokens:,} to under "
                f"{_CONTEXT_BLOAT_THRESHOLD:,} tokens. Consider caching static context "
                "or moving reference data out of the system prompt."
            ),
        }
    )


def _check_token_scaling(recommendations: list, agent: Agent, actual_request_count: int = 0, actual_total_cost: float = 0.0) -> None:
    """Day-0 check: flag agents with no max_tokens cap.

    In multi-turn tool-call chains each tool result appends to the context window.
    Without a cap, cost grows quadratically with chain depth — 5 tool calls at
    2k tokens each = 2k+4k+6k+8k+10k = 30k tokens total instead of 10k.
    """
    if agent.max_tokens is not None:
        return

    is_agentic = agent.purpose in _AGENTIC_PURPOSES
    severity = "high" if is_agentic else "medium"

    # Savings estimate:
    # If we have real spend data, apply a conservative 30% reduction estimate
    # (5-step chain wastes ~2/3 of input tokens, but not all requests are chains)
    # If no data yet, show $0 — can't quantify without observing chain depth.
    if actual_total_cost > 0:
        potential_savings = round(actual_total_cost * 0.30, 2)
        spend_note = f"${actual_total_cost:.2f} spent last 30 days — up to 30% may be excess context accumulation"
    else:
        potential_savings = 0.0
        spend_note = "no spend data yet — risk grows with chain depth"

    pricing = MODEL_PRICING.get(agent.model)
    example_cost_uncapped = 0.0
    example_cost_capped = 0.0
    if pricing:
        uncapped_tokens = sum((i + 1) * 2000 for i in range(5))  # 30k illustrative
        capped_tokens = 5 * 2000
        example_cost_uncapped = uncapped_tokens * pricing["input"] * 1_000
        example_cost_capped = capped_tokens * pricing["input"] * 1_000

    recommendations.append(
        {
            "type": "token_scaling",
            "severity": severity,
            "title": "No max_tokens cap — cost grows quadratically with chain depth",
            "description": (
                f"No max_tokens cap set. Context accumulates across tool calls — cost grows quadratically with chain depth. "
                f"{spend_note}."
            ),
            "estimated_savings_usd": potential_savings,
            "action": (
                "Set max_tokens on every API call (e.g. max_tokens=1024). "
                "For tool-call chains, also consider truncating or summarizing "
                "previous tool outputs before appending to context."
            ),
        }
    )


_RETRY_ERROR_RATE_THRESHOLD = 0.05  # 5% error rate triggers recommendation
_RETRY_BURST_WINDOW_SECS = 10       # 3+ calls in 10s = burst retry pattern
_RETRY_MIN_REQUESTS = 10


def _check_retry_logic(
    recommendations: list,
    requests: list,
    total_cost: float,
) -> None:
    """Detect retry loops from error-rate data and burst call patterns."""
    if len(requests) < _RETRY_MIN_REQUESTS:
        return

    # Signal 1: requests where status == "error"
    error_reqs = [r for r in requests if r.status == "error"]
    error_rate = len(error_reqs) / len(requests)
    error_cost = sum(r.cost_usd for r in error_reqs)

    # Signal 2: burst call patterns — 3+ requests in same span within 10s
    span_timestamps: dict = defaultdict(list)
    for r in requests:
        tag = r.feature_tag or "untagged"
        span_timestamps[tag].append(r.timestamp)

    retry_spans: list = []
    for span_name, timestamps in span_timestamps.items():
        timestamps.sort()
        for i in range(len(timestamps) - 2):
            if (timestamps[i + 2] - timestamps[i]).total_seconds() <= _RETRY_BURST_WINDOW_SECS:
                retry_spans.append(span_name)
                break

    has_error_signal = error_rate >= _RETRY_ERROR_RATE_THRESHOLD
    has_burst_signal = len(retry_spans) > 0

    if not has_error_signal and not has_burst_signal:
        return

    # Build description from whichever signals fired
    if has_error_signal and error_cost > 0:
        error_pct = round(error_rate * 100, 1)
        cost_note = (
            f"{error_pct}% of calls failed last 30 days — "
            f"${error_cost:.2f} spent on failed requests"
        )
        potential_savings = round(error_cost, 2)
    elif has_error_signal:
        error_pct = round(error_rate * 100, 1)
        cost_note = f"{error_pct}% of calls failed (${total_cost * error_rate:.2f} estimated wasted)"
        potential_savings = round(total_cost * error_rate, 2)
    else:
        cost_note = (
            f"{len(retry_spans)} span(s) show burst call patterns "
            f"(3+ calls within {_RETRY_BURST_WINDOW_SECS}s)"
        )
        potential_savings = round(total_cost * 0.10, 2)

    burst_note = ""
    if has_burst_signal:
        burst_note = (
            f" Burst retries detected in: {', '.join(retry_spans[:3])}."
            + (" (and more)" if len(retry_spans) > 3 else "")
        )

    severity = "high" if error_rate >= 0.10 or len(retry_spans) >= 3 else "medium"

    recommendations.append(
        {
            "type": "retry_logic",
            "severity": severity,
            "title": "Retry loops compounding request cost",
            "description": (
                f"{cost_note}.{burst_note} "
                "Retries re-send the full prompt — wasted spend with no useful output."
            ),
            "estimated_savings_usd": potential_savings,
            "action": (
                "Add exponential backoff with a max retry cap (e.g. 3 retries). "
                "Cache successful responses where possible. "
                "Log error types to distinguish transient failures from logic errors."
            ),
        }
    )
