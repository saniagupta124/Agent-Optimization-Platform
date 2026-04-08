from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

_sqlite = settings.DATABASE_URL.startswith("sqlite")

if _sqlite:
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    # Normalize postgres:// → postgresql:// for SQLAlchemy
    _url = settings.DATABASE_URL.replace("postgres://", "postgresql://", 1)
    engine = create_engine(
        _url,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
