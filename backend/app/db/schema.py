"""Lightweight additive schema updates for existing DBs (no Alembic in this repo)."""

from sqlalchemy import inspect, text

from app.db.session import engine


def _sqlite_add_column_if_missing(conn, table: str, column: str, col_def: str) -> None:
    """SQLite doesn't support ALTER TABLE ... ADD COLUMN IF NOT EXISTS."""
    cols = [row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))]
    if column not in cols:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"))


def ensure_schema() -> None:
    """Add columns introduced after initial deploys."""
    is_sqlite = engine.dialect.name == "sqlite"
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
        # Traeco SDK API keys
        """CREATE TABLE IF NOT EXISTS sdk_api_keys (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR NOT NULL DEFAULT 'Default',
            key_prefix VARCHAR(16) NOT NULL,
            key_hash VARCHAR(64) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT NOW(),
            last_used_at TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_sdk_api_keys_user_id ON sdk_api_keys (user_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_sdk_api_keys_key_hash ON sdk_api_keys (key_hash)",
        # Span-level recommendations (agent_dashboard router)
        """CREATE TABLE IF NOT EXISTS span_recommendations (
            id VARCHAR PRIMARY KEY,
            agent_id VARCHAR NOT NULL,
            span_name VARCHAR NOT NULL DEFAULT '',
            rec_type VARCHAR NOT NULL,
            explanation VARCHAR NOT NULL DEFAULT '',
            current_monthly_cost FLOAT NOT NULL DEFAULT 0,
            projected_monthly_cost FLOAT NOT NULL DEFAULT 0,
            savings_per_month FLOAT NOT NULL DEFAULT 0,
            confidence INTEGER NOT NULL DEFAULT 0,
            applied BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_span_rec UNIQUE (agent_id, span_name, rec_type)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_span_rec_agent_id ON span_recommendations (agent_id)",
        "ALTER TABLE span_recommendations ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'pending'",
        "ALTER TABLE span_recommendations ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP",
        # structure_valid: NULL = not measured, TRUE = valid, FALSE = invalid
        "ALTER TABLE requests ALTER COLUMN structure_valid DROP DEFAULT",
        # Persisted accept/reject/defer decisions for general recommendations (top_changes)
        """CREATE TABLE IF NOT EXISTS rec_decisions (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR NOT NULL,
            agent_id VARCHAR NOT NULL,
            rec_type VARCHAR NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            reject_reason VARCHAR NOT NULL DEFAULT '',
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_rec_decision UNIQUE (user_id, agent_id, rec_type)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_rec_decisions_user_id ON rec_decisions (user_id)",
        "ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt TEXT",
        "ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_tokens INTEGER",
        # Phase 2: structure conformance column on requests
        "ALTER TABLE requests ADD COLUMN IF NOT EXISTS structure_valid BOOLEAN DEFAULT TRUE",
        # Phase 2: quality budgets and evaluations tables
        """CREATE TABLE IF NOT EXISTS quality_budgets (
            agent_id VARCHAR PRIMARY KEY,
            max_judge_preference_drop FLOAT NOT NULL DEFAULT 2.0,
            max_faithfulness_drop FLOAT NOT NULL DEFAULT 2.0,
            max_structure_drop FLOAT NOT NULL DEFAULT 0.0,
            max_latency_increase_ms FLOAT NOT NULL DEFAULT 200.0,
            on_breach VARCHAR NOT NULL DEFAULT 'alert_only',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS quality_evaluations (
            id VARCHAR PRIMARY KEY,
            agent_id VARCHAR NOT NULL,
            baseline_model VARCHAR NOT NULL,
            candidate_model VARCHAR NOT NULL,
            preference_pct FLOAT,
            span_name VARCHAR NOT NULL DEFAULT '',
            rec_type VARCHAR NOT NULL DEFAULT '',
            evaluated_at TIMESTAMP DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_quality_evaluations_agent_id ON quality_evaluations (agent_id)",
        "ALTER TABLE quality_evaluations ADD COLUMN IF NOT EXISTS span_name VARCHAR NOT NULL DEFAULT ''",
        "ALTER TABLE quality_evaluations ADD COLUMN IF NOT EXISTS rec_type VARCHAR NOT NULL DEFAULT ''",
        """CREATE TABLE IF NOT EXISTS eval_clusters (
            id VARCHAR PRIMARY KEY,
            agent_id VARCHAR NOT NULL,
            cluster_label VARCHAR NOT NULL,
            cluster_size INTEGER NOT NULL DEFAULT 0,
            example_input TEXT NOT NULL DEFAULT '',
            auto_draft_criteria TEXT NOT NULL DEFAULT '',
            good_answer_criteria TEXT,
            skip_criteria BOOLEAN NOT NULL DEFAULT FALSE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_eval_clusters_agent_id ON eval_clusters (agent_id)",
        # GitHub OAuth columns
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS github_token TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS github_username VARCHAR",
        # Agent repo URL for PR creation
        "ALTER TABLE agents ADD COLUMN IF NOT EXISTS repo_url VARCHAR",
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
    # SQLite-incompatible ALTER TABLE patterns — handle column-by-column
    _sqlite_cols = [
        ("users", "plan_tier", "VARCHAR(32) NOT NULL DEFAULT 'free'"),
        ("users", "monthly_token_budget_override", "INTEGER"),
        ("users", "monthly_cost_budget_usd_override", "FLOAT"),
        ("requests", "tool_calls", "INTEGER NOT NULL DEFAULT 1"),
        ("users", "team_id", "VARCHAR"),
        ("agents", "api_key_hash", "VARCHAR(64)"),
        ("teams", "owner_user_id", "VARCHAR"),
        ("requests", "user_id", "VARCHAR"),
        ("requests", "team_id", "VARCHAR"),
        ("requests", "environment", "VARCHAR NOT NULL DEFAULT 'production'"),
        ("requests", "endpoint_route", "VARCHAR NOT NULL DEFAULT ''"),
        ("requests", "error_detail", "VARCHAR NOT NULL DEFAULT ''"),
        ("agents", "deployment_environment", "VARCHAR NOT NULL DEFAULT 'production'"),
        ("users", "onboarding_completed", "BOOLEAN NOT NULL DEFAULT 0"),
        ("agents", "system_prompt", "TEXT"),
        ("agents", "max_tokens", "INTEGER"),
        # Phase 2: structure conformance
        ("requests", "structure_valid", "BOOLEAN DEFAULT 1"),
        ("span_recommendations", "status", "VARCHAR(16) NOT NULL DEFAULT 'pending'"),
        ("span_recommendations", "accepted_at", "TIMESTAMP"),
        ("users", "github_token", "TEXT"),
        ("users", "github_username", "VARCHAR"),
        ("agents", "repo_url", "VARCHAR"),
    ]

    with engine.begin() as conn:
        for sql in stmts:
            # Skip Postgres-only ALTER TABLE ADD COLUMN IF NOT EXISTS — handled below for SQLite
            if is_sqlite and sql.strip().upper().startswith("ALTER TABLE") and "IF NOT EXISTS" in sql.upper():
                continue
            # Skip Postgres-only partial index syntax for SQLite
            if is_sqlite and "WHERE api_key_hash IS NOT NULL" in sql:
                conn.execute(text(sql.split("WHERE")[0].strip()))
                continue
            # Skip Postgres backfill SQL for SQLite (no DISTINCT ON, no gen_random_uuid)
            try:
                conn.execute(text(sql))
            except Exception:
                pass

        if is_sqlite:
            for table, col, col_def in _sqlite_cols:
                try:
                    _sqlite_add_column_if_missing(conn, table, col, col_def)
                except Exception:
                    pass
        else:
            for sql in backfill:
                try:
                    conn.execute(text(sql))
                except Exception:
                    pass
