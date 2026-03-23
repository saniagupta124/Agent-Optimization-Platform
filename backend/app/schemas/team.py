from pydantic import BaseModel


class CreateTeamRequest(BaseModel):
    name: str
    password: str


class JoinTeamRequest(BaseModel):
    name: str
    password: str


class TeamInfoResponse(BaseModel):
    id: str
    name: str
    member_count: int


class TeamMemberRow(BaseModel):
    id: str
    name: str
    email: str
    agent_count: int
    total_cost_7d: float
    total_requests_7d: int
    plan_tier: str


class TeamOverviewResponse(BaseModel):
    team_name: str
    team_id: str
    members: list[TeamMemberRow]
