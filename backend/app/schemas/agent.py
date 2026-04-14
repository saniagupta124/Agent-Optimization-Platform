from datetime import datetime

from pydantic import BaseModel


class CreateAgentRequest(BaseModel):
    name: str
    purpose: str
    provider: str
    model: str
    # Last 4 chars for display when you do not send a full api_key (legacy).
    api_key_hint: str = ""
    # If set, server stores only a hash + hint — used to attribute /log_request by api_key.
    api_key: str | None = None
    # internal | production — used when logging requests without explicit environment.
    deployment_environment: str = "production"
    system_prompt: str | None = None
    max_tokens: int | None = None


class UpdateAgentRequest(BaseModel):
    name: str | None = None
    purpose: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    deployment_environment: str | None = None
    system_prompt: str | None = None
    max_tokens: int | None = None


class AgentResponse(BaseModel):
    id: str
    user_id: str
    name: str
    purpose: str
    provider: str
    model: str
    api_key_hint: str
    deployment_environment: str = "production"
    system_prompt: str | None = None
    max_tokens: int | None = None
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
    deployment_environment: str = "production"
    total_cost_7d: float = 0.0
    total_tokens_7d: int = 0
    request_count_7d: int = 0
    top_recommendation: str | None = None
