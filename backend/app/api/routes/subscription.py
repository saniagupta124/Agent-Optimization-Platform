from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.subscription import SubscriptionUsageResponse
from app.services.subscription_service import get_subscription_usage

router = APIRouter(prefix="/subscription")


@router.get("/usage", response_model=SubscriptionUsageResponse)
def usage(
    scope: str = Query(default="me"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if scope not in ("me", "team"):
        scope = "me"
    return get_subscription_usage(db, user, scope=scope)
