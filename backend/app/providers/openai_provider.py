import random
from typing import Any

from app.providers.base import BaseProvider


class OpenAIProvider(BaseProvider):
    async def call_model(self, request: dict[str, Any]) -> dict[str, Any]:
        model = request.get("model", "openai/gpt-4o")
        messages = request.get("messages", [])

        prompt_text = " ".join(m.get("content", "") for m in messages)
        base_prompt_tokens = max(len(prompt_text.split()) * 4, random.randint(200, 800))
        base_completion_tokens = random.randint(100, 1200)

        if "gpt-4o-mini" in model:
            prompt_tokens = int(base_prompt_tokens * random.uniform(0.8, 1.2))
            completion_tokens = int(base_completion_tokens * random.uniform(0.6, 1.0))
            latency_ms = random.randint(500, 2000)
        else:
            prompt_tokens = int(base_prompt_tokens * random.uniform(1.0, 1.5))
            completion_tokens = int(base_completion_tokens * random.uniform(1.0, 1.8))
            latency_ms = random.randint(1000, 4000)

        total_tokens = prompt_tokens + completion_tokens

        return {
            "provider": "openai",
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "latency_ms": latency_ms,
            "status": "success",
        }
