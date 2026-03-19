#!/usr/bin/env python3
"""Generate 20,000+ realistic mock LLM request records."""

import math
import os
import random
import uuid
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import sys
sys.path.insert(0, "/app")

from app.core.pricing import calculate_cost
from app.db.base import Base
from app.db.models import Request

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://user:password@postgres:5432/tokendb"
)

NUM_ROWS = 22000

AGENTS = {
    "support_agent": 0.60,
    "research_agent": 0.15,
    "code_agent": 0.12,
    "sales_agent": 0.08,
    "email_agent": 0.05,
}

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
    "chat", "summarize", "classify", "extract", "generate",
    "translate", "analyze", "search", "draft", "review",
]

PROJECT_IDS = ["proj_alpha", "proj_beta", "proj_gamma", "proj_delta"]


def generate_pareto_customers(n: int = 50) -> list[tuple[str, float]]:
    """Generate customer IDs with Pareto-distributed weights.
    Top 20% of customers get ~80% of the request weight.
    """
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
    """Generate a timestamp within the last N days with business-hour bias."""
    now = datetime.utcnow()
    day_offset = random.uniform(0, days_back)
    base = now - timedelta(days=day_offset)

    hour = base.hour
    weekday = base.weekday()

    # Business hours bias: reject and resample ~60% of off-hours timestamps
    if weekday >= 5:  # weekend
        if random.random() < 0.6:
            day_offset = random.uniform(0, days_back)
            base = now - timedelta(days=day_offset)
    if hour < 8 or hour > 20:
        if random.random() < 0.5:
            base = base.replace(hour=random.randint(9, 17))

    return base


def generate_tokens(model: str, agent_id: str, is_outlier: bool) -> tuple[int, int]:
    """Generate realistic token counts. Outliers get 10x normal."""
    base_prompt = random.randint(200, 1500)
    base_completion = random.randint(100, 1200)

    # support_agent sometimes uses gpt-4o for simple tasks (low tokens, high cost)
    if agent_id == "support_agent" and model == "openai/gpt-4o":
        if random.random() < 0.3:
            base_prompt = random.randint(50, 200)
            base_completion = random.randint(30, 150)

    if is_outlier:
        base_prompt *= random.randint(8, 12)
        base_completion *= random.randint(8, 12)

    return base_prompt, base_completion


def main():
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Check if data already exists
    existing = session.query(Request).count()
    if existing > 0:
        print(f"Database already has {existing} rows. Clearing...")
        session.query(Request).delete()
        session.commit()

    customers = generate_pareto_customers(50)
    agent_items = list(AGENTS.items())
    provider_items = [(k, v["weight"]) for k, v in PROVIDER_MODELS.items()]

    records = []
    for i in range(NUM_ROWS):
        agent_id = pick_weighted(agent_items)
        provider_name = pick_weighted(provider_items)
        provider_cfg = PROVIDER_MODELS[provider_name]

        model = random.choices(
            provider_cfg["models"], weights=provider_cfg["model_weights"], k=1
        )[0]

        customer_id = pick_weighted(customers)
        is_outlier = random.random() < 0.05
        prompt_tokens, completion_tokens = generate_tokens(model, agent_id, is_outlier)
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

    final_count = session.query(Request).count()
    session.close()
    print(f"Done. Total rows in database: {final_count}")


if __name__ == "__main__":
    main()
