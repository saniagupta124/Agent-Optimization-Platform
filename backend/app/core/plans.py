"""Subscription plan limits (tokens + spend per calendar month)."""

from typing import TypedDict


class PlanLimits(TypedDict):
    monthly_token_budget: int
    monthly_cost_budget_usd: float


PLAN_LIMITS: dict[str, PlanLimits] = {
    "free": {"monthly_token_budget": 100_000, "monthly_cost_budget_usd": 25.0},
    "pro": {"monthly_token_budget": 2_000_000, "monthly_cost_budget_usd": 500.0},
    "team": {"monthly_token_budget": 10_000_000, "monthly_cost_budget_usd": 2_500.0},
}


def limits_for_tier(plan_tier: str) -> PlanLimits:
    return PLAN_LIMITS.get(plan_tier, PLAN_LIMITS["free"])
