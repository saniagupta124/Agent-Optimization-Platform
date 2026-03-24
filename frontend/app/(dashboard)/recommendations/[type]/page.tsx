"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { getUsageSummary, TopChangeItem } from "../../../lib/api";

/* ---- Static content per recommendation type ---- */
interface RecTypeContent {
  title: string;
  tagline: string;
  why: string;
  how: { step: string; detail: string }[];
  impact: string;
  code?: string;
}

const REC_CONTENT: Record<string, RecTypeContent> = {
  model_switch: {
    title: "Switch to a More Cost-Efficient Model",
    tagline: "Use a cheaper model for tasks that don't require maximum capability.",
    why: "Frontier models like GPT-4o are powerful but expensive — they charge 10-30× more per token than smaller models like GPT-4o-mini or Claude Haiku. For many tasks (classification, extraction, short Q&A, summarization), a smaller model delivers equivalent quality at a fraction of the cost.",
    how: [
      {
        step: "Identify task complexity",
        detail: "Audit what your agent is actually doing in each request. Simple lookups, rule-based decisions, or short-form outputs rarely need a frontier model.",
      },
      {
        step: "Set up model routing",
        detail: "Route simple tasks to a fast/cheap model and only escalate to a frontier model when the task explicitly requires it (e.g., multi-step reasoning, code generation).",
      },
      {
        step: "Benchmark quality",
        detail: "Run 50-100 representative requests through both models and compare outputs. If accuracy stays within 5%, ship the cheaper model.",
      },
      {
        step: "Update your agent config",
        detail: "Change the model field in your agent configuration. For OpenAI: model: \"gpt-4o-mini\". For Anthropic: model: \"claude-haiku-4-5-20251001\".",
      },
    ],
    impact:
      "Switching from GPT-4o to GPT-4o-mini reduces input token cost by ~83% and output token cost by ~83%. On a high-volume agent processing thousands of requests per day, this compounds to significant monthly savings.",
    code: `// Before
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: prompt }],
});

// After — same result, ~10x cheaper for simple tasks
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: prompt }],
});`,
  },

  prompt_efficiency: {
    title: "Reduce Prompt Token Usage",
    tagline: "Cut unnecessary tokens from system prompts and context to lower cost per request.",
    why: "Input tokens are charged on every request. Bloated system prompts — repeated instructions, verbose formatting rules, large static context windows — silently inflate costs. An agent that sends 2,000 input tokens per request costs twice as much as one that sends 1,000, even if outputs are identical.",
    how: [
      {
        step: "Audit your system prompt",
        detail: "Log a sample of 20 requests and inspect the raw token count of each section. You'll often find repeated boilerplate, redundant examples, or formatting instructions that can be compressed.",
      },
      {
        step: "Use RAG instead of stuffing context",
        detail: "Instead of prepending large documents or entire knowledge bases into every prompt, use Retrieval Augmented Generation (RAG) to fetch only the relevant chunks at query time.",
      },
      {
        step: "Compress few-shot examples",
        detail: "If you're sending 5-10 examples per request, consider summarizing or reducing them to 2-3. For classification tasks, a well-worded instruction often outperforms verbose examples.",
      },
      {
        step: "Cache stable context",
        detail: "For providers that support prompt caching (Anthropic, OpenAI), mark your static system prompt as cacheable. Cached tokens are billed at a significant discount.",
      },
    ],
    impact:
      "Reducing average prompt tokens by 30% directly translates to a 30% reduction in input token costs. For agents with large system prompts or context windows, this is often the single highest-leverage optimization.",
    code: `// Before — verbose system prompt
const systemPrompt = \`
  You are a helpful assistant. You must always be polite.
  You must always respond in JSON. Here is the JSON schema:
  { "answer": string, "confidence": number, "sources": array }
  Here are some examples:
  Example 1: ...
  Example 2: ...
  Example 3: ...
\`;

// After — concise, same behavior
const systemPrompt = \`Respond in JSON: { answer, confidence, sources }. Be concise.\`;`,
  },

  token_limits: {
    title: "Add Maximum Token Limits",
    tagline: "Cap response length to prevent runaway costs from unexpectedly long outputs.",
    why: "Without a max_tokens limit, a single malformed request or adversarial prompt can cause your agent to generate thousands of tokens in one response — costing 10-100× more than a typical request. The top 5% of requests by token count often account for 30-50% of total cost.",
    how: [
      {
        step: "Set max_tokens on every request",
        detail: "Always pass a max_tokens parameter. Choose a value that covers 99% of legitimate use cases — typically 200-1,000 for most conversational agents, 2,000-4,000 for document generation tasks.",
      },
      {
        step: "Monitor for truncation",
        detail: "Log when finish_reason is 'length' (meaning the model hit the limit). If truncation rate exceeds 1-2%, increase your limit slightly.",
      },
      {
        step: "Add per-agent token budgets",
        detail: "In Slash, configure a per-agent token budget. Requests that exceed the budget are flagged as outliers, making runaway costs immediately visible.",
      },
      {
        step: "Validate inputs server-side",
        detail: "Trim or reject incoming prompts that exceed a maximum input length before sending them to the model. This prevents prompt injection attacks from triggering expensive completions.",
      },
    ],
    impact:
      "Capping max_tokens eliminates the long tail of extremely expensive requests. In practice, this reduces cost variance by 60-80% and brings average cost per request down by 15-35% depending on how often outlier requests occur.",
    code: `// Before — no limit
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: messages,
});

// After — bounded output
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: messages,
  max_tokens: 512,   // adjust based on your p99 output length
});

// Check if truncated
if (response.choices[0].finish_reason === "length") {
  console.warn("Response truncated — consider increasing max_tokens");
}`,
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
  if (label === "Low") return "bg-zinc-800/90 text-zinc-400 ring-1 ring-zinc-700";
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
      <div className="mt-6 rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-7">
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
          <div className="mt-5 flex flex-wrap items-center gap-6 border-t border-zinc-800/80 pt-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">Agent</p>
              <p className="mt-0.5 text-sm font-medium text-zinc-200">{rec.agent_name}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">Est. monthly savings</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-orange-400">
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
          <div className="mt-5 rounded-xl border border-zinc-800/80 bg-[#121212] p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">Finding</p>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{rec.description}</p>
          </div>
        )}
      </div>

      {/* Why this matters */}
      <div className="mt-6 rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-7">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Why this matters
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">{content.why}</p>
      </div>

      {/* How to implement */}
      <div className="mt-6 rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-7">
        <h2 className="mb-5 text-sm font-semibold uppercase tracking-widest text-zinc-500">
          How to implement
        </h2>
        <ol className="space-y-5">
          {content.how.map((step, i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-sm font-bold text-orange-400">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-zinc-200">{step.step}</p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-500">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Code example */}
      {content.code && (
        <div className="mt-6 rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-7">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500">
            Code example
          </h2>
          <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#0d0d0d] p-5 text-xs leading-relaxed text-zinc-300">
            <code>{content.code}</code>
          </pre>
        </div>
      )}

      {/* Expected impact */}
      <div className="mt-6 rounded-2xl border border-orange-900/30 bg-orange-950/10 p-7">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-orange-700">
          Expected impact
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">{content.impact}</p>
      </div>

      {/* CTA */}
      <div className="mt-6 flex items-center gap-4">
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-400 via-orange-500 to-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-950/25 transition hover:from-orange-300 hover:to-red-500"
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
