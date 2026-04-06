from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.subscription import (
    SubscriptionPlanSyncRequest,
    SubscriptionPlanSyncResponse,
    SubscriptionUsageResponse,
)
from app.services.subscription_service import get_subscription_usage
from app.core.plans import limits_for_user

router = APIRouter(prefix="/subscription")


@router.get("/usage", response_model=SubscriptionUsageResponse)
def usage(
    scope: str = Query(default="me"),
    deployment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if scope not in ("me", "team"):
        scope = "me"
    dep = deployment if deployment in ("internal", "production") else None
    return get_subscription_usage(db, user, scope=scope, deployment=dep)


@router.post("/sync", response_model=SubscriptionPlanSyncResponse)
def sync_plan(
    payload: SubscriptionPlanSyncRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Provider sync sets user-level defaults for caps used by /subscription/usage.
    if payload.plan_tier is not None:
        user.plan_tier = payload.plan_tier
    if payload.monthly_token_budget is not None:
        user.monthly_token_budget_override = payload.monthly_token_budget
    if payload.monthly_cost_budget_usd is not None:
        user.monthly_cost_budget_usd_override = payload.monthly_cost_budget_usd

    db.commit()
    db.refresh(user)

    limits = limits_for_user(
        user.plan_tier,
        monthly_token_budget_override=user.monthly_token_budget_override,
        monthly_cost_budget_usd_override=user.monthly_cost_budget_usd_override,
    )

    return SubscriptionPlanSyncResponse(
        plan_tier=user.plan_tier,
        monthly_token_budget=limits["monthly_token_budget"],
        monthly_cost_budget_usd=limits["monthly_cost_budget_usd"],
    )
