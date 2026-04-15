# traeco-sdk

Stop paying for AI agent waste. Traeco traces every LLM call, attributes costs per function, and surfaces exactly where to cut spend.

## Install

```bash
pip install traeco-sdk
```

## Quickstart

```python
import traeco
from anthropic import Anthropic

traeco.init(
    api_key="tk_live_...",
    host="https://backend-kynarochlani-4185s-projects.vercel.app",
    agent_name="my-agent",
)

client = traeco.wrap(Anthropic())

# Your existing code — unchanged
response = client.messages.create(model="claude-sonnet-4-6", ...)
```

## Per-function cost breakdown

```python
@traeco.span("market_analysis")
def analyze(data):
    return client.messages.create(...)

@traeco.span("trade_decision")
def decide(analysis):
    return client.messages.create(...)
```

Each `@span` becomes its own row in the dashboard — cost, tokens, latency, and recommendations per function.

## Works with OpenAI too

```python
from openai import OpenAI
client = traeco.wrap(OpenAI())
```

## Environment variable

```python
import os
traeco.init(api_key=os.getenv("TRAECO_API_KEY"), ...)
```

## Full docs

See [DOCS.md](../DOCS.md) for the complete reference including Claude Code integration prompts.
