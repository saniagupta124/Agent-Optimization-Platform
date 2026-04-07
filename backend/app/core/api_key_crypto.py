import hashlib

from app.core.config import settings


def _pepper() -> str:
    return settings.API_KEY_PEPPER or settings.JWT_SECRET


def hash_provider_api_key(provider: str, raw_key: str) -> str:
    material = f"{_pepper()}|{provider}|{raw_key}"
    return hashlib.sha256(material.encode()).hexdigest()


def hint_from_key(raw_key: str) -> str:
    return f"...{raw_key[-4:]}" if len(raw_key) >= 4 else "****"


def hash_sdk_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()
