"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { createSdkKey, listSdkKeys, SdkKeyCreated } from "../../lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-md px-2.5 py-1 text-xs font-medium transition"
      style={{
        background: copied ? "rgba(27,168,111,0.18)" : "rgba(255,255,255,0.06)",
        color: copied ? "#2de080" : "#a1a1aa",
        border: copied ? "1px solid rgba(45,224,128,0.3)" : "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="relative mt-3 rounded-xl border" style={{ background: "#0a0a0b", borderColor: "rgba(255,255,255,0.08)" }}>
      {label && (
        <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <span className="text-xs" style={{ color: "#52525b", fontFamily: "monospace" }}>{label}</span>
          <CopyButton text={code} />
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-4 text-sm leading-relaxed" style={{ color: "#d4d4d8", fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace" }}>
        {code}
      </pre>
      {!label && (
        <div className="absolute right-3 top-3">
          <CopyButton text={code} />
        </div>
      )}
    </div>
  );
}

function SectionHeader({ n, title, subtitle }: { n: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-4 mb-5">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        style={{ background: "rgba(27,168,111,0.2)", color: "#1BA86F", border: "1px solid rgba(27,168,111,0.3)" }}
      >
        {n}
      </div>
      <div>
        <h2 className="font-semibold text-white">{title}</h2>
        <p className="mt-0.5 text-sm" style={{ color: "#71717a" }}>{subtitle}</p>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border p-6"
      style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.07)" }}
    >
      {children}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const { data: session, status } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken;

  const [keyObj, setKeyObj] = useState<SdkKeyCreated | null>(null);
  const [keyLoading, setKeyLoading] = useState(true);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");

  useEffect(() => {
    if (!token) return;
    listSdkKeys(token)
      .then(async (keys) => {
        if (keys.length === 0) {
          const created = await createSdkKey(token, "Default");
          setKeyObj(created);
        } else {
          setKeyObj({
            id: keys[0].id,
            name: keys[0].name,
            key_prefix: keys[0].key_prefix,
            created_at: keys[0].created_at,
            last_used_at: keys[0].last_used_at,
            raw_key: keys[0].key_prefix + "•••••••••••••••••••••••••••",
          });
        }
      })
      .catch(() => {})
      .finally(() => setKeyLoading(false));
  }, [token]);

  if (status === "loading" || keyLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <svg className="animate-spin h-5 w-5" style={{ color: "#1BA86F" }} fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  const apiKey = keyObj?.raw_key ?? "tk_live_...";

  const agentCode = provider === "anthropic"
    ? `from anthropic import Anthropic
from traeco import init, wrap

init(api_key="${apiKey}", agent_name="my_agent")
client = wrap(Anthropic())

response = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)`
    : `from openai import OpenAI
from traeco import init, wrap

init(api_key="${apiKey}", agent_name="my_agent")
client = wrap(OpenAI())

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)`;

  const spansCode = provider === "anthropic"
    ? `from traeco import span

@span("classify")
def classify_ticket(text: str) -> str:
    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=50,
        messages=[{"role": "user", "content": f"Classify: {text}"}]
    )
    return response.content[0].text

@span("summarize")
def summarize_context(docs: list) -> str:
    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=200,
        messages=[{"role": "user", "content": "\\n".join(docs)}]
    )
    return response.content[0].text`
    : `from traeco import span

@span("classify")
def classify_ticket(text: str) -> str:
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"Classify: {text}"}]
    )
    return response.choices[0].message.content

@span("summarize")
def summarize_context(docs: list) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "\\n".join(docs)}]
    )
    return response.choices[0].message.content`;

  const claudeCodeBasicPrompt = `Add Traeco SDK tracing to my agent file. Do the following exactly:

1. Run: pip install traeco-sdk
2. At the top of the agent file, add:
   from traeco import init, wrap
   init(api_key="${apiKey}", agent_name="my_agent")
3. Find where the ${provider === "anthropic" ? "Anthropic()" : "OpenAI()"} client is instantiated and wrap it:
   client = wrap(${provider === "anthropic" ? "Anthropic()" : "OpenAI()"})

Do not change any other logic. The client works identically after wrapping.`;

  const claudeCodeSpansPrompt = `Add Traeco @span decorators to my agent to enable per-feature cost tracking. Do the following:

1. Add this import at the top: from traeco import span
2. Find every function that makes an LLM call and add @span("function_name") above it.
   Use descriptive names like "classify", "summarize", "search", "generate", "route", etc.
   Match the name to what the function actually does.
3. Do not change any function logic, only add the decorators.

Example:
  @span("classify")
  def classify_ticket(text):
      ...

This lets Traeco break down cost and token usage per feature in the dashboard.`;

  return (
    <div className="min-h-full px-6 py-10 sm:px-10" style={{ background: "#0d0d0e" }}>
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="mb-10">
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: "rgba(14,113,74,0.18)", color: "#2de080", border: "1px solid rgba(45,224,128,0.2)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            SDK Setup
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white" style={{ letterSpacing: "-0.028em" }}>
            Connect your agent to Traeco
          </h1>
          <p className="mt-2 text-base" style={{ color: "#71717a" }}>
            3 lines of code. Works with any Anthropic or OpenAI agent.
          </p>
        </div>

        <div className="space-y-5">

          {/* Step 1: Install */}
          <Card>
            <SectionHeader n={1} title="Install the SDK" subtitle="One command. Python 3.8+. No extra dependencies." />
            <CodeBlock code="pip install traeco-sdk" label="terminal" />
          </Card>

          {/* Step 2: Add 3 lines */}
          <Card>
            <SectionHeader n={2} title="Add 3 lines to your agent" subtitle="Your API key is pre-filled. Paste into your agent file." />

            {/* Provider toggle */}
            <div className="flex gap-1 rounded-lg p-1 mb-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", width: "fit-content" }}>
              {(["anthropic", "openai"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium transition-all"
                  style={{
                    background: provider === p ? "rgba(27,168,111,0.25)" : "transparent",
                    color: provider === p ? "#2de080" : "#71717a",
                    border: provider === p ? "1px solid rgba(45,224,128,0.3)" : "1px solid transparent",
                  }}
                >
                  {p === "anthropic" ? "Anthropic / Claude" : "OpenAI / GPT"}
                </button>
              ))}
            </div>

            {keyObj && (
              <div
                className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
                style={{ background: "rgba(14,113,74,0.12)", border: "1px solid rgba(45,224,128,0.18)" }}
              >
                <svg className="h-4 w-4 shrink-0" style={{ color: "#2de080" }} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
                <span style={{ color: "#a1a1aa" }}>
                  Your Traeco key:{" "}
                  <code style={{ color: "#2de080", fontFamily: "monospace" }}>
                    {keyObj.raw_key.length > 24 ? keyObj.raw_key.slice(0, 24) + "..." : keyObj.raw_key}
                  </code>
                </span>
                <CopyButton text={keyObj.raw_key} />
              </div>
            )}

            <CodeBlock code={agentCode} label="agent.py" />

            <div
              className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "#71717a" }}
            >
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "#2de080" }} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              Your {provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} never leaves your machine. Traeco only receives token counts, costs, and model names. Never prompt content or provider keys.
            </div>
          </Card>

          {/* Step 3: Optional spans */}
          <Card>
            <SectionHeader
              n={3}
              title="Tag spans for per-feature breakdown (optional)"
              subtitle="Add @span decorators to see cost broken out by function in your dashboard."
            />
            <CodeBlock code={spansCode} label="agent.py" />
            <p className="mt-3 text-xs" style={{ color: "#52525b" }}>
              Each tagged function gets its own row in the By Feature tab on your agent page — cost, tokens, and latency per function call.
            </p>
          </Card>

          {/* Step 4: Claude Code prompts */}
          <div
            className="rounded-2xl border p-6"
            style={{ background: "rgba(14,113,74,0.05)", borderColor: "rgba(27,168,111,0.2)" }}
          >
            <div className="flex items-start gap-4 mb-5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: "rgba(27,168,111,0.2)", color: "#1BA86F", border: "1px solid rgba(27,168,111,0.3)" }}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-white">Using Claude Code?</h2>
                <p className="mt-0.5 text-sm" style={{ color: "#71717a" }}>
                  Copy these prompts into Claude Code and it will add the integration automatically.
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#52525b" }}>Prompt 1 — Basic integration</p>
                </div>
                <p className="text-xs mb-2" style={{ color: "#71717a" }}>
                  Adds <code style={{ color: "#a1a1aa" }}>init()</code> and <code style={{ color: "#a1a1aa" }}>wrap()</code> to your agent file. Run this first.
                </p>
                <CodeBlock code={claudeCodeBasicPrompt} label="paste into Claude Code" />
              </div>

              <div
                className="border-t"
                style={{ borderColor: "rgba(255,255,255,0.05)" }}
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#52525b" }}>Prompt 2 — Add span tags</p>
                </div>
                <p className="text-xs mb-2" style={{ color: "#71717a" }}>
                  Adds <code style={{ color: "#a1a1aa" }}>@span</code> decorators to each LLM function so Traeco breaks down cost per feature.
                </p>
                <CodeBlock code={claudeCodeSpansPrompt} label="paste into Claude Code" />
              </div>
            </div>
          </div>

          {/* Step 5: Verify */}
          <Card>
            <SectionHeader n={5} title="Run your agent and verify" subtitle="Execute your agent once. Data appears in the dashboard within seconds." />
            <div className="space-y-2">
              {[
                { check: "Agent appears in Agents tab", detail: "Auto-registered on first call" },
                { check: "Cost and token data in dashboard", detail: "Live after the first trace" },
                { check: "Recommendations generated", detail: "Within 24 hours of sufficient data" },
              ].map((item) => (
                <div
                  key={item.check}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <svg className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#1BA86F" }} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-white">{item.check}</p>
                    <p className="text-xs" style={{ color: "#52525b" }}>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

        </div>

        {/* Footer links */}
        <div className="mt-8 flex items-center justify-between">
          <Link href="/" className="text-sm" style={{ color: "#3f3f46" }}>
            Go to dashboard
          </Link>
          <Link href="/settings" className="text-sm" style={{ color: "#3f3f46" }}>
            Manage API keys in Settings
          </Link>
        </div>

      </div>
    </div>
  );
}
