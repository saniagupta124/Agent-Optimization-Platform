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
    # Use pg8000 (pure Python) so it works on Vercel without binary deps.
    # Convert postgresql:// or postgres:// → postgresql+pg8000://
    _url = settings.DATABASE_URL.replace("postgresql://", "postgresql+pg8000://").replace("postgres://", "postgresql+pg8000://")
    # pg8000 doesn't support ?sslmode= query param — pass ssl via connect_args
    import ssl as _ssl
    _ctx = _ssl.create_default_context()
    _ctx.check_hostname = False
    _ctx.verify_mode = _ssl.CERT_NONE
    from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
    _parsed = urlparse(_url)
    _qs = parse_qs(_parsed.query)
    _qs.pop("sslmode", None)
    _clean_url = _parsed._replace(query=urlencode({k: v[0] for k, v in _qs.items()})).geturl()
    engine = create_engine(
        _clean_url,
        connect_args={"ssl_context": _ctx},
        pool_pre_ping=True,
    )
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
