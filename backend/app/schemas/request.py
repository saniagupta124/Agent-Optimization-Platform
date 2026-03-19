from datetime import datetime

from pydantic import BaseModel


class LogRequestInput(BaseModel):
    agent_id: str
    customer_id: str
    model: str
    messages: list[dict]
    project_id: str = ""
    feature_tag: str = ""


class LogRequestResponse(BaseModel):
    id: str
    timestamp: datetime
    agent_id: str
    project_id: str
    customer_id: str
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    latency_ms: int
    status: str
    feature_tag: str

    class Config:
        from_attributes = True
