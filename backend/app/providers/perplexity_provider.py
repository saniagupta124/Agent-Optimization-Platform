import random
from typing import Any

from app.providers.base import BaseProvider


class PerplexityProvider(BaseProvider):
    async def call_model(self, request: dict[str, Any]) -> dict[str, Any]:
        model = request.get("model", "perplexity/pplx-70b")
        messages = request.get("messages", [])

        prompt_text = " ".join(m.get("content", "") for m in messages)
        base_prompt_tokens = max(len(prompt_text.split()) * 4, random.randint(300, 1000))

        prompt_tokens = int(base_prompt_tokens * random.uniform(0.9, 1.3))
        completion_tokens = random.randint(200, 1600)
        total_tokens = prompt_tokens + completion_tokens
        latency_ms = random.randint(1200, 5000)

        return {
            "provider": "perplexity",
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "latency_ms": latency_ms,
            "status": "success",
        }
