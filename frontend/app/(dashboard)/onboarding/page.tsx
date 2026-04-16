"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { createSdkKey, getAgents, listSdkKeys, SdkKeyCreated } from "../../lib/api";

// ── Helpers ─────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
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
    <div
      className="relative mt-3 rounded-xl border"
      style={{ background: "#0a0a0b", borderColor: "rgba(255,255,255,0.08)" }}
    >
      {label && (
        <div
          className="flex items-center justify-between border-b px-4 py-2"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <span className="text-xs" style={{ color: "#52525b", fontFamily: "monospace" }}>
            {label}
          </span>
          <CopyButton text={code} />
        </div>
      )}
      <pre
        className="overflow-x-auto px-4 py-4 text-sm leading-relaxed"
        style={{ color: "#d4d4d8", fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace" }}
      >
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

function Spinner() {
  return (
    <svg
      className="animate-spin"
      style={{ width: 18, height: 18, color: "#2de080" }}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── Step indicators ──────────────────────────────────────────────────────────

function StepBadge({
  n,
  state,
}: {
  n: number;
  state: "done" | "active" | "idle";
}) {
  const bgMap = {
    done: "#0E714A",
    active: "#1BA86F",
    idle: "rgba(255,255,255,0.06)",
  };
  const colorMap = {
    done: "#2de080",
    active: "#fff",
    idle: "#52525b",
  };
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all"
      style={{ background: bgMap[state], color: colorMap[state] }}
    >
      {state === "done" ? (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        n
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { data: session, status: sessionStatus } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken;

  // SDK key state
  const [keyObj, setKeyObj] = useState<SdkKeyCreated | null>(null);
  const [keyLoading, setKeyLoading] = useState(true);
  const [keyError, setKeyError] = useState("");

  // Trace polling state
  const [pollStep, setPollStep] = useState<"waiting" | "connected">("waiting");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load or create SDK key on mount ───────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    setKeyLoading(true);
    listSdkKeys(token)
      .then(async (keys) => {
        if (keys.length === 0) {
          // Auto-create the first key
          const created = await createSdkKey(token, "Default");
          setKeyObj(created);
        } else {
          // Already has keys — show a placeholder (raw key not re-accessible)
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
      .catch((e) => setKeyError(e.message || "Could not load API keys"))
      .finally(() => setKeyLoading(false));
  }, [token]);

  // ── Poll for first trace ──────────────────────────────────────────────────
  useEffect(() => {
    if (!token || pollStep === "connected") return;

    async function check() {
      if (!token) return;
      try {
        const agents = await getAgents(token);
        if (agents.length > 0) {
          setPollStep("connected");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ignore poll errors
      }
    }

    pollRef.current = setInterval(check, 4000);
    void check(); // immediate first check

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token, pollStep]);

  // ── Derive current step for UI ─────────────────────────────────────────────
  const currentStep = pollStep === "connected" ? 3 : keyObj ? 2 : 1;

  // ── Code snippets ─────────────────────────────────────────────────────────
  const apiKey = keyObj?.raw_key ?? "tk_live_...";
  const installCmd = "pip install traeco-sdk";
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");

  const agentCode =
    provider === "anthropic"
      ? `import os
from anthropic import Anthropic
from traeco import init, wrap

# 1. Initialize Traeco (your TRAECO key only, not your Anthropic key)
init(api_key="${apiKey}", agent_name="my_agent")

# 2. Wrap your Anthropic client
#    ANTHROPIC_API_KEY stays on your machine. Traeco never sees it.
client = wrap(Anthropic())

# 3. Use Claude exactly as before. Zero code changes.
response = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=200,
    messages=[{"role": "user", "content": "Hello!"}]
)`
      : `import os
from openai import OpenAI
from traeco import init, wrap

# 1. Initialize Traeco (your TRAECO key only, not your OpenAI key)
init(api_key="${apiKey}", agent_name="my_agent")

# 2. Wrap your OpenAI client
#    OPENAI_API_KEY stays on your machine. Traeco never sees it.
client = wrap(OpenAI())

# 3. Use GPT exactly as before. Zero code changes.
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)`;

  if (sessionStatus === "loading" || keyLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

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
            You&rsquo;re in. Let&rsquo;s connect your agent.
          </h1>
          <p className="mt-2 text-base" style={{ color: "#71717a" }}>
            3 lines of code. First insight in 24 hours.
          </p>
        </div>

        {keyError && (
          <div
            className="mb-6 rounded-xl border px-4 py-3 text-sm"
            style={{ background: "rgba(127,29,29,0.2)", borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5" }}
          >
            {keyError}
          </div>
        )}

        {/* Steps */}
        <div className="space-y-6">

          {/* ── Step 1: Install ─────────────────────────────────────────────── */}
          <div
            className="rounded-2xl border p-6 transition-all"
            style={{
              background: currentStep >= 1 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
              borderColor: currentStep === 1 ? "rgba(27,168,111,0.4)" : "rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-start gap-4">
              <StepBadge n={1} state={currentStep > 1 ? "done" : currentStep === 1 ? "active" : "idle"} />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-white">Install the SDK</h2>
                <p className="mt-0.5 text-sm" style={{ color: "#71717a" }}>
                  One command. Supports Python 3.8+. No extra dependencies.
                </p>
                <CodeBlock code={installCmd} label="terminal" />
              </div>
            </div>
          </div>

          {/* ── Step 2: Add 3 lines ─────────────────────────────────────────── */}
          <div
            className="rounded-2xl border p-6 transition-all"
            style={{
              background: currentStep >= 2 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
              borderColor: currentStep === 2 ? "rgba(27,168,111,0.4)" : currentStep > 2 ? "rgba(27,168,111,0.25)" : "rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-start gap-4">
              <StepBadge n={2} state={currentStep > 2 ? "done" : currentStep === 2 ? "active" : "idle"} />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-white">Add 3 lines to your agent</h2>
                <p className="mt-0.5 text-sm" style={{ color: "#71717a" }}>
                  Your API key is pre-filled below. Paste into your agent file.
                </p>

                {/* Provider toggle */}
                <div className="mt-4 flex gap-1 rounded-lg p-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", width: "fit-content" }}>
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
                      Traeco key:{" "}
                      <code style={{ color: "#2de080", fontFamily: "monospace" }}>
                        {keyObj.raw_key.length > 20 ? keyObj.raw_key.slice(0, 20) + "..." : keyObj.raw_key}
                      </code>
                    </span>
                    <CopyButton text={keyObj.raw_key} />
                  </div>
                )}

                <div
                  className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "#71717a" }}
                >
                  <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "#2de080" }} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  Your {provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} never leaves your machine.
                  Traeco only receives token counts, costs, model names, and span tags. Never prompt content or provider keys.
                </div>

                <CodeBlock code={agentCode} label="agent.py" />

                <p className="mt-3 text-xs" style={{ color: "#52525b" }}>
                  Works with any OpenAI or Anthropic client. LangChain, CrewAI, and LangGraph supported. See{" "}
                  <Link href="/settings" className="underline" style={{ color: "#71717a" }}>
                    Settings
                  </Link>{" "}
                  for more examples.
                </p>
              </div>
            </div>
          </div>

          {/* ── Step 3: Waiting for first trace ─────────────────────────────── */}
          <div
            className="rounded-2xl border p-6 transition-all"
            style={{
              background: currentStep >= 3 ? "rgba(14,113,74,0.08)" : "rgba(255,255,255,0.01)",
              borderColor: pollStep === "connected" ? "rgba(45,224,128,0.45)" : "rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-start gap-4">
              <StepBadge n={3} state={pollStep === "connected" ? "done" : currentStep === 3 ? "active" : "idle"} />
              <div className="min-w-0 flex-1">
                {pollStep === "waiting" ? (
                  <>
                    <h2 className="font-semibold text-white">Run your agent</h2>
                    <p className="mt-0.5 text-sm" style={{ color: "#71717a" }}>
                      Execute your agent once. Traeco will detect the first call automatically.
                    </p>
                    <div
                      className="mt-4 flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                    >
                      <Spinner />
                      <div>
                        <p className="text-sm font-medium text-white">Waiting for first trace&hellip;</p>
                        <p className="text-xs" style={{ color: "#52525b" }}>
                          Checking every 4 seconds
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="font-semibold" style={{ color: "#2de080" }}>
                      Connected ✓
                    </h2>
                    <p className="mt-0.5 text-sm" style={{ color: "#71717a" }}>
                      Your first trace arrived. Recommendations land in your dashboard within 24 hours.
                    </p>
                    <div className="mt-5">
                      <Link
                        href="/"
                        className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                        style={{ background: "linear-gradient(135deg, #1BA86F 0%, #0E714A 100%)" }}
                      >
                        View your dashboard
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Skip link */}
        <div className="mt-8 text-center">
          <Link href="/" className="text-sm" style={{ color: "#3f3f46" }}>
            Skip for now, go to dashboard
          </Link>
        </div>

      </div>
    </div>
  );
}
