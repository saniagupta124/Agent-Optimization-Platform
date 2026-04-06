#!/usr/bin/env python3
"""Generate ~22k mock LLM request rows tied to a demo user and real Agent IDs."""

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
from app.db.models import Agent, Request, User
from app.services.auth_service import hash_password

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://user:password@postgres:5432/tokendb"
)

NUM_ROWS = 22000

SEED_USER_EMAIL = os.environ.get("SEED_USER_EMAIL", "demo@slash.dev")
SEED_USER_PASSWORD = os.environ.get("SEED_USER_PASSWORD", "demo12345")
SEED_USER_NAME = os.environ.get("SEED_USER_NAME", "Demo User")

# (role_key, display_name, purpose, default_provider, default_model, weight)
AGENT_SPECS: list[tuple[str, str, str, str, str, float]] = [
    ("support_agent", "Support Agent", "support", "openai", "openai/gpt-4o", 0.60),
    (
        "research_agent",
        "Research Agent",
        "research",
        "anthropic",
        "anthropic/claude-3-sonnet",
        0.15,
    ),
    ("code_agent", "Code Agent", "code_review", "openai", "openai/gpt-4o-mini", 0.12),
    ("sales_agent", "Sales Agent", "sales", "google", "google/gemini-pro", 0.08),
    ("email_agent", "Email Agent", "email", "perplexity", "perplexity/pplx-70b", 0.05),
]

PROVIDER_MODELS = {
    "openai": {
        "weight": 0.50,
        "models": ["openai/gpt-4o", "openai/gpt-4o-mini"],
        "model_weights": [0.6, 0.4],
    },
    "anthropic": {
        "weight": 0.30,
        "models": ["anthropic/claude-3-sonnet", "anthropic/claude-3-haiku"],
        "model_weights": [0.5, 0.5],
    },
    "perplexity": {
        "weight": 0.10,
        "models": ["perplexity/pplx-70b"],
        "model_weights": [1.0],
    },
    "google": {
        "weight": 0.10,
        "models": ["google/gemini-pro"],
        "model_weights": [1.0],
    },
}

LATENCY_RANGES = {
    "openai/gpt-4o": (1000, 4000),
    "openai/gpt-4o-mini": (500, 2000),
    "anthropic/claude-3-sonnet": (800, 3500),
    "anthropic/claude-3-haiku": (400, 1500),
    "perplexity/pplx-70b": (1200, 5000),
    "google/gemini-pro": (600, 3000),
}

FEATURE_TAGS = [
    "chat",
    "summarize",
    "classify",
    "extract",
    "generate",
    "translate",
    "analyze",
    "search",
    "draft",
    "review",
]

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
    normalized = [(c, w / total) for c, w in zip(customers, weights)]
    return normalized


def pick_weighted(items_weights: list[tuple[str, float]]) -> str:
    items, weights = zip(*items_weights)
    return random.choices(list(items), weights=list(weights), k=1)[0]


def generate_timestamp(days_back: int = 30) -> datetime:
    now = datetime.utcnow()
    day_offset = random.uniform(0, days_back)
    base = now - timedelta(days=day_offset)

    hour = base.hour
    weekday = base.weekday()

    if weekday >= 5:
        if random.random() < 0.6:
            day_offset = random.uniform(0, days_back)
            base = now - timedelta(days=day_offset)
    if hour < 8 or hour > 20:
        if random.random() < 0.5:
            base = base.replace(hour=random.randint(9, 17))

    return base


def generate_tokens(model: str, agent_role: str, is_outlier: bool) -> tuple[int, int]:
    base_prompt = random.randint(200, 1500)
    base_completion = random.randint(100, 1200)

    if agent_role == "support_agent" and model == "openai/gpt-4o":
        if random.random() < 0.3:
            base_prompt = random.randint(50, 200)
            base_completion = random.randint(30, 150)

    if is_outlier:
        base_prompt *= random.randint(8, 12)
        base_completion *= random.randint(8, 12)

    return base_prompt, base_completion


def get_or_create_demo_user(session) -> User:
    user = session.query(User).filter(User.email == SEED_USER_EMAIL).first()
    if user:
        return user
    user = User(
        email=SEED_USER_EMAIL,
        name=SEED_USER_NAME,
        password_hash=hash_password(SEED_USER_PASSWORD),
        organization_name="Demo Org",
        plan_tier="pro",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def ensure_seed_agents(session, user_id: str) -> dict[str, str]:
    """Return mapping role_key -> Agent.id (UUID string)."""
    role_to_id: dict[str, str] = {}
    for role_key, name, purpose, provider, model, _w in AGENT_SPECS:
        agent = (
            session.query(Agent)
            .filter(Agent.user_id == user_id, Agent.name == name)
            .first()
        )
        if not agent:
            agent = Agent(
                user_id=user_id,
                name=name,
                purpose=purpose,
                provider=provider,
                model=model,
                api_key_hint="demo",
            )
            session.add(agent)
            session.flush()
        role_to_id[role_key] = agent.id
    session.commit()
    return role_to_id


def main():
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    user = get_or_create_demo_user(session)
    role_to_id = ensure_seed_agents(session, user.id)
    agent_ids = list(role_to_id.values())

    deleted = (
        session.query(Request)
        .filter(Request.agent_id.in_(agent_ids))
        .delete(synchronize_session=False)
    )
    session.commit()
    print(
        f"Seeding user {user.email} (plan={user.plan_tier}); "
        f"cleared {deleted} existing request rows for seed agents."
    )

    weight_items = [(role_to_id[row[0]], row[5]) for row in AGENT_SPECS]

    customers = generate_pareto_customers(50)
    provider_items = [(k, v["weight"]) for k, v in PROVIDER_MODELS.items()]

    records = []
    for i in range(NUM_ROWS):
        agent_id = pick_weighted(weight_items)
        role_key = next(k for k, v in role_to_id.items() if v == agent_id)

        provider_name = pick_weighted(provider_items)
        provider_cfg = PROVIDER_MODELS[provider_name]

        model = random.choices(
            provider_cfg["models"], weights=provider_cfg["model_weights"], k=1
        )[0]

        customer_id = pick_weighted(customers)
        is_outlier = random.random() < 0.05
        prompt_tokens, completion_tokens = generate_tokens(
            model, role_key, is_outlier
        )
        total_tokens = prompt_tokens + completion_tokens

        cost = calculate_cost(prompt_tokens, completion_tokens, model)

        lat_range = LATENCY_RANGES[model]
        latency_ms = random.randint(lat_range[0], lat_range[1])
        if is_outlier:
            latency_ms = int(latency_ms * random.uniform(1.5, 3.0))

        timestamp = generate_timestamp(30)

        record = Request(
            id=str(uuid.uuid4()),
            timestamp=timestamp,
            agent_id=agent_id,
            project_id=random.choice(PROJECT_IDS),
            customer_id=customer_id,
            provider=provider_name,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=cost,
            latency_ms=latency_ms,
            status="success" if random.random() > 0.02 else "error",
            feature_tag=random.choice(FEATURE_TAGS),
            tool_calls=random.randint(1, 5),
        )
        records.append(record)

        if len(records) >= 1000:
            session.bulk_save_objects(records)
            session.commit()
            records = []
            print(f"  Inserted {i + 1}/{NUM_ROWS} rows...")

    if records:
        session.bulk_save_objects(records)
        session.commit()

    final_count = (
        session.query(Request).filter(Request.agent_id.in_(agent_ids)).count()
    )
    session.close()
    print(f"Done. Request rows for seed agents: {final_count}")
    print(
        f"Sign in as {SEED_USER_EMAIL} / {SEED_USER_PASSWORD} to view dashboard data."
    )


if __name__ == "__main__":
    main()
