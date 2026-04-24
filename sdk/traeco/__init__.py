"""
Traeco SDK — AI agent cost intelligence.

Usage:
    from traeco import init, wrap
    init(api_key="tk_live_...")
    client = wrap(OpenAI())
"""

from traeco._core import init, wrap, span, run_eval

__all__ = ["init", "wrap", "span", "run_eval"]
__version__ = "1.0.0"
