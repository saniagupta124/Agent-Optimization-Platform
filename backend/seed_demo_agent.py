#!/usr/bin/env python3
"""
Seed a realistic demo agent (PortfolioRisk-GPT) under the kyna account
with 30 days of mock financial-model traces totalling ~$4,200/mo in spend.

Run with:
  DATABASE_URL=<prod-supabase-url> python3 seed_demo_agent.py
"""

import math
import os
import random
import sys
import uuid
from datetime import datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(__file__))

from app.db.models import Agent, Request

DATABASE_URL = os.environ["DATABASE_URL"].replace("postgres://", "postgresql://", 1)
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
Session = sessionmaker(bind=engine)

AGENT_NAME   = "PortfolioRisk-GPT"
PROVIDER     = "anthropic"
MODEL        = "anthropic/claude-3-5-sonnet-20241022"
PURPOSE      = "research"

# Enterprise financial pipeline — large context windows, high volume
# Spans: (span_name, prompt_base, completion_base, latency_base, tool_calls, weight)
SPANS = [
    ("market_data_fetch",      28000,  6000, 1800,  3, 0.30),
    ("risk_score_compute",     52000, 14000, 3200,  6, 0.25),
    ("portfolio_rebalance",    41000, 10000, 2600,  5, 0.20),
    ("compliance_check",       22000,  4500, 1200,  2, 0.15),
    ("report_generation",      68000, 22000, 4800,  8, 0.10),
]

COST_PER_INPUT_TOKEN  = 3.0e-6   # claude-3-5-sonnet input
COST_PER_OUTPUT_TOKEN = 15.0e-6  # claude-3-5-sonnet output

def rand_cost(p_tokens, c_tokens):
    return p_tokens * COST_PER_INPUT_TOKEN + c_tokens * COST_PER_OUTPUT_TOKEN

def jitter(base, pct=0.18):
    return max(1, int(base * random.uniform(1 - pct, 1 + pct)))

def main():
    db = Session()

    # Find kyna user
    row = db.execute(
        text("SELECT id FROM users WHERE email ILIKE '%kyna%' OR name ILIKE '%kyna%' ORDER BY created_at ASC LIMIT 1")
    ).fetchone()
    if not row:
        print("ERROR: No user matching 'kyna' found. Check email in DB.")
        sys.exit(1)
    user_id = row[0]
    print(f"Found user: {user_id}")

    # Remove old demo agent if re-running
    existing = db.execute(
        text("SELECT id FROM agents WHERE name = :n AND user_id = :u"),
        {"n": AGENT_NAME, "u": user_id}
    ).fetchone()
    if existing:
        agent_id = existing[0]
        db.execute(text("DELETE FROM requests WHERE agent_id = :a"), {"a": agent_id})
        db.execute(text("DELETE FROM span_recommendations WHERE agent_id = :a"), {"a": agent_id})
        db.execute(text("DELETE FROM agents WHERE id = :a"), {"a": agent_id})
        db.commit()
        print("Removed old demo agent, recreating...")

    # Create agent
    agent_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO agents (id, user_id, name, purpose, provider, model, api_key_hint,
                            deployment_environment, created_at)
        VALUES (:id, :uid, :name, :purpose, :provider, :model, :hint, 'production', NOW())
    """), {
        "id": agent_id, "uid": user_id, "name": AGENT_NAME,
        "purpose": PURPOSE, "provider": PROVIDER, "model": MODEL,
        "hint": "sk-ant-...demo",
    })
    db.commit()
    print(f"Created agent: {agent_id}")

    # Generate 30 days of requests
    now = datetime.utcnow()
    requests = []
    random.seed(42)

    for day_offset in range(30):
        ts_base = now - timedelta(days=30 - day_offset)
        # Volume ramps up over 30 days: starts at 60/day, grows to 140/day
        daily_volume = int(60 + (day_offset / 29) * 80)

        for _ in range(daily_volume):
            span_name, p_base, c_base, lat_base, tool_calls, _ = random.choices(
                SPANS, weights=[s[5] for s in SPANS]
            )[0]

            # Add occasional context-bloat runs (same prompt repeated)
            if random.random() < 0.12:
                p_tokens = p_base  # identical size — triggers redundant_calls detection
            else:
                p_tokens = jitter(p_base)

            c_tokens    = jitter(c_base)
            latency_ms  = jitter(lat_base, pct=0.25)
            cost        = rand_cost(p_tokens, c_tokens)
            ts          = ts_base + timedelta(
                hours=random.randint(0, 23),
                minutes=random.randint(0, 59),
                seconds=random.randint(0, 59),
            )
            status      = "error" if random.random() < 0.02 else "success"

            requests.append({
                "id":               str(uuid.uuid4()),
                "timestamp":        ts,
                "agent_id":         agent_id,
                "user_id":          user_id,
                "project_id":       "portfolio-risk",
                "customer_id":      "demo-enterprise",
                "provider":         PROVIDER,
                "model":            MODEL,
                "prompt_tokens":    p_tokens,
                "completion_tokens": c_tokens,
                "total_tokens":     p_tokens + c_tokens,
                "cost_usd":         cost,
                "latency_ms":       latency_ms,
                "status":           status,
                "feature_tag":      span_name,
                "tool_calls":       tool_calls,
                "environment":      "production",
                "endpoint_route":   f"/api/{span_name}",
                "error_detail":     "" if status == "success" else "timeout",
                "structure_valid":  True,
            })

    # Bulk insert
    db.execute(text("""
        INSERT INTO requests (id, timestamp, agent_id, user_id, project_id, customer_id,
            provider, model, prompt_tokens, completion_tokens, total_tokens,
            cost_usd, latency_ms, status, feature_tag, tool_calls,
            environment, endpoint_route, error_detail, structure_valid)
        VALUES (:id, :timestamp, :agent_id, :user_id, :project_id, :customer_id,
            :provider, :model, :prompt_tokens, :completion_tokens, :total_tokens,
            :cost_usd, :latency_ms, :status, :feature_tag, :tool_calls,
            :environment, :endpoint_route, :error_detail, :structure_valid)
    """), requests)
    db.commit()

    total_cost = sum(r["cost_usd"] for r in requests)
    print(f"Inserted {len(requests)} requests | Total cost: ${total_cost:,.2f} | Monthly est: ${total_cost:,.2f}")
    print("Done. Refresh the dashboard.")

if __name__ == "__main__":
    main()
