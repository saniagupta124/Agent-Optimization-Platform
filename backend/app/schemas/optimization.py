from pydantic import BaseModel


class OptimizationRecommendation(BaseModel):
    type: str
    severity: str
    title: str
    description: str
    estimated_savings_usd: float
    action: str


class ProviderComparison(BaseModel):
    provider: str
    model: str
    estimated_monthly_cost: float
    vs_current: str


class OptimizationResponse(BaseModel):
    agent_id: str
    current_monthly_cost_estimate: float
    recommendations: list[OptimizationRecommendation]
    provider_comparison: list[ProviderComparison]
