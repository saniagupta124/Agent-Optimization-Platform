from abc import ABC, abstractmethod
from typing import Any


class BaseProvider(ABC):
    @abstractmethod
    async def call_model(self, request: dict[str, Any]) -> dict[str, Any]:
        """
        Call the model and return a normalized response:
        {
            "provider": str,
            "model": str,
            "prompt_tokens": int,
            "completion_tokens": int,
            "total_tokens": int,
            "latency_ms": int,
            "status": "success"
        }
        """
