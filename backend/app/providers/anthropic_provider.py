import random
from typing import Any

from app.providers.base import BaseProvider


class AnthropicProvider(BaseProvider):
    async def call_model(self, request: dict[str, Any]) -> dict[str, Any]:
        model = request.get("model", "anthropic/claude-3-sonnet")
        messages = request.get("messages", [])

        prompt_text = " ".join(m.get("content", "") for m in messages)
        base_prompt_tokens = max(len(prompt_text.split()) * 4, random.randint(250, 900))
        base_completion_tokens = random.randint(150, 1400)

        if "haiku" in model:
            prompt_tokens = int(base_prompt_tokens * random.uniform(0.7, 1.1))
            completion_tokens = int(base_completion_tokens * random.uniform(0.5, 0.9))
            latency_ms = random.randint(400, 1500)
        else:
            prompt_tokens = int(base_prompt_tokens * random.uniform(1.0, 1.4))
            completion_tokens = int(base_completion_tokens * random.uniform(1.0, 1.6))
            latency_ms = random.randint(800, 3500)

        total_tokens = prompt_tokens + completion_tokens

        return {
            "provider": "anthropic",
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "latency_ms": latency_ms,
            "status": "success",
        }
