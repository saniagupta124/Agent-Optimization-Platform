"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { createAgent } from "../../../lib/api";

const PURPOSES = [
  { value: "support", label: "Customer Support" },
  { value: "research", label: "Research" },
  { value: "code_review", label: "Code Review" },
  { value: "sales", label: "Sales" },
  { value: "email", label: "Email" },
  { value: "general", label: "General" },
];

const PROVIDERS: Record<string, { label: string; models: string[] }> = {
  openai: {
    label: "OpenAI",
    models: ["openai/gpt-4o", "openai/gpt-4o-mini"],
  },
  anthropic: {
    label: "Anthropic",
    models: [
      "anthropic/claude-3-5-sonnet-20241022",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-3-haiku-20240307",
      "anthropic/claude-3-5-haiku",
      "anthropic/claude-3-opus-20240229",
    ],
  },
  perplexity: {
    label: "Perplexity",
    models: ["perplexity/pplx-70b"],
  },
  google: {
    label: "Google",
    models: ["google/gemini-pro"],
  },
};

export default function NewAgentPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("general");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("openai/gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    const firstModel = PROVIDERS[newProvider]?.models[0] || "";
    setModel(firstModel);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setLoading(true);

    try {
      const hint = apiKey.length >= 4 ? apiKey.slice(-4) : apiKey;
      await createAgent(token, {
        name,
        purpose,
        provider,
        model,
        api_key_hint: hint,
        max_tokens: maxTokens ? parseInt(maxTokens, 10) : undefined,
      });
      router.push("/agents");
    } catch (err: any) {
      setError(err?.message || "Failed to create agent");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Add New Agent</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Register an AI agent to track its token usage
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Agent Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            placeholder='e.g. "Customer Support Bot"'
          />
        </div>

        <div>
          <label htmlFor="purpose" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Purpose
          </label>
          <select
            id="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
          >
            {PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="provider" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Provider
            </label>
            <select
              id="provider"
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            >
              {Object.entries(PROVIDERS).map(([key, val]) => (
                <option key={key} value={key}>
                  {val.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="model" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            >
              {(PROVIDERS[provider]?.models || []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="maxTokens" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Max Tokens <span className="text-zinc-500">(optional — leave blank to detect uncapped scaling risk)</span>
          </label>
          <input
            id="maxTokens"
            type="number"
            min={1}
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            placeholder="e.g. 1024"
          />
          {!maxTokens && (
            <p className="mt-1.5 text-xs text-amber-400">
              No cap set — Traeco will flag this as a quadratic scaling risk
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[#2a2a2a] bg-[#0f0f10] px-4 py-3 text-xs" style={{ color: "#71717a" }}>
          <div className="flex items-start gap-2">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span>
              <span className="font-medium text-zinc-300">Using the SDK?</span> Skip the API key — your agent auto-registers the first time it sends a trace.
              Your provider key never leaves your machine. Traeco only receives token counts, costs, and model names.
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="apiKey" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Provider API Key <span className="text-zinc-500">(optional — last 4 chars only, for identification)</span>
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            placeholder="sk-... (optional if using SDK)"
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            We store only the last 4 characters as a hint. Your full key is never saved.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg  transition hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Agent"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-[#333333] bg-[#1e1e1e] px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-[#2a2a2a]"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
