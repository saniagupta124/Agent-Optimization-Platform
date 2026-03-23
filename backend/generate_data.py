#!/usr/bin/env python3
"""Generate ~25k realistic mock LLM requests across 3 users with time-varying patterns.

Data tells a story across 30 days:
  Days 30-15 (baseline):  Stable usage, Support Agent on expensive gpt-4o
  Days 14-8  (spike):     Research Agent crunch, Sales burst, higher outlier rate
  Day  7     (switch):    Support Agent migrates to gpt-4o-mini
  Days  7-1  (post-opt):  Support costs drop ~60%, Code Agent ramps up
"""

import math
import os
import random
import sys
import uuid
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, "/app")

from app.core.pricing import calculate_cost
from app.db.base import Base
from app.db.models import Agent, Request, Team, User
from app.services.auth_service import hash_password

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://user:password@postgres:5432/tokendb"
)

# ---------------------------------------------------------------------------
# User specs
# ---------------------------------------------------------------------------
USERS = [
    {
        "email": "demo@slash.dev",
        "password": "demo12345",
        "name": "Demo User",
        "organization_name": "DemoTeam",
        "plan_tier": "pro",
    },
    {
        "email": "alice@acme-labs.io",
        "password": "alice12345",
        "name": "Alice Chen",
        "organization_name": "DemoTeam",
        "plan_tier": "pro",
    },
    {
        "email": "bob@acme-labs.io",
        "password": "bob12345",
        "name": "Bob Martinez",
        "organization_name": "DemoTeam",
        "plan_tier": "free",
    },
]

# ---------------------------------------------------------------------------
# Agent specs — (owner_email, name, purpose, provider, model, feature_tags)
# ---------------------------------------------------------------------------
AGENT_SPECS = [
    # Demo User's agents
    ("demo@slash.dev", "Support Agent", "support", "openai", "openai/gpt-4o",
     ["chat", "classify", "summarize"]),
    ("demo@slash.dev", "Research Agent", "research", "anthropic", "anthropic/claude-3-sonnet",
     ["analyze", "search", "extract", "summarize"]),
    ("demo@slash.dev", "Code Agent", "code_review", "openai", "openai/gpt-4o-mini",
     ["review", "generate", "analyze"]),
    # Alice's agents
    ("alice@acme-labs.io", "Sales Agent", "sales", "google", "google/gemini-pro",
     ["draft", "generate", "chat"]),
    ("alice@acme-labs.io", "Email Agent", "email", "openai", "openai/gpt-4o-mini",
     ["draft", "summarize", "translate"]),
    ("alice@acme-labs.io", "Data Pipeline", "general", "perplexity", "perplexity/pplx-70b",
     ["extract", "analyze", "search"]),
    # Bob's agents
    ("bob@acme-labs.io", "Compliance Bot", "general", "anthropic", "anthropic/claude-3-haiku",
     ["classify", "extract", "review"]),
    ("bob@acme-labs.io", "Internal Tools", "general", "google", "google/gemini-pro",
     ["generate", "chat", "search"]),
]

# Per-agent daily request rates by phase.
# Index matches AGENT_SPECS order.
# Phases: baseline (days 30-15), spike (days 14-8), post_opt (days 7-0)
PHASE_RATES = {
    #                     Support  Research  Code   Sales  Email  Pipeline  Compliance  Internal
    "baseline":          [220,     55,       35,    45,    40,    30,       22,         18],
    "spike":             [260,     130,      45,    100,   65,    40,       28,         22],
    "post_opt":          [240,     65,       90,    50,    45,    35,       25,         20],
}

# Model override: Support Agent uses gpt-4o-mini in post_opt phase
SUPPORT_MODEL_SWITCH = {
    "baseline": "openai/gpt-4o",
    "spike": "openai/gpt-4o",
    "post_opt": "openai/gpt-4o-mini",
}

LATENCY_RANGES = {
    "openai/gpt-4o": (1000, 4000),
    "openai/gpt-4o-mini": (500, 2000),
    "anthropic/claude-3-sonnet": (800, 3500),
    "anthropic/claude-3-haiku": (400, 1500),
    "perplexity/pplx-70b": (1200, 5000),
    "google/gemini-pro": (600, 3000),
}

PROJECT_IDS = ["proj_alpha", "proj_beta", "proj_gamma", "proj_delta"]


def generate_pareto_customers(n: int = 50) -> list[tuple[str, float]]:
    customers = [f"cust_{i:04d}" for i in range(1, n + 1)]
    top_count = max(1, n // 5)
    weights = []
    for i in range(n):
        if i < top_count:
            weights.append(random.uniform(8.0, 15.0))
        else:
            weights.append(random.uniform(0.5, 2.0))
    total = sum(weights)
    return [(c, w / total) for c, w in zip(customers, weights)]


def pick_weighted(items_weights: list[tuple[str, float]]) -> str:
    items, weights = zip(*items_weights)
    return random.choices(list(items), weights=list(weights), k=1)[0]


def get_phase(days_ago: float) -> str:
    if days_ago >= 15:
        return "baseline"
    elif days_ago >= 8:
        return "spike"
    else:
        return "post_opt"


def business_hour_weight(hour: int) -> float:
    """Bell curve peaking at 1pm, low overnight."""
    if hour < 6 or hour > 22:
        return 0.1
    return 0.3 + 0.7 * math.exp(-0.5 * ((hour - 13) / 3) ** 2)


def generate_timestamp(days_ago_center: float) -> datetime:
    """Generate a timestamp around a specific day with business-hour weighting."""
    now = datetime.utcnow()
    jitter = random.gauss(0, 0.3)  # ±0.3 day jitter
    actual_days = max(0.01, days_ago_center + jitter)
    base = now - timedelta(days=actual_days)

    # Reject-sample for business hour weighting
    for _ in range(10):
        hour = random.randint(0, 23)
        if random.random() < business_hour_weight(hour):
            base = base.replace(hour=hour, minute=random.randint(0, 59),
                                second=random.randint(0, 59))
            break

    # Reduce weekend volume
    if base.weekday() >= 5 and random.random() < 0.5:
        shift = 1 if base.weekday() == 5 else -1
        base = base + timedelta(days=shift)

    return base


def generate_tokens(model: str, purpose: str, is_outlier: bool) -> tuple[int, int]:
    """Generate prompt/completion tokens based on model and purpose.

    Tuned so different agents trigger different optimization recommendations:
    - support: low avg tokens (< 500 total) → triggers model_switch rec
    - research: low completion/prompt ratio (< 0.3) → triggers prompt_efficiency rec
    - others: normal ranges → outlier detection is main rec
    """
    if purpose == "support":
        # Keep total tokens low so avg < 500 → triggers model_switch recommendation
        base_prompt = random.randint(80, 250)
        base_completion = random.randint(40, 150)
    elif purpose == "research":
        # High prompt, low completion ratio < 0.3 → triggers prompt_efficiency
        base_prompt = random.randint(800, 2500)
        base_completion = random.randint(50, 300)
    elif purpose == "code_review":
        base_prompt = random.randint(400, 1800)
        base_completion = random.randint(200, 1200)
    elif purpose == "sales":
        base_prompt = random.randint(200, 1000)
        base_completion = random.randint(150, 800)
    elif purpose == "email":
        # Also low avg tokens → triggers model_switch for email agents
        base_prompt = random.randint(60, 200)
        base_completion = random.randint(40, 120)
    else:  # general
        base_prompt = random.randint(200, 1200)
        base_completion = random.randint(100, 800)

    if is_outlier:
        base_prompt *= random.randint(8, 15)
        base_completion *= random.randint(8, 15)

    return base_prompt, base_completion


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
def ensure_team(session) -> Team:
    """Create or get the DemoTeam. Password is 'team12345'."""
    team = session.query(Team).filter(Team.name == "DemoTeam").first()
    if not team:
        team = Team(
            name="DemoTeam",
            password_hash=hash_password("team12345"),
        )
        session.add(team)
        session.flush()
    session.commit()
    return team


def ensure_users(session, team: Team) -> dict[str, User]:
    """Create or get all seed users. Returns {email: User}."""
    email_to_user: dict[str, User] = {}
    for spec in USERS:
        user = session.query(User).filter(User.email == spec["email"]).first()
        if not user:
            user = User(
                email=spec["email"],
                name=spec["name"],
                password_hash=hash_password(spec["password"]),
                organization_name=spec["organization_name"],
                team_id=team.id,
                plan_tier=spec["plan_tier"],
            )
            session.add(user)
            session.flush()
        else:
            # Ensure existing users are in the team
            if not user.team_id:
                user.team_id = team.id
                user.organization_name = team.name
        email_to_user[spec["email"]] = user
    session.commit()
    return email_to_user


def ensure_agents(session, email_to_user: dict[str, User]) -> list[dict]:
    """Create or get all seed agents. Returns list of agent info dicts."""
    agents_info = []
    for idx, (owner_email, name, purpose, provider, model, tags) in enumerate(AGENT_SPECS):
        user = email_to_user[owner_email]
        agent = (
            session.query(Agent)
            .filter(Agent.user_id == user.id, Agent.name == name)
            .first()
        )
        if not agent:
            agent = Agent(
                user_id=user.id,
                name=name,
                purpose=purpose,
                provider=provider,
                model=model,
                api_key_hint="demo",
            )
            session.add(agent)
            session.flush()
        agents_info.append({
            "idx": idx,
            "agent": agent,
            "purpose": purpose,
            "default_model": model,
            "provider": provider,
            "tags": tags,
        })
    session.commit()
    return agents_info


def main():
    random.seed(42)  # Reproducible data

    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    team = ensure_team(session)
    email_to_user = ensure_users(session, team)
    agents_info = ensure_agents(session, email_to_user)

    # Clear existing request data for seed agents
    agent_ids = [a["agent"].id for a in agents_info]
    deleted = (
        session.query(Request)
        .filter(Request.agent_id.in_(agent_ids))
        .delete(synchronize_session=False)
    )
    session.commit()

    print(f"Seeded {len(email_to_user)} users, {len(agents_info)} agents.")
    print(f"Cleared {deleted} existing request rows.")

    customers = generate_pareto_customers(50)

    # Generate requests day-by-day for realistic time patterns
    records: list[Request] = []
    total_generated = 0

    for day_offset in range(31):  # day 0 (today) through day 30
        days_ago = 30 - day_offset  # 30, 29, ..., 0
        phase = get_phase(days_ago)

        for agent_info in agents_info:
            idx = agent_info["idx"]
            agent = agent_info["agent"]
            purpose = agent_info["purpose"]
            tags = agent_info["tags"]

            # Determine model for this agent in this phase
            if agent.name == "Support Agent":
                model = SUPPORT_MODEL_SWITCH[phase]
                provider = "openai"
            else:
                model = agent_info["default_model"]
                provider = agent_info["provider"]

            # Base rate with ±20% daily noise
            base_rate = PHASE_RATES[phase][idx]
            daily_count = max(1, int(base_rate * random.uniform(0.8, 1.2)))

            # Reduce weekend volume
            ref_date = datetime.utcnow() - timedelta(days=days_ago)
            if ref_date.weekday() >= 5:
                daily_count = max(1, int(daily_count * 0.4))

            # Outlier rate varies by phase
            outlier_rate = 0.03 if phase == "baseline" else (0.08 if phase == "spike" else 0.04)

            for _ in range(daily_count):
                is_outlier = random.random() < outlier_rate
                prompt_tokens, completion_tokens = generate_tokens(model, purpose, is_outlier)
                total_tokens = prompt_tokens + completion_tokens
                cost = calculate_cost(prompt_tokens, completion_tokens, model)

                lat_range = LATENCY_RANGES[model]
                latency_ms = random.randint(lat_range[0], lat_range[1])
                if is_outlier:
                    latency_ms = int(latency_ms * random.uniform(1.5, 3.0))

                timestamp = generate_timestamp(days_ago)

                # Error rate: slightly higher during spike
                error_chance = 0.01 if phase != "spike" else 0.03
                status = "error" if random.random() < error_chance else "success"

                record = Request(
                    id=str(uuid.uuid4()),
                    timestamp=timestamp,
                    agent_id=agent.id,
                    project_id=random.choice(PROJECT_IDS),
                    customer_id=pick_weighted(customers),
                    provider=provider,
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    cost_usd=cost,
                    latency_ms=latency_ms,
                    status=status,
                    feature_tag=random.choice(tags),
                    tool_calls=random.randint(1, 5),
                )
                records.append(record)
                total_generated += 1

            # Flush in batches
            if len(records) >= 1000:
                session.bulk_save_objects(records)
                session.commit()
                records = []
                print(f"  {total_generated} rows inserted...")

    if records:
        session.bulk_save_objects(records)
        session.commit()

    final_count = (
        session.query(Request).filter(Request.agent_id.in_(agent_ids)).count()
    )
    session.close()

    print(f"\nDone. Total request rows: {final_count}")
    print(f"\nLogin credentials:")
    for u in USERS:
        print(f"  {u['email']} / {u['password']}  (plan: {u['plan_tier']})")
    print(f"\nDashboard login: demo@slash.dev / demo12345")
    print(f"Team: DemoTeam / team12345")


if __name__ == "__main__":
    main()
