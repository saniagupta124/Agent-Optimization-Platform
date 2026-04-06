from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.agents import router as agents_router
from app.api.routes.auth import router as auth_router
from app.api.routes.integrations import router as integrations_router
from app.api.routes.ingestion import router as ingestion_router
from app.api.routes.metrics import router as metrics_router
from app.api.routes.subscription import router as subscription_router
from app.api.routes.team import router as team_router
from app.api.routes.usage import router as usage_router
from app.db.base import Base
from app.db.schema import ensure_schema
from app.db.session import engine

Base.metadata.create_all(bind=engine)
ensure_schema()

app = FastAPI(title="Token Cost Attribution Platform", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(integrations_router)
app.include_router(ingestion_router)
app.include_router(metrics_router)
app.include_router(agents_router)
app.include_router(subscription_router)
app.include_router(team_router)
app.include_router(usage_router)


@app.get("/health")
def health():
    return {"status": "ok"}
