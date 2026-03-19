from datetime import datetime

from pydantic import BaseModel


class CreateAgentRequest(BaseModel):
    name: str
    purpose: str
    provider: str
    model: str
    api_key_hint: str = ""


class AgentResponse(BaseModel):
    id: str
    user_id: str
    name: str
    purpose: str
    provider: str
    model: str
    api_key_hint: str
    created_at: datetime

    class Config:
        from_attributes = True


class AgentWithStats(BaseModel):
    id: str
    user_id: str
    name: str
    purpose: str
    provider: str
    model: str
    api_key_hint: str
    created_at: datetime
    total_cost_7d: float = 0.0
    total_tokens_7d: int = 0
    request_count_7d: int = 0
    top_recommendation: str | None = None
