from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db

router = APIRouter(prefix="/onboarding")


@router.get("")
def get_onboarding_status(user: User = Depends(get_current_user)):
    return {"onboarding_completed": user.onboarding_completed}


@router.post("/complete")
def complete_onboarding(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user.onboarding_completed = True
    db.commit()
    return {"ok": True, "onboarding_completed": True}
