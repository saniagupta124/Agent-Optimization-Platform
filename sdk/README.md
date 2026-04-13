# Traeco SDK

Stop paying for AI agent waste. Traeco traces every LLM call in your agent, attributes costs per function, and tells you exactly where to cut spend.

## Install

```bash
pip install traeco-sdk
```

## 3 lines to add tracing

```python
import traeco
from anthropic import Anthropic

traeco.init(api_key="tk_live_...", agent_name="my-agent")
client = traeco.wrap(Anthropic(api_key="..."))

# Your existing code — unchanged
response = client.messages.create(model="claude-sonnet-4-6", ...)
```

## Per-function cost breakdown

```python
from traeco import span

@span("market_analysis")
def analyze(data):
    return client.messages.create(...)

@span("trade_decision")
def decide(analysis):
    return client.messages.create(...)
```

Every `@span` shows up as its own row in the dashboard with token counts, cost, latency, and optimization recommendations.

## Works with OpenAI too

```python
from openai import OpenAI
client = traeco.wrap(OpenAI(api_key="..."))
```

## Dashboard

See costs at [traeco.ai](https://traeco.ai) — get your API key from Settings → API Keys.
