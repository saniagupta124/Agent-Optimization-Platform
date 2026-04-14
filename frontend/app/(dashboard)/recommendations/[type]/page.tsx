"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { getUsageSummary, implementRecommendation, TopChangeItem } from "../../../lib/api";

/* ---- Static content per recommendation type ---- */
interface RecTypeContent {
  title: string;
  tagline: string;
  why: string;
  autoAction: string;
  how: { step: string; detail: string; code?: string }[];
  impact: string;
}

const REC_CONTENT: Record<string, RecTypeContent> = {
  model_switch: {
    title: "Switch to a More Cost-Efficient Model",
    tagline: "Your agent's task complexity and token volume don't justify a frontier model. A cheaper alternative handles this workload at a fraction of the cost.",
    autoAction: "Traeco will update the model in your agent file and open a pull request for review.",
    why: "Frontier models charge 10–30× more per token than smaller alternatives. Traeco detects this by matching your agent's purpose and average token count against a task-capability matrix — if a cheaper model is known to handle that workload well, and your observed spend confirms the gap, the recommendation fires with the exact dollar difference.",
    how: [
      {
        step: "Identify task complexity",
        detail: "Audit what your agent is actually doing in each request. Simple lookups, rule-based decisions, or short-form outputs rarely need a frontier model.",
      },
      {
        step: "Set up model routing",
        detail: "Route simple tasks to a fast/cheap model and only escalate to a frontier model when the task explicitly requires it (e.g., multi-step reasoning, code generation).",
        code: `def call_model(prompt: str, task_type: str) -> str:
    model = "gpt-4o" if task_type in ("reasoning", "code") else "gpt-4o-mini"
    return openai.chat.completions.create(model=model, messages=[{"role": "user", "content": prompt}])`,
      },
      {
        step: "Benchmark quality",
        detail: "Run 50-100 representative requests through both models and compare outputs. If accuracy stays within 5%, ship the cheaper model.",
        code: `# Quick benchmark — run the same prompts through both models
results = []
for prompt in sample_prompts:
    a = call_model(prompt, model="gpt-4o")
    b = call_model(prompt, model="gpt-4o-mini")
    results.append({"prompt": prompt, "gpt4o": a, "mini": b})`,
      },
      {
        step: "Update your agent config",
        detail: "Change the model field in your agent configuration.",
        code: `# OpenAI
response = openai.chat.completions.create(
    model="gpt-4o-mini",  # was: gpt-4o
    messages=[{"role": "user", "content": prompt}],
)

# Anthropic
response = anthropic.messages.create(
    model="claude-haiku-4-5-20251001",  # was: claude-3-5-sonnet-20241022
    messages=[{"role": "user", "content": prompt}],
    max_tokens=1024,
)`,
      },
    ],
    impact:
      "Switching from GPT-4o to GPT-4o-mini reduces input token cost by ~83% and output token cost by ~83%. On a high-volume agent processing thousands of requests per day, this compounds to significant monthly savings.",
  },

  prompt_efficiency: {
    title: "Reduce Prompt Token Usage",
    tagline: "Your completion-to-prompt ratio is below 0.3 — you're sending far more tokens in than you're getting out, which suggests the prompt can be trimmed.",
    autoAction: "Traeco will compress your system prompt and open a pull request with the optimized version.",
    why: "Input tokens are billed on every request. When your agent's completion/prompt ratio falls below 0.3, it signals that a large portion of input tokens aren't driving proportional output — common with verbose system prompts, repeated boilerplate, or oversized few-shot examples. Traeco estimates 15% savings as a conservative floor; actual savings depend on how much you trim.",
    how: [
      {
        step: "Audit your system prompt",
        detail: "Log a sample of 20 requests and inspect the raw token count of each section. You'll often find repeated boilerplate, redundant examples, or formatting instructions that can be compressed.",
        code: `import tiktoken
enc = tiktoken.encoding_for_model("gpt-4o")
tokens = enc.encode(system_prompt)
print(f"System prompt: {len(tokens)} tokens")
# Break down by section to find what's bloated`,
      },
      {
        step: "Use RAG instead of stuffing context",
        detail: "Instead of prepending large documents or entire knowledge bases into every prompt, use Retrieval Augmented Generation (RAG) to fetch only the relevant chunks at query time.",
        code: `# Before — entire doc in every prompt
messages = [{"role": "system", "content": FULL_KNOWLEDGE_BASE + instructions}]

# After — retrieve only relevant chunks
chunks = vector_store.search(user_query, top_k=3)
context = "\\n".join(chunks)
messages = [{"role": "system", "content": instructions},
            {"role": "user", "content": f"Context:\\n{context}\\n\\n{user_query}"}]`,
      },
      {
        step: "Compress few-shot examples",
        detail: "If you're sending 5-10 examples per request, consider summarizing or reducing them to 2-3. For classification tasks, a well-worded instruction often outperforms verbose examples.",
        code: `# Before — verbose examples
system = """
Classify sentiment. Examples:
"I love this product, it's amazing!" → positive
"This is terrible, worst purchase ever." → negative
"It's okay I guess, nothing special." → neutral
"Absolutely fantastic experience!" → positive
"Never buying this again." → negative
"""

# After — concise directive
system = "Classify sentiment as positive, negative, or neutral. One word only."`,
      },
      {
        step: "Cache stable context",
        detail: "For providers that support prompt caching (Anthropic, OpenAI), mark your static system prompt as cacheable. Cached tokens are billed at a significant discount.",
        code: `# Anthropic prompt caching
response = anthropic.messages.create(
    model="claude-3-5-sonnet-20241022",
    system=[{
        "type": "text",
        "text": STATIC_SYSTEM_PROMPT,
        "cache_control": {"type": "ephemeral"}  # ~90% off cached tokens
    }],
    messages=[{"role": "user", "content": user_message}],
    max_tokens=1024,
)`,
      },
    ],
    impact:
      "Reducing average prompt tokens by 30% directly translates to a 30% reduction in input token costs. For agents with large system prompts or context windows, this is often the single highest-leverage optimization.",
  },

  token_limits: {
    title: "Add Maximum Token Limits",
    tagline: "Your top 5% of requests cost 10× more than your median request — a small number of runaway responses are driving a disproportionate share of spend.",
    autoAction: "Traeco will add max_tokens to your API calls and open a pull request for review.",
    why: "Traeco flags this when the 95th-percentile request cost exceeds 10× the median, using at least 20 requests of real data. The savings estimate is 50% of the cost of those outlier requests — the assumption being that a token cap would have halved their cost. A max_tokens limit directly eliminates this tail.",
    how: [
      {
        step: "Set max_tokens on every request",
        detail: "Always pass a max_tokens parameter. Choose a value that covers 99% of legitimate use cases — typically 200-1,000 for most conversational agents, 2,000-4,000 for document generation tasks.",
        code: `# OpenAI
response = openai.chat.completions.create(
    model="gpt-4o-mini",
    messages=messages,
    max_tokens=512,  # adjust based on your p99 output length
)

# Anthropic
response = anthropic.messages.create(
    model="claude-3-5-sonnet-20241022",
    messages=messages,
    max_tokens=512,
)`,
      },
      {
        step: "Monitor for truncation",
        detail: "Log when finish_reason is 'length' (meaning the model hit the limit). If truncation rate exceeds 1-2%, increase your limit slightly.",
        code: `finish = response.choices[0].finish_reason  # OpenAI
# finish = response.stop_reason             # Anthropic

if finish == "length":
    print("Warning: response truncated — consider raising max_tokens")
    # Track truncation rate in your metrics`,
      },
      {
        step: "Add per-agent token budgets",
        detail: "In Traeco, configure a max_tokens value on your agent. Requests that exceed the budget are flagged as outliers, making runaway costs immediately visible.",
      },
      {
        step: "Validate inputs server-side",
        detail: "Trim or reject incoming prompts that exceed a maximum input length before sending them to the model.",
        code: `import tiktoken
MAX_INPUT_TOKENS = 2000
enc = tiktoken.encoding_for_model("gpt-4o-mini")

def validate_prompt(prompt: str) -> str:
    tokens = enc.encode(prompt)
    if len(tokens) > MAX_INPUT_TOKENS:
        tokens = tokens[:MAX_INPUT_TOKENS]
        prompt = enc.decode(tokens)
    return prompt`,
      },
    ],
    impact:
      "Capping max_tokens eliminates the long tail of extremely expensive requests. In practice, this reduces cost variance by 60-80% and brings average cost per request down by 15-35% depending on how often outlier requests occur.",
  },
  context_bloat: {
    title: "System Prompt Sent on Every Request",
    tagline: "Your system prompt exceeds 1,500 tokens. That fixed overhead is billed on every single request — trim it and the savings scale directly with volume.",
    autoAction: "Traeco will trim your system prompt to under 1,500 tokens and open a pull request with the optimized version.",
    why: "Detected at agent creation — no traces needed. Traeco estimates token count from system_prompt length (4 chars ≈ 1 token) and flags anything over 1,500. Once traces come in, savings are calculated from your actual spend: what fraction went to system prompt tokens, multiplied by the fraction that is excess above the threshold.",
    how: [
      {
        step: "Trim your system prompt",
        detail: "Remove boilerplate, compress verbose instructions into bullet points, and cut examples that can be inferred from a clear directive. Target under 1,500 tokens.",
        code: `import tiktoken
enc = tiktoken.encoding_for_model("gpt-4o")

system_prompt = """..."""  # your current prompt
tokens = enc.encode(system_prompt)
print(f"Current: {len(tokens)} tokens — target: under 1,500")

# Tips: remove examples, compress multi-sentence rules to bullets,
# delete repeated formatting instructions`,
      },
      {
        step: "Move reference data to RAG",
        detail: "Replace large static knowledge bases or policy docs in the prompt with retrieval — fetch only the relevant chunks at query time.",
        code: `# Before — entire KB in every prompt
system = POLICY_DOC + PRODUCT_FAQ + instructions  # ~4,000 tokens

# After — retrieve relevant chunks only (~300 tokens)
chunks = vector_store.search(user_query, top_k=3)
system = instructions  # keep only the instructions
user_message = f"Relevant context:\\n{'\\n'.join(chunks)}\\n\\n{user_query}"`,
      },
      {
        step: "Enable prompt caching",
        detail: "Anthropic and OpenAI both support caching for stable system prompts. Add cache_control for up to 90% off cached token cost.",
        code: `# Anthropic — cache the static part of your system prompt
response = anthropic.messages.create(
    model="claude-3-5-sonnet-20241022",
    system=[{
        "type": "text",
        "text": STATIC_SYSTEM_PROMPT,
        "cache_control": {"type": "ephemeral"}
    }],
    messages=[{"role": "user", "content": user_message}],
    max_tokens=1024,
)
# Cached input tokens billed at ~10% of normal rate`,
      },
    ],
    impact:
      "Cutting a 3,000-token prompt to 1,000 tokens saves 2,000 tokens per request — a 67% reduction in system prompt cost that compounds directly with request volume.",
  },

  token_scaling: {
    title: "No max_tokens Cap — Quadratic Cost Growth",
    tagline: "No max_tokens set on this agent. In multi-turn chains, context accumulates each tool call — cost scales quadratically with chain depth, not linearly.",
    autoAction: "Traeco will add max_tokens and context truncation to your agent and open a pull request for review.",
    why: "Day-0 config check — fires at agent creation before any traces. Traeco detects the absence of a max_tokens field in your agent config. Savings are estimated at 30% of actual spend once traces exist (zero until then). The underlying mechanic: a 5-step chain at 2k tokens/step costs 2k+4k+6k+8k+10k = 30k tokens — 3× what a linear model would suggest.",
    how: [
      {
        step: "Set max_tokens on every API call",
        detail: "Pass max_tokens on every request. 512–1,024 covers most tool responses; 2,000–4,000 for generation tasks. One line change, immediate effect.",
        code: `response = openai.chat.completions.create(
    model="gpt-4o-mini",
    messages=messages,
    max_tokens=1024,  # add this line
)`,
      },
      {
        step: "Truncate tool outputs before appending",
        detail: "Trim tool results to the essential information before adding to message history. Extract relevant sentences rather than passing raw API responses.",
        code: `MAX_TOOL_RESULT_CHARS = 800

def append_tool_result(messages: list, result: str) -> list:
    if len(result) > MAX_TOOL_RESULT_CHARS:
        result = result[:MAX_TOOL_RESULT_CHARS] + "... [truncated]"
    messages.append({"role": "tool", "content": result})
    return messages`,
      },
      {
        step: "Use a sliding window or summarize history",
        detail: "Keep only the last 3–5 turns, or periodically replace raw history with a summary. This bounds context length regardless of chain depth.",
        code: `MAX_HISTORY_TURNS = 5

def trim_history(messages: list) -> list:
    # Always keep system prompt (index 0)
    system = [m for m in messages if m["role"] == "system"]
    turns = [m for m in messages if m["role"] != "system"]
    # Keep only the last N turns
    return system + turns[-(MAX_HISTORY_TURNS * 2):]`,
      },
    ],
    impact:
      "Adding max_tokens and truncating tool outputs reduces per-chain cost by 50–70%. For an agent running 1,000 chains/month at 5 steps each, this directly eliminates the 2/3 of tokens that are accumulated context.",
  },

  retry_logic: {
    title: "Retry Loops Compounding Request Cost",
    tagline: "Error rate or burst patterns suggest retries are compounding token cost — each failed attempt re-sends the full prompt at full price.",
    autoAction: "Traeco will add exponential backoff with a 3-retry cap to your agent and open a pull request for review.",
    why: "Detected via two signals: (1) error rate ≥5% across at least 10 requests, or (2) 3+ calls to the same feature_tag within a 10-second window — a strong indicator of a retry burst. Both fire on real trace data, not config. Accuracy depends on your SDK sending status='error' on failed calls; if errors aren't instrumented, the signal may undercount.",
    how: [
      {
        step: "Cap retries with exponential backoff",
        detail: "Set a maximum of 3 retries with delays of 1s, 2s, 4s between attempts. This handles transient failures without runaway cost on persistent errors.",
        code: `import time

def call_with_retry(prompt: str, max_retries: int = 3) -> str:
    for attempt in range(max_retries + 1):
        try:
            return openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1024,
            )
        except openai.RateLimitError:
            if attempt == max_retries:
                raise
            time.sleep(2 ** attempt)  # 1s, 2s, 4s backoff`,
      },
      {
        step: "Distinguish error types",
        detail: "Only retry on transient errors (rate limits, timeouts, 5xx). Do not retry on logic errors (4xx, invalid prompt, context overflow) — those will always fail.",
        code: `RETRYABLE_ERRORS = (openai.RateLimitError, openai.APITimeoutError, openai.InternalServerError)
NON_RETRYABLE = (openai.BadRequestError, openai.AuthenticationError)

try:
    response = call_llm(prompt)
except NON_RETRYABLE as e:
    # Log and fail fast — retrying won't help
    logger.error(f"Non-retryable error: {e}")
    raise
except RETRYABLE_ERRORS as e:
    # Safe to retry with backoff
    response = call_with_retry(prompt)`,
      },
      {
        step: "Cache successful responses",
        detail: "For deterministic inputs, cache responses for a short TTL. Identical queries from retries or repeated users return instantly at zero token cost.",
        code: `import hashlib, json
from functools import lru_cache

def cache_key(prompt: str, model: str) -> str:
    return hashlib.sha256(f"{model}:{prompt}".encode()).hexdigest()

# Simple in-memory cache (use Redis for production)
_cache: dict = {}

def cached_call(prompt: str, model: str = "gpt-4o-mini") -> str:
    key = cache_key(prompt, model)
    if key in _cache:
        return _cache[key]
    result = call_llm(prompt, model)
    _cache[key] = result
    return result`,
      },
      {
        step: "Track error rate in Traeco",
        detail: "Send status: 'error' on failed calls so Traeco can surface your real error rate and wasted spend.",
        code: `from traeco import TraecoClient
traeco = TraecoClient(api_key="...", agent_name="my-agent")

try:
    response = call_llm(prompt)
    traeco.log(prompt_tokens=..., completion_tokens=..., status="success")
except Exception as e:
    traeco.log(prompt_tokens=..., completion_tokens=0, status="error")
    raise`,
      },
    ],
    impact:
      "Capping retries at 3 and adding backoff typically reduces wasted retry cost by 60–80%. On agents with persistent error patterns, this can eliminate a significant fraction of total monthly spend.",
  },
};

function severityLabel(s: string): "High" | "Med" | "Low" {
  const u = s.toLowerCase();
  if (u.includes("high") || u.includes("critical")) return "High";
  if (u.includes("low")) return "Low";
  return "Med";
}

function severityBadgeClass(label: "High" | "Med" | "Low"): string {
  if (label === "High") return "bg-rose-950/70 text-rose-100 ring-1 ring-rose-800/60";
  if (label === "Low") return "bg-[#242424]/90 text-zinc-400 ring-1 ring-[#333333]";
  return "bg-amber-950/55 text-amber-200/95 ring-1 ring-amber-900/50";
}

export default function RecommendationDetailPage() {
  const { type } = useParams<{ type: string }>();
  const searchParams = useSearchParams();
  const agentId = searchParams.get("agent_id");
  const days = parseInt(searchParams.get("days") ?? "30", 10);
  const scope = (searchParams.get("scope") ?? "me") as "me" | "team";

  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [rec, setRec] = useState<TopChangeItem | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  function copyCode(code: string, idx: number) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }

  useEffect(() => {
    if (!token) return;
    getUsageSummary(token, days, scope)
      .then((s) => {
        const match = s.top_changes.find(
          (c) => c.type === type && (!agentId || c.agent_id === agentId)
        );
        setRec(match ?? null);
      })
      .catch(() => setRec(null));
  }, [token, type, agentId, days, scope]);

  const content = REC_CONTENT[type ?? ""] ?? null;

  if (!content) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/recommendations" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Back to Recommendations
        </Link>
        <p className="mt-6 text-sm text-zinc-500">Unknown recommendation type.</p>
      </div>
    );
  }

  const sev = rec ? severityLabel(rec.severity) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <Link href="/recommendations" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Back to Recommendations
      </Link>

      {/* Hero */}
      <div className="mt-6 rounded-2xl border border-[#2a2a2a]/90 bg-[#161617] p-7">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="text-2xl font-bold text-white">{content.title}</h1>
          {sev && (
            <span className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${severityBadgeClass(sev)}`}>
              {sev}
            </span>
          )}
        </div>
        <p className="mt-2 text-base text-zinc-400">{content.tagline}</p>

        {rec && (
          <div className="mt-5 flex flex-wrap items-center gap-6 border-t border-[#2a2a2a]/80 pt-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">Agent</p>
              <p className="mt-0.5 text-sm font-medium text-zinc-200">{rec.agent_name}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">Est. monthly savings</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-emerald-400">
                ${rec.estimated_savings_usd.toFixed(2)}/mo
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">Period</p>
              <p className="mt-0.5 text-sm text-zinc-300">Last {days} days</p>
            </div>
          </div>
        )}

        {rec && (
          <div className="mt-5 rounded-xl border border-[#2a2a2a]/80 bg-[#0d0d0e] p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">Finding</p>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{rec.description}</p>
          </div>
        )}
      </div>

      {/* Why this matters */}
      <div className="mt-6 rounded-2xl border border-[#2a2a2a]/90 bg-[#161617] p-7">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Why this matters
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">{content.why}</p>
      </div>

      {/* How to implement */}
      <div className="mt-6 rounded-2xl border border-[#2a2a2a]/90 bg-[#161617] p-7">
        <h2 className="mb-5 text-sm font-semibold uppercase tracking-widest text-zinc-500">
          How to implement
        </h2>

        {/* Automatic */}
        <div className="mb-6 rounded-xl border border-emerald-900/40 bg-emerald-950/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-emerald-400">Automatic</p>
              <p className="mt-1 text-sm text-zinc-400">{content.autoAction}</p>
              {!agentId && (
                <p className="mt-2 text-xs text-zinc-600">Open this from an agent page to enable automatic implementation.</p>
              )}
            </div>
            {agentId && (
              <button
                onClick={async () => {
                  if (!token || !agentId) return;
                  try {
                    const r = await implementRecommendation(token, agentId, type ?? "");
                    if (r.pr_url) window.open(r.pr_url, "_blank");
                  } catch {
                    alert("Could not open PR — make sure a GitHub repo is linked to this agent.");
                  }
                }}
                className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
              >
                Implement →
              </button>
            )}
          </div>
        </div>

        {/* Manual */}
        <p className="mb-4 text-sm font-semibold text-zinc-500">Manual</p>
        <ol className="space-y-5">
          {content.how.map((step, i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#242424] text-sm font-bold text-zinc-400">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-zinc-200">{step.step}</p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-500">{step.detail}</p>
                {step.code && (
                  <div className="mt-3 rounded-xl border border-[#2a2a2a] bg-[#0d0d0e] overflow-hidden">
                    <div className="flex items-center justify-between border-b border-[#2a2a2a] px-4 py-2">
                      <span className="text-xs text-zinc-600">template</span>
                      <button
                        onClick={() => copyCode(step.code!, i)}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-zinc-400 transition hover:bg-[#1e1e1e] hover:text-zinc-200"
                      >
                        {copiedIdx === i ? (
                          <>
                            <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                            </svg>
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-zinc-300">
                      <code>{step.code}</code>
                    </pre>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Expected impact */}
      <div className="mt-6 rounded-2xl border border-emerald-900/30 bg-emerald-950/10 p-7">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-emerald-700">
          Expected impact
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">{content.impact}</p>
      </div>

      {/* CTA */}
      <div className="mt-6 flex items-center gap-4">
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-800 px-5 py-2.5 text-sm font-semibold text-white shadow-lg  transition hover:from-emerald-500 hover:to-emerald-700"
        >
          View agents →
        </Link>
        <Link href="/recommendations" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← All recommendations
        </Link>
      </div>
    </div>
  );
}
