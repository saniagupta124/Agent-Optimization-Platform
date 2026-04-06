from datetime import datetime

from pydantic import BaseModel


class OverviewMetrics(BaseModel):
    total_cost: float
    total_tokens: int
    request_count: int
    avg_latency: float


class GroupedMetric(BaseModel):
    group: str
    total_cost: float
    total_tokens: int
    request_count: int


class OutlierRecord(BaseModel):
    id: str
    timestamp: datetime
    agent_id: str
    customer_id: str
    provider: str
    model: str
    total_tokens: int
    cost_usd: float
    latency_ms: int


class TimeseriesPoint(BaseModel):
    date: str
    total_cost: float
    total_tokens: int


class ApiKeyUsageRow(BaseModel):
    """Spend/tokens per registered agent (one API key per agent when key is stored)."""

    agent_id: str
    agent_name: str
    api_key_hint: str
    total_cost: float
    total_tokens: int
    request_count: int
