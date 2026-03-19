from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.agent import AgentResponse, AgentWithStats, CreateAgentRequest
from app.schemas.optimization import OptimizationResponse
from app.services.agent_service import (
    create_agent,
    delete_agent,
    get_agent,
    get_agent_stats_7d,
    get_user_agents,
)
from app.services.optimization_service import get_optimizations

router = APIRouter(prefix="/agents")


@router.get("", response_model=list[AgentWithStats])
def list_agents(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    agents = get_user_agents(db, user.id)
    result = []
    for agent in agents:
        stats = get_agent_stats_7d(db, agent.id)
        opts = get_optimizations(db, agent)
        top_rec = (
            opts["recommendations"][0]["title"]
            if opts["recommendations"]
            else None
        )
        result.append(
            AgentWithStats(
                id=agent.id,
                user_id=agent.user_id,
                name=agent.name,
                purpose=agent.purpose,
                provider=agent.provider,
                model=agent.model,
                api_key_hint=agent.api_key_hint,
                created_at=agent.created_at,
                top_recommendation=top_rec,
                **stats,
            )
        )
    return result


@router.post("", response_model=AgentResponse, status_code=201)
def create(
    payload: CreateAgentRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    agent = create_agent(
        db,
        user.id,
        payload.name,
        payload.purpose,
        payload.provider,
        payload.model,
        payload.api_key_hint,
    )
    return agent


@router.get("/{agent_id}", response_model=AgentWithStats)
def get_single(
    agent_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    agent = get_agent(db, agent_id, user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    stats = get_agent_stats_7d(db, agent.id)
    opts = get_optimizations(db, agent)
    top_rec = (
        opts["recommendations"][0]["title"]
        if opts["recommendations"]
        else None
    )
    return AgentWithStats(
        id=agent.id,
        user_id=agent.user_id,
        name=agent.name,
        purpose=agent.purpose,
        provider=agent.provider,
        model=agent.model,
        api_key_hint=agent.api_key_hint,
        created_at=agent.created_at,
        top_recommendation=top_rec,
        **stats,
    )


@router.delete("/{agent_id}")
def remove(
    agent_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not delete_agent(db, agent_id, user.id):
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"ok": True}


@router.get("/{agent_id}/optimizations", response_model=OptimizationResponse)
def optimizations(
    agent_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    agent = get_agent(db, agent_id, user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return get_optimizations(db, agent)
