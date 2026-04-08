# Traeco — AI Agent Cost Intelligence Platform

**Stop paying for AI agent waste.** Traeco ingests your agent traces, reveals hidden cost patterns, and delivers prescriptive recommendations that save engineering teams $2K–$50K/month.

> Previously called Slash. Rebranded to Traeco, April 2026.

---

## Repo Structure

```
Agent-Optimization-Platform/
├── frontend/          # Next.js 14 dashboard app
├── backend/           # FastAPI + SQLAlchemy ingestion & metrics API
├── website/           # Marketing landing page (deploy to Vercel/Netlify)
├── scripts/           # Data generation & seeding scripts
├── docs/              # Architecture docs
├── docker-compose.yml           # Full local stack (postgres + backend + frontend)
└── docker-compose.cloud.yml     # Cloud stack (Supabase, no local postgres)
```

---

## Quick Start (Local)

**Prerequisites:** Docker + docker-compose

```bash
git clone git@github.com:saniagupta124/Agent-Optimization-Platform.git
cd Agent-Optimization-Platform

cp .env.example .env          # fill in your secrets (see below)
docker compose up --build
```

Services start at:

| Service  | URL |
|----------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |

---

## Environment Variables

Copy `.env.example` → `.env` and fill in:

```env
DATABASE_URL=postgresql://...        # Supabase URI (add ?sslmode=require)
JWT_SECRET=...
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
```

### Using Supabase (recommended)
1. Supabase → **Project Settings → Database** → copy the URI connection string
2. Ensure the URL ends with `?sslmode=require`
3. Set as `DATABASE_URL` in `.env`

For cloud-only (no local Postgres container):
```bash
docker compose -f docker-compose.cloud.yml up --build
```

---

## Seed Demo Data

After services are running:

```bash
# Creates demo user + ~22,000 mock request rows
docker compose exec backend python /scripts/generate_data.py

# Seeds LavaLab team (Kyna, Sania, Mehek, Margaret)
docker compose exec backend python /scripts/seed_team_members.py
```

Demo login: `demo@slash.dev` / `demo12345`  
LavaLab accounts: `*@lavalab.local` / `LavaLab2025!`

---

## API Reference

### Integrations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/integrations/openai/discover` | Verify OpenAI key; list Assistants + model IDs |
| POST | `/integrations/openai/register-assistant` | Save assistant as agent |
| POST | `/integrations/anthropic/discover` | Verify Anthropic key; list models |

### Ingestion
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/log_request` | Ingest a new LLM request (see schema below) |

### Metrics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/metrics/overview` | Total cost, tokens, requests, avg latency (7d) |
| GET | `/metrics/by-agent` | Cost/tokens/count grouped by agent |
| GET | `/metrics/by-customer` | Cost/tokens/count grouped by customer |
| GET | `/metrics/by-provider` | Cost/tokens/count grouped by provider |
| GET | `/metrics/outliers` | Top 20 most expensive requests |
| GET | `/metrics/timeseries` | Daily cost + tokens for last 30 days |
| GET | `/metrics/usage-by-key` | Per-agent spend/tokens |

### Usage & Subscriptions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/usage/summary` | KPIs, behavioral comparison, insights, monthly caps |
| GET | `/usage/breakdown` | Cost share by model and feature tag |
| GET | `/usage/timeline` | Daily cost/tokens/requests |
| GET | `/subscription/usage` | Monthly token/spend vs plan |
| POST | `/subscription/sync` | Set user plan tier and monthly caps |

### Agents
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agents?scope=team` | List agents (`scope=me` or `scope=team`) |
| PATCH | `/agents/{id}` | Update agent; rotate API key |
| GET | `/health` | Health check |

All `/metrics/*` endpoints accept `?days=N` to override the default 7-day window.

#### POST /log_request body
```json
{
  "api_key": "sk-...",
  "customer_id": "cust_0001",
  "model": "openai/gpt-4o",
  "messages": [],
  "prompt_tokens": 120,
  "completion_tokens": 45,
  "project_id": "proj_alpha",
  "feature_tag": "chat",
  "tool_calls": 2
}
```

---

## Architecture

```
Frontend (Next.js 14)
        │
        ▼
Backend (FastAPI + SQLAlchemy)
        │
   ┌────┴────┐
   │         │
Supabase   Provider Layer
(Postgres)  OpenAI · Anthropic · Gemini · Cohere
```

- **Ingestion** — POST requests route through provider abstraction, compute cost via pricing engine (`core/pricing.py`), store in DB
- **Metrics** — SQL aggregations served via service layer
- **Plans** — `free` / `pro` / `team` monthly caps (`core/plans.py`)
- **Team view** — users sharing the same organization name grouped; `?scope=team` aggregates across org

---

## Website

The `website/` folder contains the Traeco marketing landing page (static HTML, no build step). Deploy to Vercel or Netlify in one click.

---

## Collab Workflow

This is an active team repo. Before pushing:

```bash
git pull origin main          # always pull before starting work
git checkout -b feat/your-feature
# ... make changes ...
git push origin feat/your-feature
# open a PR on GitHub → get at least one review → merge
```

- `main` — production-ready code only. Do not push directly.
- `feat/*` — new features
- `fix/*` — bug fixes
- `chore/*` — tooling, deps, config

---

## Stopping

```bash
docker compose down       # stop services
docker compose down -v    # stop + delete database volume
```

---

## Running Mehek's Agent

Mehek's Kalshi trading agent runs a continuous scan → analyze → decide → risk-check loop using real Anthropic Claude tokens tracked by the Traeco SDK. It calls the live Kalshi prediction market API and falls back to simulated data if the key is not set.

**Prerequisites:** backend running, Anthropic API key, Python 3.10+

**1. Set environment variables**

```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
export KALSHI_API_KEY=your-kalshi-api-key     # from kalshi.com → API settings (optional — falls back to simulated data)
export TRAECO_API_KEY=tk_live_...             # copy from Traeco dashboard → Setup
export TRAECO_API_URL=http://localhost:8000
```

> **Security:** `ANTHROPIC_API_KEY` and `KALSHI_API_KEY` never leave your machine.
> Traeco only receives token counts, costs, model names, and span names.

**2. Start the backend** (if not already running)

```bash
docker compose up --build
# or, without Docker:
cd backend && uvicorn app.main:app --reload --port 8000
```

**3. Install Python dependencies**

```bash
pip install anthropic httpx rich
# Also install the Traeco SDK in development mode:
pip install -e sdk/
```

**4. Run Mehek's agent**

```bash
python mehek_agent/kalshi_agent.py
```

The agent will:
- Fetch live markets from Kalshi API (or use built-in simulated data if key is not set)
- Call `claude-3-haiku` for sentiment analysis and risk checks (cost-efficient)
- Call `claude-3-5-sonnet` for trade decisions (higher reasoning quality)
- Ship every LLM call's token counts + cost to your Traeco dashboard in the background
- Print per-loop profit estimates and cost breakdown to stdout

**5. Open the live CLI dashboard** (separate terminal)

```bash
python cli_dashboard.py
```

The CLI dashboard polls `GET /dashboard/mehek_agent` and `GET /recommendations/mehek_agent` every 5 seconds and displays:
- Session cost, all-time cost, requests per minute
- Cost breakdown by span (market_scanner, sentiment_analyzer, trade_decision, risk_checker)
- Cost breakdown by model
- Live recommendations with projected savings

**6. View in the web dashboard**

Open http://localhost:3000 → Agents → mehek_agent → the agent detail page shows:
- Real-time cost by span (updates every 10s)
- Span-level recommendations with an "Apply" button
- Retry loop warnings if the agent is firing redundant calls
