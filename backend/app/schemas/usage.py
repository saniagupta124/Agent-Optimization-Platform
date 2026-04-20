from pydantic import BaseModel, Field


class TopChangeItem(BaseModel):
    rank: int
    title: str
    description: str
    action: str
    estimated_savings_usd: float
    severity: str
    type: str
    agent_id: str
    agent_name: str
    confidence_rating: str = "low"
    confidence_n: int = 0
    confidence_score: int = 0
    quality_impact: str = "none"
    verdict: str = "insufficient_data"
    verdict_rationale: str = ""
    latency_p95_ms: float | None = None
    latency_p95_baseline_ms: float | None = None
    structure_conformance_pct: float | None = None


class BehavioralComparison(BaseModel):
    window_days: int
    before_period_label: str
    after_period_label: str
    avg_tokens_before: float
    avg_tokens_after: float
    tokens_pct_change: float
    avg_tool_calls_before: float
    avg_tool_calls_after: float
    tool_calls_pct_change: float
    avg_latency_ms_before: float
    avg_latency_ms_after: float
    latency_pct_change: float
    cost_per_request_before: float
    cost_per_request_after: float
    cost_per_request_pct_change: float


class UsageSummaryResponse(BaseModel):
    scope: str = "me"
    team_view_available: bool = False
    team_member_count: int = 1
    potential_savings_usd: float = Field(
        default=0, description="Sum of estimated savings for top 3 optimization actions"
    )
    top_changes: list[TopChangeItem] = Field(default_factory=list)
    period_days: int
    current_total_cost_usd: float
    previous_total_cost_usd: float
    cost_change_pct: float | None = Field(
        default=None, description="Percent vs prior period; None if not comparable"
    )
    total_tokens: int
    request_count: int
    avg_tokens_per_request: float
    avg_tool_calls_per_request: float
    stability_score: float = Field(description="Share of successful requests, 0–100")
    monthly_cost_usd: float
    monthly_tokens: int
    monthly_token_budget: int
    monthly_cost_budget_usd: float
    plan_tier: str
    token_budget_utilization_pct: float
    cost_budget_utilization_pct: float
    behavioral: BehavioralComparison
    insights: list[str]


class BreakdownRow(BaseModel):
    label: str
    total_cost_usd: float
    total_tokens: int
    request_count: int
    share_of_cost_pct: float


class UsageBreakdownResponse(BaseModel):
    scope: str = "me"
    period_days: int
    by_model: list[BreakdownRow]
    by_endpoint: list[BreakdownRow]
    by_step: list[BreakdownRow] = Field(
        default_factory=list,
        description="Cost grouped by @span name (feature_tag). Only rows where feature_tag is set.",
    )
    by_provider: list[BreakdownRow] = Field(
        default_factory=list,
        description="Cost grouped by LLM provider (anthropic, openai, …).",
    )
    by_agent: list[BreakdownRow] = Field(
        default_factory=list,
        description="Cost grouped by agent, for the selected period.",
    )


class TimelinePoint(BaseModel):
    date: str
    cost_usd: float
    total_tokens: int
    request_count: int


class UsageTimelineResponse(BaseModel):
    scope: str = "me"
    period_days: int
    points: list[TimelinePoint]
