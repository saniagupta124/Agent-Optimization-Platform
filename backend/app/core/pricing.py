MODEL_PRICING: dict[str, dict[str, float]] = {
    "openai/gpt-4o":             {"input": 5 / 1e6,    "output": 15 / 1e6},
    "openai/gpt-4o-mini":        {"input": 0.15 / 1e6, "output": 0.6 / 1e6},
    "anthropic/claude-3-sonnet": {"input": 3 / 1e6,    "output": 15 / 1e6},
    "anthropic/claude-3-haiku":  {"input": 0.25 / 1e6, "output": 1.25 / 1e6},
    "perplexity/pplx-70b":       {"input": 1 / 1e6,    "output": 1 / 1e6},
    "google/gemini-pro":         {"input": 0.5 / 1e6,  "output": 1.5 / 1e6},
}


def calculate_cost(prompt_tokens: int, completion_tokens: int, model_key: str) -> float:
    pricing = MODEL_PRICING.get(model_key)
    if pricing is None:
        return 0.0
    return (prompt_tokens * pricing["input"]) + (completion_tokens * pricing["output"])
