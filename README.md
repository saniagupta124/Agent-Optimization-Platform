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

Once services are running, exec into the backend container and run the data generator:

```bash
docker-compose exec backend python /scripts/generate_data.py
```

This inserts 22,000+ rows with realistic distributions across agents, providers, customers, and time.

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
| GET    | `/health`              | Health check                                   |

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
  "feature_tag": "chat"
}
```

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

## Stopping

```bash
docker-compose down          # stop services
docker-compose down -v       # stop and delete database volume
```
