from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.agent_dashboard import router as agent_dashboard_router
from app.api.routes.agents import router as agents_router
from app.api.routes.auth import router as auth_router
from app.api.routes.budgets import router as budgets_router
from app.api.routes.github_oauth import router as integrations_router
from app.api.routes.ingest import router as ingest_router
from app.api.routes.ingestion import router as ingestion_router
from app.api.routes.metrics import router as metrics_router
from app.api.routes.onboarding import router as onboarding_router
from app.api.routes.sdk_keys import router as sdk_keys_router
from app.api.routes.subscription import router as subscription_router
from app.api.routes.team import router as team_router
from app.api.routes.traces import router as traces_router
from app.api.routes.usage import router as usage_router
from app.db.base import Base
from app.db.schema import ensure_schema
from app.db.session import engine

app = FastAPI(title="Token Cost Attribution Platform", version="2.0.0")


@app.on_event("startup")
def startup():
    try:
        Base.metadata.create_all(bind=engine)
        ensure_schema()
    except Exception as e:
        import logging
        logging.error(f"DB init error (non-fatal): {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(agent_dashboard_router)
app.include_router(integrations_router)
app.include_router(ingest_router)
app.include_router(ingestion_router)
app.include_router(onboarding_router)
app.include_router(metrics_router)
app.include_router(agents_router)
app.include_router(sdk_keys_router)
app.include_router(traces_router)
app.include_router(subscription_router)
app.include_router(team_router)
app.include_router(usage_router)
app.include_router(budgets_router)


@app.get("/health")
def health():
    return {"status": "ok"}
