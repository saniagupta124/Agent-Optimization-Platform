from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.agents import router as agents_router
from app.api.routes.auth import router as auth_router
from app.api.routes.ingestion import router as ingestion_router
from app.api.routes.metrics import router as metrics_router
from app.db.base import Base
from app.db.session import engine

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Token Cost Attribution Platform", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(ingestion_router)
app.include_router(metrics_router)
app.include_router(agents_router)


@app.get("/health")
def health():
    return {"status": "ok"}
