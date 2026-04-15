# Traeco Documentation

Traeco tells you exactly how much each part of your AI agent costs — per function, per model, per run — and what to do about it.

---

## Table of Contents

1. [Quickstart](#quickstart)
2. [Installation](#installation)
3. [Initialize Traeco](#initialize-traeco)
4. [Wrap Your LLM Client](#wrap-your-llm-client)
5. [Tag Functions with Spans](#tag-functions-with-spans)
6. [Dashboard](#dashboard)
7. [Using Claude Code to Integrate](#using-claude-code-to-integrate)
8. [Reference](#reference)

---

## Quickstart

Get tracing in under 5 minutes.

**1. Install**
```bash
pip install traeco-sdk
```

**2. Add to your agent**
```python
import traeco
from anthropic import Anthropic

traeco.init(
    api_key="tk_live_...",
    host="https://backend-kynarochlani-4185s-projects.vercel.app",
    agent_name="my-agent",
)

client = traeco.wrap(Anthropic())
```

**3. Run your agent.** Traces appear in the dashboard within seconds.

---

## Installation

```bash
pip install traeco-sdk
```

Supports Python 3.9+. No other dependencies required beyond your existing LLM SDK.

---

## Initialize Traeco

Call `traeco.init()` once at the top of your entry file, before any LLM calls are made.

```python
import traeco

traeco.init(
    api_key="tk_live_...",                  # your SDK key from the dashboard
    host="https://backend-kynarochlani-4185s-projects.vercel.app",  # Traeco backend
    agent_name="my-agent",                 # name shown in the dashboard
    debug=False,                           # set True to print trace logs to terminal
)
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `api_key` | ✅ | Your SDK key. Get it from the dashboard under Settings → API Keys. |
| `host` | ✅ | The Traeco backend URL. |
| `agent_name` | ✅ | A name for this agent. Shows up as a row in the dashboard. |
| `debug` | ❌ | Prints trace status to terminal. Useful for confirming traces are shipping. |

---

## Wrap Your LLM Client

After `traeco.init()`, wrap your Anthropic or OpenAI client. This is what intercepts calls and ships traces.

**Anthropic**
```python
from anthropic import Anthropic
import traeco

client = traeco.wrap(Anthropic())

# Use exactly as before — nothing else changes
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
```

**OpenAI**
```python
from openai import OpenAI
import traeco

client = traeco.wrap(OpenAI())

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

> Traeco wraps the client at the network level. Your code does not need to change anywhere else.

---

## Tag Functions with Spans

By default, all LLM calls from an agent are grouped together. Spans let you break costs down by function — so you can see exactly which part of your agent is spending money.

```python
import traeco

@traeco.span("market_analysis")
def analyze_market(data):
    return client.messages.create(...)

@traeco.span("trade_decision")
def decide_trade(analysis):
    return client.messages.create(...)
```

In the dashboard, you'll see a **By Step** breakdown like:

| Step | Cost | Calls |
|------|------|-------|
| market_analysis | $12.50 | 7,200 |
| trade_decision | $2.10 | 800 |

**Rules for span names:**
- Use lowercase with underscores: `market_analysis`, not `Market Analysis`
- Name it after what the function *does*, not what it's called: `summarize_context` is better than `step_3`
- Each unique name becomes its own row in the dashboard

Spans are optional. Traeco works without them — you just won't get per-function breakdown.

---

## Dashboard

Once traces are shipping, the dashboard shows:

- **Monthly Cost Est.** — projected monthly spend based on recent usage
- **Session Cost (6h)** — cost in the last 6 hours
- **7d Requests** — total LLM calls in the past week
- **Avg Latency** — average response time per call
- **Daily Spend Chart** — 30-day cost history
- **By Step / By Model / By Tool** — cost broken down by span, model, or endpoint
- **Recommendations** — AI-generated suggestions for where to cut cost
- **Anomalies** — detected retry loops or unusual call patterns

The dashboard refreshes every 10 seconds while open.

---

## Using Claude Code to Integrate

If you're using Claude Code as your development environment, you can integrate Traeco in two prompts.

### Prompt 1 — Connect Traeco

Paste this into Claude Code in your agent repo:

```
Add Traeco cost tracking to this codebase. Install traeco-sdk if not already installed.

At the top of the main entry file, add:

import traeco
traeco.init(
    api_key="tk_live_...",
    host="https://backend-kynarochlani-4185s-projects.vercel.app",
    agent_name="<name of this agent>",
)

Then find every place where an Anthropic or OpenAI client is created and wrap it:
client = traeco.wrap(client)

Do not change any other logic.
```

> Replace `tk_live_...` with your actual SDK key and `<name of this agent>` with something descriptive.

Run your agent once after this. If you see a new row appear in the Traeco dashboard, you're connected.

---

### Prompt 2 — Add Span Tags

After Prompt 1 is working, paste this to get per-function cost breakdown:

```
Add Traeco span decorators to this codebase to track costs by function.

Import traeco at the top of each relevant file. Then add @traeco.span("function_name") above every function that makes an LLM call or calls one. Use a descriptive name that reflects what the function does (e.g. "market_analysis", "summarize_document", "generate_response").

Do not change any function logic — only add the decorator.
```

After this, the dashboard will show a **By Step** tab with a cost row per function.

---

## Reference

### `traeco.init()`

```python
traeco.init(api_key, host, agent_name, debug=False)
```

Initialize Traeco. Must be called before any LLM calls.

---

### `traeco.wrap(client)`

```python
client = traeco.wrap(Anthropic())
client = traeco.wrap(OpenAI())
```

Wraps an LLM client to intercept calls and ship traces. Returns the same client interface — no code changes needed elsewhere.

---

### `@traeco.span(name)`

```python
@traeco.span("my_function")
def my_function():
    ...
```

Tags all LLM calls made inside this function with the given name. Shows up as a separate row in the dashboard's By Step view.

---

### Environment variable support

You can load your API key from an environment variable:

```python
import os
import traeco

traeco.init(
    api_key=os.getenv("TRAECO_API_KEY"),
    host="https://backend-kynarochlani-4185s-projects.vercel.app",
    agent_name="my-agent",
)
```

Add to your `.env`:
```
TRAECO_API_KEY=tk_live_...
```
