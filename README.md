# Token Cost Attribution Platform

LLM spend visibility platform for engineering teams. Intercept, normalize, and analyze AI token costs across providers, agents, and customers.

## Prerequisites

- Docker
- docker-compose

## Quick Start

```bash
# Clone and start all services
docker-compose up --build
```

Wait for all three services (postgres, backend, frontend) to start. The backend waits for postgres health checks before booting.

## Generate Mock Data

Once services are running, run the data generator (mounted at `/scripts` in the backend container):

```bash
docker-compose exec backend python /scripts/generate_data.py
```

This creates (or reuses) a **demo user**, ensures **five seed agents** with real UUIDs, clears prior mock requests for those agents, then inserts ~22,000 rows. Metrics in the app are scoped to your registered agents, so mock data must use those IDs — the script does that automatically.

Environment overrides (optional):

| Variable | Default | Meaning |
|----------|---------|---------|
| `SEED_USER_EMAIL` | `demo@tokencost.local` | Demo account email |
| `SEED_USER_PASSWORD` | `demo12345` | Demo account password |
| `SEED_USER_NAME` | `Demo User` | Display name |

Sign in with the demo email/password to see charts populated. Other accounts can register normally; their dashboards stay empty until they add agents and ingest traffic (or you run the seed with a custom `SEED_USER_EMAIL` after that user exists).

## Access

| Service  | URL                    |
|----------|------------------------|
| Frontend | http://localhost:3000   |
| Backend  | http://localhost:8000   |
| API Docs | http://localhost:8000/docs |

## API Endpoints

| Method | Endpoint               | Description                                    |
|--------|------------------------|------------------------------------------------|
| POST   | `/log_request`         | Ingest a new LLM request                      |
| GET    | `/metrics/overview`    | Total cost, tokens, requests, avg latency (7d) |
| GET    | `/metrics/by-agent`    | Cost/tokens/count grouped by agent_id          |
| GET    | `/metrics/by-customer` | Cost/tokens/count grouped by customer_id       |
| GET    | `/metrics/by-provider` | Cost/tokens/count grouped by provider          |
| GET    | `/metrics/outliers`    | Top 20 most expensive requests                 |
| GET    | `/metrics/timeseries`  | Daily cost + tokens for last 30 days           |
| GET    | `/subscription/usage`  | Monthly token/spend vs plan + by-provider/model |
| GET    | `/usage/summary`       | KPIs, behavioral comparison, insights, monthly caps |
| GET    | `/usage/breakdown`     | Cost share by model and by feature tag (endpoint) |
| GET    | `/usage/timeline`      | Daily cost/tokens/requests for trend strip       |
| GET    | `/agents?scope=team`   | List agents (optional `scope=me` default)         |
| GET    | `/health`              | Health check                                   |

Query `scope=me|team` is supported on `/usage/*`, `/subscription/usage`, and `/agents` when users share an **organization** name.

### Query Parameters

All `/metrics/*` endpoints (except outliers) accept a `days` query parameter to override the default window:

```
GET /metrics/overview?days=14
GET /metrics/timeseries?days=60
```

### POST /log_request Body

```json
{
  "agent_id": "support_agent",
  "customer_id": "cust_0001",
  "model": "openai/gpt-4o",
  "messages": [{"role": "user", "content": "Hello"}],
  "project_id": "proj_alpha",
  "feature_tag": "chat",
  "tool_calls": 2
}
```

Optional `tool_calls` (integer); if omitted, ingestion derives a value from the provider response or a small random range in simulation.

## Architecture

```
Frontend (Next.js) --> Backend (FastAPI) --> PostgreSQL
                           |
                     Provider Layer (simulated)
                     - OpenAI
                     - Anthropic
                     - Perplexity
                     - Google
```

- **Ingestion**: POST requests route through provider abstraction, compute cost via pricing engine, store in DB
- **Metrics**: SQL aggregations served via service layer
- **Providers**: Pluggable via `BaseProvider` abstract class, currently using realistic simulation
- **Cost Engine**: Per-model input/output token pricing in `core/pricing.py`
- **Plans**: `free` / `pro` / `team` monthly token and spend caps in `core/plans.py`; user field `plan_tier` on `users` (default `free`). Subscription usage for the current calendar month is exposed at `GET /subscription/usage` and folded into `GET /usage/summary` for the dashboard.
- **Usage API**: `usage_service` powers decision-focused aggregates (`/usage/*`); each `requests` row stores model, input/output tokens, `cost_usd`, `tool_calls`, `feature_tag` (endpoint), and `timestamp`.
- **Team view**: Users who share the same **organization name** (see Settings) are grouped; `?scope=team` on `/usage/*` and `/subscription/usage` aggregates all agents owned by anyone in that org. Solo users or empty org use **My workspace** only.
- **Savings hero**: Top optimization opportunities (same logic as per-agent `/agents/{id}/optimizations`) are ranked across agents and surfaced on the main dashboard.

## Stopping

```bash
docker-compose down          # stop services
docker-compose down -v       # stop and delete database volume
```
