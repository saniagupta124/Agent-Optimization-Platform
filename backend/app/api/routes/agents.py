import base64
import json
import urllib.error
import urllib.request
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Agent, User
from app.db.session import get_db
from app.schemas.agent import AgentResponse, AgentWithStats, CreateAgentRequest, UpdateAgentRequest
from app.schemas.optimization import OptimizationResponse
from app.services.agent_service import (
    create_agent,
    delete_agent,
    get_agent,
    get_agent_for_viewer,
    get_agent_stats_7d,
    get_agents_for_users,
    get_user_agents,
    update_agent,
)
from app.services.optimization_service import get_optimizations
from app.services.scope import resolve_team_user_ids, team_view_available

router = APIRouter(prefix="/agents")


@router.get("", response_model=list[AgentWithStats])
def list_agents(
    scope: str = Query(
        default="me",
        description="'me' = your agents; 'team' = all agents in your organization",
    ),
    deployment: str | None = Query(
        default=None,
        description="Optional: internal | production",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if scope not in ("me", "team"):
        scope = "me"
    dep = deployment if deployment in ("internal", "production") else None
    if scope == "team" and team_view_available(user):
        uids = resolve_team_user_ids(db, user)
        agents = get_agents_for_users(db, uids)
    else:
        agents = get_user_agents(db, user.id)
    if dep:
        agents = [a for a in agents if a.deployment_environment == dep]
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
                deployment_environment=agent.deployment_environment,
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
    try:
        agent = create_agent(
            db,
            user.id,
            payload.name,
            payload.purpose,
            payload.provider,
            payload.model,
            payload.api_key_hint,
            api_key=payload.api_key,
            deployment_environment=payload.deployment_environment,
            system_prompt=payload.system_prompt,
            max_tokens=payload.max_tokens,
            repo_url=payload.repo_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return agent


@router.patch("/{agent_id}", response_model=AgentResponse)
def patch_agent(
    agent_id: str,
    payload: UpdateAgentRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    agent = get_agent(db, agent_id, user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    try:
        updated = update_agent(
            db,
            agent,
            name=payload.name,
            purpose=payload.purpose,
            provider=payload.provider,
            model=payload.model,
            api_key=payload.api_key,
            deployment_environment=payload.deployment_environment,
            system_prompt=payload.system_prompt,
            max_tokens=payload.max_tokens,
            repo_url=payload.repo_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return updated


@router.get("/{agent_id}", response_model=AgentWithStats)
def get_single(
    agent_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    agent = get_agent_for_viewer(db, agent_id, user)
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
        deployment_environment=agent.deployment_environment,
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
    agent = get_agent_for_viewer(db, agent_id, user)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return get_optimizations(db, agent)


def _gh_request(url: str, token: str, method: str = "GET", data: bytes | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _create_github_pr(
    token: str,
    repo: str,
    rec_type: str,
    agent_name: str,
    agent_model: str,
    savings_usd: float,
) -> str | None:
    """Create a branch + file + PR on GitHub; return the PR HTML URL."""
    try:
        # 1. Get default branch
        repo_info = _gh_request(f"https://api.github.com/repos/{repo}", token)
        default_branch = repo_info.get("default_branch", "main")

        # 2. Get latest SHA
        refs_data = _gh_request(
            f"https://api.github.com/repos/{repo}/git/refs/heads/{default_branch}", token
        )
        sha = refs_data["object"]["sha"]

        # 3. Create branch
        branch_name = f"traeco/rec-{rec_type}-{date.today().isoformat()}"
        _gh_request(
            f"https://api.github.com/repos/{repo}/git/refs",
            token,
            method="POST",
            data=json.dumps({"ref": f"refs/heads/{branch_name}", "sha": sha}).encode(),
        )

        # 4. Build markdown content
        rec_type_title = rec_type.replace("_", " ").title()
        code_snippets: dict[str, str] = {
            "model_switch": f'model="{agent_model}"  # → change to cheaper model',
            "model_swap": f'model="{agent_model}"  # → change to cheaper model',
            "prompt_caching": (
                'response = anthropic.messages.create(\n'
                '    model="...",\n'
                '    system=[{"type": "text", "text": SYSTEM_PROMPT,\n'
                '             "cache_control": {"type": "ephemeral"}}],\n'
                '    messages=[...],\n'
                '    max_tokens=1024,\n'
                ')'
            ),
            "max_tokens_cap": "max_tokens=500  # add this parameter",
            "context_bloat": "# Trim your system prompt — currently over 1,500 tokens",
            "prompt_efficiency": "# Trim your system prompt — currently over 1,500 tokens",
            "redundant_calls": "# Add request-level caching/deduplication",
            "retry_loop": "# Add retry limit: max_retries=3",
        }
        snippet = code_snippets.get(rec_type, "# See Traeco dashboard for specific change")
        md = (
            f"# Traeco Recommendation: {rec_type_title}\n\n"
            f"**Agent:** {agent_name}  \n"
            f"**Estimated savings:** ${savings_usd:.2f}/mo\n\n"
            "## What to change\n\n"
            f"```python\n{snippet}\n```\n\n"
            "## Why\n\n"
            "This change was flagged by Traeco based on your agent's usage patterns.\n"
            "Close this PR once you've applied the change manually, or add a commit with the actual code change.\n"
        )
        file_content_b64 = base64.b64encode(md.encode()).decode()

        # 5. Create file in the new branch
        _gh_request(
            f"https://api.github.com/repos/{repo}/contents/traeco-changes/{rec_type}.md",
            token,
            method="PUT",
            data=json.dumps({
                "message": f"traeco: add {rec_type} recommendation",
                "content": file_content_b64,
                "branch": branch_name,
            }).encode(),
        )

        # 6. Create PR
        pr_data = _gh_request(
            f"https://api.github.com/repos/{repo}/pulls",
            token,
            method="POST",
            data=json.dumps({
                "title": f"[Traeco] {rec_type_title} — ${savings_usd:.2f}/mo potential savings",
                "body": md,
                "head": branch_name,
                "base": default_branch,
            }).encode(),
        )
        return pr_data.get("html_url")
    except Exception:
        return None


@router.post("/{agent_id}/implement")
def implement_recommendation(
    agent_id: str,
    rec_type: str = Query(default=""),
    repo: str = Query(default=""),
    agent_name: str = Query(default=""),
    savings_usd: float = Query(default=0.0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns pr_url when GitHub repo is connected; null otherwise (fall back to manual steps)."""
    agent = get_agent_for_viewer(db, agent_id, user)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Resolve repo: prefer query param, fall back to agent.repo_url
    effective_repo = repo.strip() if repo.strip() else (agent.repo_url or "").strip()

    if not user.github_token or not effective_repo:
        return {"pr_url": None, "rec_type": rec_type}

    # Persist repo_url on the agent if it came in fresh
    if repo.strip() and agent.repo_url != repo.strip():
        agent.repo_url = repo.strip()
        db.commit()

    effective_name = agent_name.strip() if agent_name.strip() else agent.name
    pr_url = _create_github_pr(
        token=user.github_token,
        repo=effective_repo,
        rec_type=rec_type,
        agent_name=effective_name,
        agent_model=agent.model,
        savings_usd=savings_usd,
    )
    return {"pr_url": pr_url, "rec_type": rec_type}
