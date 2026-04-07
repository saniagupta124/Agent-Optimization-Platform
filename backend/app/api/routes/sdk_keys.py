import hashlib
import secrets

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import SdkApiKey, User
from app.db.session import get_db

router = APIRouter(prefix="/sdk-keys")


class SdkKeyOut(BaseModel):
    id: str
    name: str
    key_prefix: str
    created_at: str
    last_used_at: str | None = None


class SdkKeyCreated(SdkKeyOut):
    raw_key: str


class CreateSdkKeyBody(BaseModel):
    name: str = "Default"


@router.get("", response_model=list[SdkKeyOut])
def list_keys(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    keys = db.query(SdkApiKey).filter(SdkApiKey.user_id == user.id).all()
    return [
        SdkKeyOut(
            id=k.id,
            name=k.name,
            key_prefix=k.key_prefix,
            created_at=k.created_at.isoformat(),
            last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
        )
        for k in keys
    ]


@router.post("", response_model=SdkKeyCreated, status_code=201)
def create_key(
    body: CreateSdkKeyBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raw = "tk_live_" + secrets.token_urlsafe(32)
    prefix = raw[:16]
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key = SdkApiKey(
        user_id=user.id,
        name=body.name,
        key_prefix=prefix,
        key_hash=key_hash,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return SdkKeyCreated(
        id=key.id,
        name=key.name,
        key_prefix=prefix,
        created_at=key.created_at.isoformat(),
        raw_key=raw,
    )
