"""
Traeco Demo Agent
-----------------
A mock research agent that shows exactly how Traeco integrates —
3 lines added, everything else unchanged.

Usage:
    python demo_agent.py

Paste your API key from the onboarding page below.
No OpenAI key needed — LLM responses are simulated.
"""

import sys
import time
import random

# ── Paste your Traeco API key from the onboarding page ────────────────────
TRAECO_API_KEY = "PASTE_YOUR_KEY_HERE"
# ─────────────────────────────────────────────────────────────────────────

if TRAECO_API_KEY == "PASTE_YOUR_KEY_HERE":
    print("\n  Open demo_agent.py and paste your tk_live_... key into TRAECO_API_KEY\n")
    sys.exit(1)

# ── Add the local SDK to path (no pip install needed for demo) ────────────
sys.path.insert(0, "sdk")

# ── 3 lines to add Traeco ─────────────────────────────────────────────────
from traeco import init, wrap, span
init(api_key=TRAECO_API_KEY, agent_name="research_agent", host="http://localhost:8000", debug=True)
# ─────────────────────────────────────────────────────────────────────────


# ── Mock OpenAI client (simulates real LLM calls) ─────────────────────────

class MockUsage:
    def __init__(self, prompt, completion):
        self.prompt_tokens = prompt
        self.completion_tokens = completion

class MockMessage:
    def __init__(self, content):
        self.content = content

class MockChoice:
    def __init__(self, content):
        self.message = MockMessage(content)

class MockResponse:
    def __init__(self, prompt, completion, model, content):
        self.usage = MockUsage(prompt, completion)
        self.model = model
        self.choices = [MockChoice(content)]

class MockCompletions:
    def create(self, model, messages, max_tokens=500, **kwargs):
        # Simulate latency
        time.sleep(random.uniform(0.3, 1.1))
        responses = {
            "gpt-4o": ("The latest AI research highlights transformer efficiency improvements and "
                       "multimodal reasoning breakthroughs in Q1 2026.", 800, 95),
            "gpt-4o-mini": ("Recent AI papers focus on efficient fine-tuning and cost reduction "
                            "techniques for production deployments.", 420, 38),
            "claude-3-5-sonnet-20241022": ("Key AI trends: reasoning models, agent frameworks, "
                                           "and enterprise cost optimization tools.", 610, 72),
        }
        content, prompt_t, completion_t = responses.get(
            model, ("Simulated response from " + model, 500, 60)
        )
        return MockResponse(prompt_t, completion_t, model, content)

class MockChat:
    def __init__(self):
        self.completions = MockCompletions()

class MockOpenAI:
    def __init__(self):
        self.chat = MockChat()

# ── Wrap the client — this is the only change to your existing code ────────
client = wrap(MockOpenAI())
# ─────────────────────────────────────────────────────────────────────────


# ── Your agent logic — completely unchanged ───────────────────────────────

QUERIES = [
    ("What are the latest AI research breakthroughs?", "gpt-4o"),
    ("Summarize recent papers on LLM cost reduction", "gpt-4o"),
    ("What is prompt caching and how does it save money?", "gpt-4o-mini"),
    ("Compare GPT-4o vs Claude for structured outputs", "gpt-4o"),
    ("Best practices for multi-agent orchestration", "gpt-4o-mini"),
]

@span("research_query")
def research(query: str, model: str) -> str:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a helpful AI research assistant."},
            {"role": "user", "content": query},
        ],
        max_tokens=500,
    )
    return response.choices[0].message.content


def run_agent():
    print("\n" + "─" * 56)
    print("  Traeco Demo Agent — research_agent")
    print("─" * 56)
    print(f"  Connected to: http://localhost:8000")
    print(f"  Key:          {TRAECO_API_KEY[:20]}...")
    print("─" * 56 + "\n")

    for i, (query, model) in enumerate(QUERIES, 1):
        print(f"[{i}/{len(QUERIES)}] {query}")
        print(f"        model: {model}")
        result = research(query, model)
        print(f"        → {result[:80]}...")
        print()

    print("─" * 56)
    print("  Done. Check your Traeco dashboard for insights.")
    print("─" * 56 + "\n")


if __name__ == "__main__":
    run_agent()
