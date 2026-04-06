"""
Demo: Traeco SDK in 3 lines.

Before running:
  pip install traeco-sdk openai

Then set your keys:
  export OPENAI_API_KEY=sk-...
  export TRAECO_API_KEY=tk_live_...
"""

import os
from openai import OpenAI

# ── 3 lines to add Traeco ───────────────────────────────────────────────────
from traeco import init, wrap
init(api_key=os.environ["TRAECO_API_KEY"], agent_name="demo_agent", debug=True)
client = wrap(OpenAI())
# ───────────────────────────────────────────────────────────────────────────

# Your existing code — completely unchanged
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is 2 + 2?"}],
    max_tokens=50,
)

print("Response:", response.choices[0].message.content)
print("Cost tracked by Traeco — check your dashboard at traeco.ai")
