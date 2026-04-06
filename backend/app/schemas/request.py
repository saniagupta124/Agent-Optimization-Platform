from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class LogRequestInput(BaseModel):
    # Either register your key on an agent and send api_key here, or send agent_id.
    agent_id: str | None = None
    api_key: str | None = None
    customer_id: str = "default"
    model: str
    messages: list[dict] = Field(default_factory=list)
    project_id: str = ""
    feature_tag: str = ""
    tool_calls: int | None = None
    # Attributed environment (defaults to agent.deployment_environment).
    environment: str | None = None
    endpoint_route: str = ""
    error_detail: str | None = None

    # Optional "real usage" fields.
    # If provided, ingestion will use them directly instead of simulating tokens.
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None
    latency_ms: int | None = None
    status: str | None = None

    @model_validator(mode="after")
    def require_agent_or_key(self):
        has_id = bool(self.agent_id and str(self.agent_id).strip())
        has_key = bool(self.api_key and str(self.api_key).strip())
        if not has_id and not has_key:
            raise ValueError("Provide agent_id or api_key")
        return self


class LogRequestResponse(BaseModel):
    id: str
    timestamp: datetime
    agent_id: str
    user_id: str | None = None
    team_id: str | None = None
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
    tool_calls: int
    environment: str = "production"
    endpoint_route: str = ""
    error_detail: str = ""

    class Config:
        from_attributes = True
