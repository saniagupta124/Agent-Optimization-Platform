"""
agent.py — before Traeco, this was the whole file.
We added 3 lines. That's it.
"""
import sys, time, random
sys.path.insert(0, "sdk")

# ── Mock OpenAI so no API key needed for the demo ─────────────────────────
class _Msg:
    content = "AI agents will reshape how software is built — starting with cost visibility."
class _Choice:
    message = _Msg()
class _Usage:
    prompt_tokens = 847; completion_tokens = 312
class _Resp:
    model = "gpt-4o"; usage = _Usage(); choices = [_Choice()]
class _Completions:
    def create(self, **kw):
        time.sleep(random.uniform(0.4, 0.9))
        return _Resp()
class _Chat:
    completions = _Completions()
class OpenAI:
    chat = _Chat()
# ─────────────────────────────────────────────────────────────────────────


# ── 3 lines added ─────────────────────────────────────────────────────────
from traeco import init, wrap
init(api_key="tk_live_m_SZyJuffc3KWT0LYR5quh0mVo_QpxEc6Y7DECSayO4", host="http://localhost:8000")
client = wrap(OpenAI())
# ─────────────────────────────────────────────────────────────────────────


# ── Your existing agent code — completely unchanged ───────────────────────
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

print("Response:", response.choices[0].message.content)
print("Cost tracked by Traeco ✓")
