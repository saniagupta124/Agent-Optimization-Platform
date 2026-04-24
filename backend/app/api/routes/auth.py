from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    UpdateProfileRequest,
    UserResponse,
)
from app.services.auth_service import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    delete_user,
    get_user_by_id,
    register_user,
    update_user,
)

router = APIRouter(prefix="/auth")


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        organization_name=user.organization_name,
        plan_tier=user.plan_tier,
        created_at=user.created_at,
    )


@router.post("/register", response_model=AuthResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    try:
        user = register_user(
            db,
            payload.email,
            payload.name,
            payload.password,
            payload.organization_name,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(e)
        )
    token = create_access_token(user.id, user.email)
    refresh = create_refresh_token(user.id, user.email)
    return AuthResponse(access_token=token, refresh_token=refresh, user=_user_response(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    token = create_access_token(user.id, user.email)
    refresh = create_refresh_token(user.id, user.email)
    return AuthResponse(access_token=token, refresh_token=refresh, user=_user_response(user))


@router.post("/refresh")
def refresh_token(payload: RefreshRequest, db: Session = Depends(get_db)):
    data = decode_refresh_token(payload.refresh_token)
    if not data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    user = get_user_by_id(db, data["sub"])
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    new_token = create_access_token(user.id, user.email)
    return {"access_token": new_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return _user_response(user)


@router.put("/me", response_model=UserResponse)
def update_profile(
    payload: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updated = update_user(db, user, payload.name, payload.organization_name)
    return _user_response(updated)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    delete_user(db, user)
