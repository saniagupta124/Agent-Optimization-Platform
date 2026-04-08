"""
Mehek's Traeco Quickstart
─────────────────────────
This adds Traeco cost tracking to your existing Claude code.
Takes ~60 seconds to set up.

1. Install deps:
       pip install anthropic httpx

2. Set your Anthropic key:
       export ANTHROPIC_API_KEY=sk-ant-your-key-here

3. Run:
       python mehek_quickstart.py

Your Claude calls will show up at https://traeco.ai → Agents → mehek_agent
"""

import os
import sys
import time

# ── Your Anthropic key (from environment — never hardcoded) ──────────────────
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

if not ANTHROPIC_API_KEY:
    print("\n  ERROR: ANTHROPIC_API_KEY not set.")
    print("  Run:  export ANTHROPIC_API_KEY=sk-ant-...\n")
    sys.exit(1)

# ── Traeco SDK install ────────────────────────────────────────────────────────
try:
    from traeco import init, span, wrap
except ImportError:
    print("\n  Installing Traeco SDK...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "traeco-sdk", "-q"])
    from traeco import init, span, wrap

from anthropic import Anthropic

# ── 3 lines to add Traeco — this is the entire integration ───────────────────
init(
    api_key="tk_live_jzjMse_D11G3AsU6jY9sktJW3k8znAmn8Ia1aRO5db4",
    agent_name="mehek_agent",
    host="http://localhost:8000",
    debug=True,                      # prints "[traeco] shipped trace → 200" per call
)
client = wrap(Anthropic(api_key=ANTHROPIC_API_KEY))
# ─────────────────────────────────────────────────────────────────────────────
# Everything below is normal Claude code — nothing changed.
# Your ANTHROPIC_API_KEY never leaves your machine.
# Traeco only sees: model name, token counts, cost, latency. Not your prompts.


# ── Tag functions with @span to see cost breakdown by function ────────────────

@span("analysis")
def analyze(topic: str) -> str:
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=300,
        system="You are a concise analyst. Give a 2-3 sentence summary.",
        messages=[{"role": "user", "content": f"Analyze: {topic}"}],
    )
    return response.content[0].text


@span("quick_lookup")
def quick_lookup(question: str) -> str:
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150,
        messages=[{"role": "user", "content": question}],
    )
    return response.content[0].text


# ── Run 4 sample calls ────────────────────────────────────────────────────────

def main():
    print("\n" + "─" * 60)
    print("  Traeco Quickstart — mehek_agent")
    print("  Making 4 real Claude calls and shipping traces to Traeco...")
    print("─" * 60 + "\n")

    tasks = [
        (analyze,       "Prediction markets as a forecasting tool"),
        (quick_lookup,  "What is the Kelly criterion?"),
        (analyze,       "Why most retail traders lose money on options"),
        (quick_lookup,  "What makes a good Sharpe ratio?"),
    ]

    for fn, prompt in tasks:
        span_name = "analysis" if fn == analyze else "quick_lookup"
        print(f"  [{span_name}] {prompt}")
        result = fn(prompt)
        print(f"  → {result.strip()[:120]}")
        print()
        time.sleep(0.5)

    print("─" * 60)
    print("  Done! Go to your Traeco dashboard:")
    print("  https://traeco.ai  →  Agents  →  mehek_agent")
    print()
    print("  You'll see cost per call, cost by span, and model")
    print("  optimization recommendations within a few seconds.")
    print("─" * 60 + "\n")


if __name__ == "__main__":
    main()
