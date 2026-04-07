"""GitHub API helpers for opening implementation PRs."""
import base64
import re
import secrets
from typing import Optional

import requests as http

GITHUB_API = "https://api.github.com"


def _gh(method: str, url: str, token: str, **kwargs) -> dict:
    resp = http.request(
        method,
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        **kwargs,
    )
    if not resp.ok:
        raise ValueError(f"GitHub API error {resp.status_code}: {resp.text}")
    return resp.json()


def parse_repo(repo_url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a GitHub URL or 'owner/repo' string."""
    match = re.search(r"github\.com[/:]([^/]+)/([^/\s.]+)", repo_url)
    if match:
        return match.group(1), match.group(2).removesuffix(".git")
    parts = repo_url.strip("/").split("/")
    if len(parts) >= 2:
        return parts[-2], parts[-1].removesuffix(".git")
    raise ValueError(f"Cannot parse repo from: {repo_url!r}")


def _get_default_branch(token: str, owner: str, repo: str) -> str:
    data = _gh("GET", f"{GITHUB_API}/repos/{owner}/{repo}", token)
    return data["default_branch"]


def _get_branch_sha(token: str, owner: str, repo: str, branch: str) -> str:
    data = _gh("GET", f"{GITHUB_API}/repos/{owner}/{repo}/git/ref/heads/{branch}", token)
    return data["object"]["sha"]


def _get_file(token: str, owner: str, repo: str, path: str) -> tuple[str, str]:
    """Returns (decoded_content, sha)."""
    data = _gh("GET", f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path.lstrip('/')}", token)
    content = base64.b64decode(data["content"]).decode("utf-8")
    return content, data["sha"]


def _create_branch(token: str, owner: str, repo: str, branch: str, sha: str) -> None:
    _gh("POST", f"{GITHUB_API}/repos/{owner}/{repo}/git/refs", token, json={
        "ref": f"refs/heads/{branch}",
        "sha": sha,
    })


def _commit_file(
    token: str, owner: str, repo: str, path: str,
    content: str, message: str, branch: str, sha: str,
) -> None:
    _gh("PUT", f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path.lstrip('/')}", token, json={
        "message": message,
        "content": base64.b64encode(content.encode()).decode(),
        "sha": sha,
        "branch": branch,
    })


def _create_pr(
    token: str, owner: str, repo: str,
    title: str, body: str, head: str, base: str,
) -> str:
    data = _gh("POST", f"{GITHUB_API}/repos/{owner}/{repo}/pulls", token, json={
        "title": title,
        "body": body,
        "head": head,
        "base": base,
    })
    return data["html_url"]


# ---------------------------------------------------------------------------
# Diff generators
# ---------------------------------------------------------------------------

def _apply_model_switch(content: str, old_model: str, new_model: str) -> str:
    """Replace occurrences of old_model string with new_model."""
    old_name = old_model.split("/")[-1]
    new_name = new_model.split("/")[-1]
    result = content
    # Replace full provider/model strings first, then bare model names
    for old, new in [
        (f'"{old_model}"', f'"{new_model}"'),
        (f"'{old_model}'", f"'{new_model}'"),
        (f'"{old_name}"', f'"{new_name}"'),
        (f"'{old_name}'", f"'{new_name}'"),
    ]:
        result = result.replace(old, new)
    return result


def _apply_token_limits(content: str, max_tokens: int) -> str:
    """Insert max_tokens= after model= in LLM API calls."""
    # Match .create(...model="...", or model='...' — insert max_tokens after it
    result = re.sub(
        r'(model\s*=\s*["\'][^"\']+["\'])',
        lambda m: m.group(0) + f",\n        max_tokens={max_tokens}",
        content,
    )
    return result


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

def open_implement_pr(
    github_token: str,
    repo_url: str,
    file_path: str,
    rec_type: str,
    agent_name: str,
    current_model: str,
    recommended_model: Optional[str] = None,
    recommended_max_tokens: Optional[int] = None,
    base_branch: Optional[str] = None,
) -> str:
    """Open a GitHub PR implementing the recommendation. Returns PR URL."""
    owner, repo = parse_repo(repo_url)
    default_branch = base_branch or _get_default_branch(github_token, owner, repo)
    base_sha = _get_branch_sha(github_token, owner, repo, default_branch)

    content, file_sha = _get_file(github_token, owner, repo, file_path)

    branch = f"traeco/{rec_type.replace('_', '-')}-{secrets.token_hex(4)}"
    _create_branch(github_token, owner, repo, branch, base_sha)

    if rec_type == "model_switch" and recommended_model:
        new_content = _apply_model_switch(content, current_model, recommended_model)
        old_name = current_model.split("/")[-1]
        new_name = recommended_model.split("/")[-1]
        pr_title = f"[TRAECO] Switch {agent_name} model: {old_name} → {new_name}"
        commit_msg = f"chore: switch {old_name} to {new_name} (TRAECO cost optimization)"
        pr_body = (
            f"## TRAECO Cost Optimization — Model Switch\n\n"
            f"Switches **{agent_name}** from `{current_model}` to `{recommended_model}`.\n\n"
            f"Based on 30-day usage analysis, observed tasks are within `{new_name}`'s "
            f"capability range at significantly lower cost per token.\n\n"
            f"> *Generated automatically by [TRAECO](https://traeco.dev)*"
        )
    elif rec_type == "token_limits" and recommended_max_tokens:
        new_content = _apply_token_limits(content, recommended_max_tokens)
        pr_title = f"[TRAECO] Add max_tokens={recommended_max_tokens} to {agent_name}"
        commit_msg = f"chore: add max_tokens={recommended_max_tokens} cap (TRAECO cost optimization)"
        pr_body = (
            f"## TRAECO Cost Optimization — Token Limits\n\n"
            f"Adds `max_tokens={recommended_max_tokens}` to **{agent_name}**'s API calls.\n\n"
            f"Calculated from 30-day usage data (p99 of observed completion lengths). "
            f"Eliminates the long tail of runaway completions that inflate costs.\n\n"
            f"> *Generated automatically by [TRAECO](https://traeco.dev)*"
        )
    else:
        raise ValueError(f"Cannot auto-implement recommendation type: {rec_type!r}")

    if new_content == content:
        raise ValueError(
            f"No changes detected in {file_path!r}. "
            f"Make sure the model string or API call pattern is present in the file."
        )

    _commit_file(github_token, owner, repo, file_path, new_content, commit_msg, branch, file_sha)
    return _create_pr(github_token, owner, repo, pr_title, pr_body, branch, default_branch)
