MODEL_PRICING: dict[str, dict[str, float]] = {
    # ── Prefixed keys (provider/model) — used by analytics & comparisons ──────
    # OpenAI
    "openai/gpt-4o":                   {"input": 5 / 1e6,     "output": 15 / 1e6},
    "openai/gpt-4o-mini":              {"input": 0.15 / 1e6,  "output": 0.6 / 1e6},
    "openai/gpt-3.5-turbo":            {"input": 0.5 / 1e6,   "output": 1.5 / 1e6},
    "openai/o1":                       {"input": 15 / 1e6,    "output": 60 / 1e6},
    "openai/o1-mini":                  {"input": 3 / 1e6,     "output": 12 / 1e6},
    "openai/o3-mini":                  {"input": 1.1 / 1e6,   "output": 4.4 / 1e6},
    # Anthropic — Claude 4.x
    "anthropic/claude-opus-4-6":       {"input": 15 / 1e6,    "output": 75 / 1e6},
    "anthropic/claude-sonnet-4-6":     {"input": 3 / 1e6,     "output": 15 / 1e6},
    "anthropic/claude-haiku-4-5":      {"input": 0.8 / 1e6,   "output": 4 / 1e6},
    # Anthropic — Claude 3.x
    "anthropic/claude-3-5-sonnet":     {"input": 3 / 1e6,     "output": 15 / 1e6},
    "anthropic/claude-sonnet-4-5":     {"input": 3 / 1e6,     "output": 15 / 1e6},
    "anthropic/claude-3-sonnet":       {"input": 3 / 1e6,     "output": 15 / 1e6},
    "anthropic/claude-3-haiku":        {"input": 0.25 / 1e6,  "output": 1.25 / 1e6},
    "anthropic/claude-3-5-haiku":      {"input": 0.8 / 1e6,   "output": 4 / 1e6},
    "anthropic/claude-3-opus":         {"input": 15 / 1e6,    "output": 75 / 1e6},
    # Google
    "perplexity/pplx-70b":             {"input": 1 / 1e6,     "output": 1 / 1e6},
    "google/gemini-pro":               {"input": 0.5 / 1e6,   "output": 1.5 / 1e6},
    "google/gemini-1.5-pro":           {"input": 1.25 / 1e6,  "output": 5 / 1e6},
    "google/gemini-1.5-flash":         {"input": 0.075 / 1e6, "output": 0.3 / 1e6},
    # ── Plain-name keys — match raw model strings from SDKs ──────────────────
    # OpenAI
    "gpt-4o":                          {"input": 5 / 1e6,     "output": 15 / 1e6},
    "gpt-4o-mini":                     {"input": 0.15 / 1e6,  "output": 0.6 / 1e6},
    "gpt-3.5-turbo":                   {"input": 0.5 / 1e6,   "output": 1.5 / 1e6},
    "gpt-3.5-turbo-0125":              {"input": 0.5 / 1e6,   "output": 1.5 / 1e6},
    "o1":                              {"input": 15 / 1e6,    "output": 60 / 1e6},
    "o1-mini":                         {"input": 3 / 1e6,     "output": 12 / 1e6},
    "o3-mini":                         {"input": 1.1 / 1e6,   "output": 4.4 / 1e6},
    # Anthropic — Claude 4.x (current)
    "claude-opus-4-6":                 {"input": 15 / 1e6,    "output": 75 / 1e6},
    "claude-sonnet-4-6":               {"input": 3 / 1e6,     "output": 15 / 1e6},
    "claude-haiku-4-5":                {"input": 0.8 / 1e6,   "output": 4 / 1e6},
    "claude-haiku-4-5-20251001":       {"input": 0.8 / 1e6,   "output": 4 / 1e6},
    # Anthropic — Claude 3.x
    "claude-3-5-sonnet":               {"input": 3 / 1e6,     "output": 15 / 1e6},
    "claude-3-5-sonnet-20240620":      {"input": 3 / 1e6,     "output": 15 / 1e6},
    "claude-3-5-sonnet-20241022":      {"input": 3 / 1e6,     "output": 15 / 1e6},
    "claude-sonnet-4-5":               {"input": 3 / 1e6,     "output": 15 / 1e6},
    "claude-3-sonnet":                 {"input": 3 / 1e6,     "output": 15 / 1e6},
    "claude-3-haiku":                  {"input": 0.25 / 1e6,  "output": 1.25 / 1e6},
    "claude-3-haiku-20240307":         {"input": 0.25 / 1e6,  "output": 1.25 / 1e6},
    "claude-3-5-haiku":                {"input": 0.8 / 1e6,   "output": 4 / 1e6},
    "claude-3-5-haiku-20241022":       {"input": 0.8 / 1e6,   "output": 4 / 1e6},
    "claude-3-opus":                   {"input": 15 / 1e6,    "output": 75 / 1e6},
    "claude-3-opus-20240229":          {"input": 15 / 1e6,    "output": 75 / 1e6},
}

# High-cost models that should trigger model-overkill recommendations
HIGH_COST_MODELS = {
    "claude-opus-4-6", "anthropic/claude-opus-4-6",
    "claude-3-opus", "claude-3-opus-20240229", "anthropic/claude-3-opus",
    "gpt-4o", "openai/gpt-4o",
    "o1", "openai/o1",
}

# Cheap alternatives for model-swap recommendations
CHEAP_ALTERNATIVES: dict[str, str] = {
    "claude-opus-4-6":               "claude-sonnet-4-6",
    "anthropic/claude-opus-4-6":     "anthropic/claude-sonnet-4-6",
    "claude-sonnet-4-6":             "claude-haiku-4-5",
    "anthropic/claude-sonnet-4-6":   "anthropic/claude-haiku-4-5",
    "openai/gpt-4o":                 "openai/gpt-4o-mini",
    "gpt-4o":                        "gpt-4o-mini",
    "anthropic/claude-3-sonnet":     "anthropic/claude-3-haiku",
    "anthropic/claude-3-5-sonnet":   "anthropic/claude-3-5-haiku",
    "claude-3-5-sonnet":             "claude-3-5-haiku",
    "claude-3-sonnet":               "claude-3-haiku",
    "o1":                            "o3-mini",
    "openai/o1":                     "openai/o3-mini",
}


def calculate_cost(prompt_tokens: int, completion_tokens: int, model_key: str) -> float:
    pricing = MODEL_PRICING.get(model_key)
    if pricing is None:
        # Try prefix match for versioned model names (e.g. "gpt-4o-2024-11-20")
        for key, p in MODEL_PRICING.items():
            if model_key.startswith(key):
                pricing = p
                break
    if pricing is None:
        return 0.0
    return (prompt_tokens * pricing["input"]) + (completion_tokens * pricing["output"])
