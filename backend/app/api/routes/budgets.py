"""Quality budget endpoints — GET and POST /budgets/{agent_id}."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.models import Agent, QualityBudget, SdkApiKey, User
from app.db.session import get_db
from app.services.auth_service import decode_access_token

router = APIRouter(tags=["quality-budgets"])


# ── Auth helper (mirrors agent_dashboard.py) ──────────────────────────────────

def _resolve_user(request: Request, db: Session) -> User:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        payload = decode_access_token(token)
        if payload:
            user = db.query(User).filter(User.id == payload["sub"]).first()
            if user:
                return user

    traeco_key = request.headers.get("X-Traeco-Key", "")
    if traeco_key:
        import hashlib
        h = hashlib.sha256(traeco_key.encode()).hexdigest()
        row = db.query(SdkApiKey).filter(SdkApiKey.key_hash == h).first()
        if row:
            user = db.query(User).filter(User.id == row.user_id).first()
            if user:
                row.last_used_at = datetime.utcnow()
                db.commit()
                return user

    raise HTTPException(status_code=401, detail="Authentication required")


def _resolve_agent(db: Session, user: User, agent_id: str) -> Agent:
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return agent


# ── Schemas ───────────────────────────────────────────────────────────────────

class QualityBudgetIn(BaseModel):
    max_judge_preference_drop: float = 2.0
    max_faithfulness_drop: float = 2.0
    max_structure_drop: float = 0.0
    max_latency_increase_ms: float = 200.0
    on_breach: str = "alert_only"


class QualityBudgetOut(BaseModel):
    agent_id: str
    max_judge_preference_drop: float
    max_faithfulness_drop: float
    max_structure_drop: float
    max_latency_increase_ms: float
    on_breach: str
    created_at: datetime
    updated_at: datetime


# ── GET /budgets/{agent_id} ───────────────────────────────────────────────────

@router.get("/budgets/{agent_id}", response_model=QualityBudgetOut)
def get_budget(
    agent_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    user = _resolve_user(request, db)
    _resolve_agent(db, user, agent_id)

    budget = db.query(QualityBudget).filter(QualityBudget.agent_id == agent_id).first()
    if not budget:
        # Return defaults without persisting
        now = datetime.utcnow()
        return QualityBudgetOut(
            agent_id=agent_id,
            max_judge_preference_drop=2.0,
            max_faithfulness_drop=2.0,
            max_structure_drop=0.0,
            max_latency_increase_ms=200.0,
            on_breach="alert_only",
            created_at=now,
            updated_at=now,
        )

    return QualityBudgetOut(
        agent_id=budget.agent_id,
        max_judge_preference_drop=budget.max_judge_preference_drop,
        max_faithfulness_drop=budget.max_faithfulness_drop,
        max_structure_drop=budget.max_structure_drop,
        max_latency_increase_ms=budget.max_latency_increase_ms,
        on_breach=budget.on_breach,
        created_at=budget.created_at,
        updated_at=budget.updated_at,
    )


# ── POST /budgets/{agent_id} ──────────────────────────────────────────────────

@router.post("/budgets/{agent_id}", response_model=QualityBudgetOut)
def upsert_budget(
    agent_id: str,
    payload: QualityBudgetIn,
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    user = _resolve_user(request, db)
    _resolve_agent(db, user, agent_id)

    budget = db.query(QualityBudget).filter(QualityBudget.agent_id == agent_id).first()
    now = datetime.utcnow()
    if budget:
        budget.max_judge_preference_drop = payload.max_judge_preference_drop
        budget.max_faithfulness_drop = payload.max_faithfulness_drop
        budget.max_structure_drop = payload.max_structure_drop
        budget.max_latency_increase_ms = payload.max_latency_increase_ms
        budget.on_breach = payload.on_breach
        budget.updated_at = now
    else:
        budget = QualityBudget(
            agent_id=agent_id,
            max_judge_preference_drop=payload.max_judge_preference_drop,
            max_faithfulness_drop=payload.max_faithfulness_drop,
            max_structure_drop=payload.max_structure_drop,
            max_latency_increase_ms=payload.max_latency_increase_ms,
            on_breach=payload.on_breach,
            created_at=now,
            updated_at=now,
        )
        db.add(budget)

    db.commit()
    db.refresh(budget)

    return QualityBudgetOut(
        agent_id=budget.agent_id,
        max_judge_preference_drop=budget.max_judge_preference_drop,
        max_faithfulness_drop=budget.max_faithfulness_drop,
        max_structure_drop=budget.max_structure_drop,
        max_latency_increase_ms=budget.max_latency_increase_ms,
        on_breach=budget.on_breach,
        created_at=budget.created_at,
        updated_at=budget.updated_at,
    )
