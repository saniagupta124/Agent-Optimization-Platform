from pydantic import BaseModel, Field


class UsageBreakdown(BaseModel):
    label: str
    total_tokens: int = Field(ge=0)
    total_cost_usd: float = Field(ge=0)


class SubscriptionUsageResponse(BaseModel):
    scope: str = "me"
    is_team_aggregate: bool = Field(
        default=False, description="True when scope=team and org has multiple members"
    )
    plan_tier: str
    monthly_token_budget: int
    monthly_cost_budget_usd: float
    tokens_used: int
    cost_usd: float
    period_start: str
    period_end: str
    token_utilization: float = Field(
        description="0–100+; can exceed 100 when over budget"
    )
    cost_utilization: float
    by_provider: list[UsageBreakdown]
    by_model: list[UsageBreakdown]


class SubscriptionPlanSyncRequest(BaseModel):
    """
    Payload for a subscription provider sync.

    - `plan_tier` updates the tier name used for default caps.
    - `monthly_token_budget` / `monthly_cost_budget_usd` override those caps when set.
    """

    plan_tier: str | None = None
    monthly_token_budget: int | None = Field(default=None, ge=0)
    monthly_cost_budget_usd: float | None = Field(default=None, ge=0)


class SubscriptionPlanSyncResponse(BaseModel):
    plan_tier: str
    monthly_token_budget: int
    monthly_cost_budget_usd: float
