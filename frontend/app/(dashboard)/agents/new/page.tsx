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
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-gray-300">
            Agent Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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
            API Key <span className="text-gray-500">(only last 4 chars stored)</span>
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            placeholder="sk-..."
          />
          <p className="mt-1.5 text-xs text-gray-500">
            We never store your full API key. Only the last 4 characters are saved for identification.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
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
