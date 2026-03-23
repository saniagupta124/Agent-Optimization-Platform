"""Lightweight additive schema updates for existing DBs (no Alembic in this repo)."""

from sqlalchemy import text

from app.db.session import engine


def ensure_schema() -> None:
    """Add columns introduced after initial deploys."""
    stmts = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(32) NOT NULL DEFAULT 'free'",
        "CREATE INDEX IF NOT EXISTS ix_users_plan_tier ON users (plan_tier)",
        "ALTER TABLE requests ADD COLUMN IF NOT EXISTS tool_calls INTEGER NOT NULL DEFAULT 1",
    ]
    with engine.begin() as conn:
        for sql in stmts:
            conn.execute(text(sql))
