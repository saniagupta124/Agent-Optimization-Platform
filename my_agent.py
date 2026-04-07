import os; os.environ.setdefault("OPENAI_API_KEY", "demo")  # demo mode

from openai import OpenAI
from traeco import init, wrap

# 1. Initialize with your key
init(api_key="tk_live_WfX4sqZo1kib88Ml0XGFj0edJeoJVtjZmcfJ56UGgPU", agent_name="my_agent", host="http://localhost:8000")

# 2. Wrap your client
client = wrap(OpenAI())

# 3. Use client exactly as before
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
