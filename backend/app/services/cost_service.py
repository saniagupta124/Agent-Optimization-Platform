from app.core.pricing import calculate_cost


def compute_cost(prompt_tokens: int, completion_tokens: int, model_key: str) -> float:
    return calculate_cost(prompt_tokens, completion_tokens, model_key)
