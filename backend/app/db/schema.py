"""Lightweight additive schema updates for existing DBs (no Alembic in this repo)."""

from sqlalchemy import text

from app.db.session import engine


def ensure_schema() -> None:
    """Add columns introduced after initial deploys."""
    stmts = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(32) NOT NULL DEFAULT 'free'",
        "CREATE INDEX IF NOT EXISTS ix_users_plan_tier ON users (plan_tier)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_token_budget_override INTEGER",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_cost_budget_usd_override FLOAT",
        "ALTER TABLE requests ADD COLUMN IF NOT EXISTS tool_calls INTEGER NOT NULL DEFAULT 1",
        # Teams support
        """CREATE TABLE IF NOT EXISTS teams (
            id VARCHAR PRIMARY KEY,
            name VARCHAR UNIQUE NOT NULL,
            password_hash VARCHAR NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )""",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id VARCHAR REFERENCES teams(id) ON DELETE SET NULL",
        "ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key_hash VARCHAR(64)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_agents_api_key_hash ON agents (api_key_hash) WHERE api_key_hash IS NOT NULL",
        # Team owner + roster + invites
        "ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL",
        """CREATE TABLE IF NOT EXISTS team_members (
            id VARCHAR PRIMARY KEY,
            team_id VARCHAR NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR NOT NULL DEFAULT 'member',
            status VARCHAR NOT NULL DEFAULT 'active',
            joined_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_team_members_user_team UNIQUE (user_id, team_id)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_team_members_team_id ON team_members (team_id)",
        "CREATE INDEX IF NOT EXISTS ix_team_members_user_id ON team_members (user_id)",
        """CREATE TABLE IF NOT EXISTS team_invites (
            id VARCHAR PRIMARY KEY,
            team_id VARCHAR NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMP NOT NULL,
            consumed_at TIMESTAMP,
            consumed_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL
        )""",
        "CREATE INDEX IF NOT EXISTS ix_team_invites_team_id ON team_invites (team_id)",
        # Request attribution
        "ALTER TABLE requests ADD COLUMN IF NOT EXISTS user_id VARCHAR",
        "ALTER TABLE requests ADD COLUMN IF NOT EXISTS team_id VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_requests_user_id ON requests (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_requests_team_id ON requests (team_id)",
        "ALTER TABLE requests ADD COLUMN IF NOT EXISTS environment VARCHAR NOT NULL DEFAULT 'production'",
        "ALTER TABLE requests ADD COLUMN IF NOT EXISTS endpoint_route VARCHAR NOT NULL DEFAULT ''",
        "ALTER TABLE requests ADD COLUMN IF NOT EXISTS error_detail VARCHAR NOT NULL DEFAULT ''",
        "CREATE INDEX IF NOT EXISTS ix_requests_environment ON requests (environment)",
        # Agent deployment tag
        "ALTER TABLE agents ADD COLUMN IF NOT EXISTS deployment_environment VARCHAR NOT NULL DEFAULT 'production'",
        "CREATE INDEX IF NOT EXISTS ix_agents_deployment_environment ON agents (deployment_environment)",
    ]
    backfill = [
        # Pick earliest member per team as owner when missing
        """UPDATE teams t
           SET owner_user_id = sub.uid
           FROM (
             SELECT DISTINCT ON (team_id) team_id AS tid, id AS uid
             FROM users
             WHERE team_id IS NOT NULL
             ORDER BY team_id, created_at ASC
           ) sub
           WHERE t.id = sub.tid AND t.owner_user_id IS NULL""",
        # Backfill membership rows from legacy user.team_id
        """INSERT INTO team_members (id, team_id, user_id, role, status, joined_at)
           SELECT gen_random_uuid()::text,
                  u.team_id,
                  u.id,
                  CASE WHEN u.id = t.owner_user_id THEN 'owner' ELSE 'member' END,
                  'active',
                  COALESCE(u.created_at, NOW())
           FROM users u
           JOIN teams t ON t.id = u.team_id
           WHERE u.team_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM team_members tm
               WHERE tm.user_id = u.id AND tm.team_id = u.team_id
             )""",
        # Promote owner role if user is owner_user_id but row says member
        """UPDATE team_members tm
           SET role = 'owner'
           FROM teams t
           WHERE tm.team_id = t.id AND tm.user_id = t.owner_user_id AND tm.role <> 'owner'""",
    ]
    with engine.begin() as conn:
        for sql in stmts:
            conn.execute(text(sql))
        for sql in backfill:
            conn.execute(text(sql))
