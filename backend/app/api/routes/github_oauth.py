"""GitHub OAuth: connect/disconnect a user's GitHub account."""
import base64
import hashlib
import hmac
import json
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.models import User
from app.db.session import get_db

router = APIRouter(prefix="/auth/github")


def _sign_state(user_id: str, redirect_path: str = "/settings") -> str:
    redirect_b64 = base64.urlsafe_b64encode(redirect_path.encode()).decode()
    payload = f"{user_id}:{redirect_b64}"
    sig = hmac.new(settings.JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _verify_state(state: str) -> tuple[str, str] | None:
    # state = "{user_id}:{redirect_b64}:{hmac}"
    parts = state.rsplit(":", 1)
    if len(parts) != 2:
        return None
    payload, sig = parts
    expected = hmac.new(settings.JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    inner = payload.split(":", 1)
    if len(inner) != 2:
        return None
    user_id, redirect_b64 = inner
    try:
        redirect_path = base64.urlsafe_b64decode(redirect_b64.encode()).decode()
    except Exception:
        redirect_path = "/settings"
    return user_id, redirect_path


@router.get("/connect-url")
def github_connect_url(
    next: str = Query(default="/settings"),
    user: User = Depends(get_current_user),
):
    """Return the GitHub OAuth URL the frontend should redirect to."""
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured — set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET")
    state = _sign_state(user.id, next)
    params = urllib.parse.urlencode({
        "client_id": settings.GITHUB_CLIENT_ID,
        "scope": "repo",
        "state": state,
    })
    return {"url": f"https://github.com/login/oauth/authorize?{params}"}


@router.get("/callback")
def github_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    """Exchange GitHub OAuth code for token, store it, redirect to frontend settings."""
    result = _verify_state(state)
    if not result:
        return RedirectResponse(f"{settings.FRONTEND_URL}/settings?github=error&reason=invalid_state")
    user_id, redirect_path = result

    # Exchange code for access token
    data = urllib.parse.urlencode({
        "client_id": settings.GITHUB_CLIENT_ID,
        "client_secret": settings.GITHUB_CLIENT_SECRET,
        "code": code,
    }).encode()
    req = urllib.request.Request(
        "https://github.com/login/oauth/access_token",
        data=data,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            token_data = json.loads(resp.read())
    except Exception:
        return RedirectResponse(f"{settings.FRONTEND_URL}/settings?github=error&reason=token_exchange")

    access_token = token_data.get("access_token")
    if not access_token:
        return RedirectResponse(f"{settings.FRONTEND_URL}/settings?github=error&reason=no_token")

    # Fetch GitHub username
    req2 = urllib.request.Request(
        "https://api.github.com/user",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.urlopen(req2) as resp2:
            gh_user = json.loads(resp2.read())
        username = gh_user.get("login", "")
    except Exception:
        username = ""

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return RedirectResponse(f"{settings.FRONTEND_URL}/settings?github=error&reason=user_not_found")

    user.github_token = access_token
    user.github_username = username
    db.commit()

    return RedirectResponse(f"{settings.FRONTEND_URL}{redirect_path}?github=connected")


@router.get("/status")
def github_status(user: User = Depends(get_current_user)):
    """Return GitHub connection status for the current user."""
    return {
        "connected": bool(user.github_token),
        "username": user.github_username or "",
    }


@router.delete("/disconnect")
def github_disconnect(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Remove stored GitHub token."""
    user.github_token = None
    user.github_username = None
    db.commit()
    return {"ok": True}
