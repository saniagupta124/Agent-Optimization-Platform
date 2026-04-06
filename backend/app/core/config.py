from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://user:password@localhost:5432/tokendb"
    POSTGRES_USER: str = "user"
    POSTGRES_PASSWORD: str = "password"
    POSTGRES_DB: str = "tokendb"
    # Used to hash provider API keys at rest; defaults to JWT_SECRET if unset.
    API_KEY_PEPPER: str = ""
    JWT_SECRET: str = "change-me-in-production-use-a-real-secret"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    # If true, POST /log_request must include prompt_tokens + completion_tokens (no simulation).
    REQUIRE_REAL_USAGE: bool = False
    # Optional: e.g. https://your-app.vercel.app — used to build team invite links on the backend.
    PUBLIC_APP_URL: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
