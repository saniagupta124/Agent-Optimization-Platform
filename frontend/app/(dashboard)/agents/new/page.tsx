"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import {
  createAgent,
  discoverAnthropic,
  discoverOpenAI,
  registerOpenAIAssistant,
  type AnthropicDiscoverResult,
  type OpenAIDiscoverResult,
} from "../../../lib/api";

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
    models: ["anthropic/claude-3-sonnet", "anthropic/claude-3-haiku"],
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [openaiDiscoverKey, setOpenaiDiscoverKey] = useState("");
  const [openaiDiscover, setOpenaiDiscover] = useState<OpenAIDiscoverResult | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [registeringId, setRegisteringId] = useState<string | null>(null);

  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicDiscover, setAnthropicDiscover] = useState<AnthropicDiscoverResult | null>(null);
  const [anthropicLoading, setAnthropicLoading] = useState(false);

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    const firstModel = PROVIDERS[newProvider]?.models[0] || "";
    setModel(firstModel);
  }

  async function handleDiscoverOpenAI() {
    if (!token || !openaiDiscoverKey.trim()) return;
    setDiscoverLoading(true);
    setOpenaiDiscover(null);
    setError("");
    try {
      const r = await discoverOpenAI(token, openaiDiscoverKey.trim());
      setOpenaiDiscover(r);
      if (!r.valid && r.error) setError(r.error);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function handleAddOpenAIAssistant(assistantId: string) {
    if (!token || !openaiDiscoverKey.trim()) return;
    setRegisteringId(assistantId);
    setError("");
    try {
      await registerOpenAIAssistant(token, {
        api_key: openaiDiscoverKey.trim(),
        assistant_id: assistantId,
        purpose,
      });
      router.push("/agents");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to register assistant");
    } finally {
      setRegisteringId(null);
    }
  }

  async function handleDiscoverAnthropic() {
    if (!token || !anthropicKey.trim()) return;
    setAnthropicLoading(true);
    setAnthropicDiscover(null);
    setError("");
    try {
      const r = await discoverAnthropic(token, anthropicKey.trim());
      setAnthropicDiscover(r);
      if (!r.valid && r.error) setError(r.error);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setAnthropicLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setLoading(true);

    try {
      await createAgent(token, {
        name,
        purpose,
        provider,
        model,
        ...(apiKey.trim()
          ? { api_key: apiKey.trim() }
          : { api_key_hint: "" }),
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
        <p className="mt-1 text-sm text-gray-400">
          Keys and usage live in your database (e.g. Supabase). Paste a key to verify it and pull
          OpenAI Assistants, or fill the form below manually.
        </p>
      </div>

      <div className="mb-8 space-y-6 rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-5">
        <h2 className="text-sm font-semibold text-emerald-200/90">Connect provider (optional)</h2>

        <div>
          <p className="mb-2 text-xs text-gray-400">OpenAI — verify key &amp; import Assistants</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={openaiDiscoverKey}
              onChange={(e) => setOpenaiDiscoverKey(e.target.value)}
              placeholder="sk-..."
              className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              disabled={!token || discoverLoading || !openaiDiscoverKey.trim()}
              onClick={handleDiscoverOpenAI}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {discoverLoading ? "Calling OpenAI…" : "Discover"}
            </button>
          </div>
          {openaiDiscover?.valid && openaiDiscover.assistants.length > 0 && (
            <ul className="mt-3 space-y-2">
              {openaiDiscover.assistants.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900/80 px-3 py-2 text-sm text-gray-200"
                >
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    disabled={registeringId === a.id}
                    onClick={() => handleAddOpenAIAssistant(a.id)}
                    className="shrink-0 rounded bg-orange-600 px-3 py-1 text-xs text-white hover:bg-orange-500 disabled:opacity-50"
                  >
                    {registeringId === a.id ? "Saving…" : "Add to dashboard"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {openaiDiscover?.valid && openaiDiscover.assistants.length === 0 && (
            <p className="mt-2 text-xs text-gray-500">
              Key works (see sample models below). No Assistants on this account — use manual form or
              create Assistants in OpenAI.
            </p>
          )}
          {openaiDiscover?.valid && openaiDiscover.models_sample?.length ? (
            <p className="mt-2 text-xs text-gray-500">
              Sample models: {openaiDiscover.models_sample.slice(0, 8).join(", ")}
              …
            </p>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-xs text-gray-400">Anthropic — verify API key</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              disabled={!token || anthropicLoading || !anthropicKey.trim()}
              onClick={handleDiscoverAnthropic}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {anthropicLoading ? "Verifying…" : "Verify key"}
            </button>
          </div>
          {anthropicDiscover?.valid && anthropicDiscover.models?.length ? (
            <p className="mt-2 text-xs text-gray-400">
              Available models (pick one in the form): {anthropicDiscover.models.slice(0, 12).join(", ")}
              …
            </p>
          ) : null}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-gray-300">
            Agent Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            placeholder='e.g. "Customer Support Bot"'
          />
        </div>

        <div>
          <label htmlFor="purpose" className="mb-1.5 block text-sm font-medium text-gray-300">
            Purpose
          </label>
          <select
            id="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
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
            <label htmlFor="provider" className="mb-1.5 block text-sm font-medium text-gray-300">
              Provider
            </label>
            <select
              id="provider"
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            >
              {Object.entries(PROVIDERS).map(([key, val]) => (
                <option key={key} value={key}>
                  {val.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="model" className="mb-1.5 block text-sm font-medium text-gray-300">
              Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
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
          <label htmlFor="apiKey" className="mb-1.5 block text-sm font-medium text-gray-300">
            API Key <span className="text-gray-500">(hashed server-side; last 4 shown)</span>
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            placeholder="sk-..."
          />
          <p className="mt-1.5 text-xs text-gray-500">
            The backend stores a secure hash so your team can send{" "}
            <code className="text-gray-400">api_key</code> on{" "}
            <code className="text-gray-400">POST /log_request</code> to attribute usage to this agent
            exactly.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-orange-950/30 transition hover:from-orange-400 hover:to-orange-500 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Agent"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-gray-700 bg-gray-800 px-5 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
