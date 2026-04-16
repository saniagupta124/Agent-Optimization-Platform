"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { getAgent, updateAgent } from "../../../../lib/api";

const PURPOSES = [
  { value: "support", label: "Customer Support" },
  { value: "research", label: "Research" },
  { value: "code_review", label: "Code Review" },
  { value: "sales", label: "Sales" },
  { value: "email", label: "Email" },
  { value: "general", label: "General" },
];

const PROVIDERS: Record<string, { label: string; models: string[] }> = {
  openai: { label: "OpenAI", models: ["openai/gpt-4o", "openai/gpt-4o-mini"] },
  anthropic: { label: "Anthropic", models: ["anthropic/claude-3-sonnet", "anthropic/claude-3-haiku"] },
  perplexity: { label: "Perplexity", models: ["perplexity/pplx-70b"] },
  google: { label: "Google", models: ["google/gemini-pro"] },
};

const QUALITY_LEVELS = [
  { value: "high", label: "High", desc: "Never sacrifice quality for cost" },
  { value: "medium", label: "Medium", desc: "Balance quality and cost" },
  { value: "low", label: "Low", desc: "Optimize aggressively for cost" },
];

export default function EditAgentPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [loadingAgent, setLoadingAgent] = useState(true);
  const [agentName, setAgentName] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [purpose, setPurpose] = useState("general");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("openai/gpt-4o");
  const [qualitySensitivity, setQualitySensitivity] = useState("medium");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoFilePath, setRepoFilePath] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [temperature, setTemperature] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || !agentId) return;
    getAgent(token, agentId)
      .then((agent) => {
        setAgentName(agent.name);
        setName(agent.name);
        setTaskDescription(agent.task_description || "");
        setPurpose(agent.purpose || "general");
        const detectedProvider = agent.provider || "openai";
        setProvider(detectedProvider);
        setModel(agent.model || PROVIDERS[detectedProvider]?.models[0] || "");
        setQualitySensitivity(agent.quality_sensitivity || "medium");
        setRepoUrl(agent.repo_url || "");
        setRepoFilePath(agent.repo_file_path || "");
        setSystemPrompt(agent.system_prompt || "");
        setMaxTokens(agent.max_tokens != null ? String(agent.max_tokens) : "");
        setTemperature(agent.temperature != null ? String(agent.temperature) : "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingAgent(false));
  }, [token, agentId]);

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    setModel(PROVIDERS[newProvider]?.models[0] || "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setLoading(true);
    try {
      await updateAgent(token, agentId, {
        name,
        purpose,
        provider,
        model,
        task_description: taskDescription,
        quality_sensitivity: qualitySensitivity,
        system_prompt: systemPrompt,
        max_tokens: maxTokens ? parseInt(maxTokens) : null,
        temperature: temperature ? parseFloat(temperature) : null,
        repo_url: repoUrl,
        repo_file_path: repoFilePath,
      });
      router.push(`/agents/${agentId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to update agent");
    } finally {
      setLoading(false);
    }
  }

  if (loadingAgent) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-8 w-64 animate-pulse rounded bg-[#242424]" />
        <div className="mt-6 space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[#242424]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-normal text-white">Edit Agent: {agentName}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Update your agent's settings. Tracing and SDK token are unchanged.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-zinc-300">Agent Name</label>
          <input
            id="name" type="text" required
            value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
          />
        </div>

        <div>
          <label htmlFor="taskDesc" className="mb-1.5 block text-sm font-medium text-zinc-300">
            What does this agent do?
            <span className="ml-2 text-xs font-normal text-zinc-500">Optional, used to seed initial recommendations</span>
          </label>
          <textarea
            id="taskDesc"
            value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            placeholder="Handles tier-1 customer questions, classifies support tickets..."
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-300">
            Quality Sensitivity
            <span className="ml-2 text-xs font-normal text-zinc-500">How aggressively should Slash recommend cheaper models?</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {QUALITY_LEVELS.map((q) => (
              <button
                key={q.value} type="button"
                onClick={() => setQualitySensitivity(q.value)}
                className={`rounded-lg border p-3 text-left transition ${
                  qualitySensitivity === q.value
                    ? "border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500"
                    : "border-[#333333] bg-[#141414]/50 hover:border-zinc-600"
                }`}
              >
                <p className="text-sm font-semibold text-white">{q.label}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{q.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="purpose" className="mb-1.5 block text-sm font-medium text-zinc-300">Purpose</label>
            <select id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}
              className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-600">
              {PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="provider" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Default Provider
              <span className="ml-1 text-xs font-normal text-zinc-500">(tracing detects all)</span>
            </label>
            <select id="provider" value={provider} onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-600">
              {Object.entries(PROVIDERS).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="model" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Default Model
            <span className="ml-1 text-xs font-normal text-zinc-500">(tracing detects actual models used)</span>
          </label>
          <select id="model" value={model} onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-600">
            {(PROVIDERS[provider]?.models || []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* GitHub repo for auto-implement */}
        <div className="rounded-xl border border-[#333333]/50 bg-[#141414]/30 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-zinc-300">GitHub Repo Integration</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Optional. Lets Traeco open pull requests to implement recommendations automatically.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Repo URL</label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder="https://github.com/your-org/your-repo"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Agent file path</label>
            <input
              type="text"
              value={repoFilePath}
              onChange={(e) => setRepoFilePath(e.target.value)}
              className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder="agents/support_bot.py"
            />
          </div>
        </div>

        {/* Advanced section */}
        <div>
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white">
            <svg className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Advanced settings
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-4 rounded-xl border border-[#333333]/50 bg-[#141414]/30 p-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300">System Prompt</label>
                <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3}
                  className="w-full resize-none rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-600"
                  placeholder="You are a helpful customer support agent..." />
                <p className="mt-1 text-xs text-zinc-500">Stored for context, used to improve recommendations</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-300">Max Tokens</label>
                  <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} min={1} max={128000}
                    className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-600"
                    placeholder="e.g. 4096" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-300">Temperature</label>
                  <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)} min={0} max={2} step={0.1}
                    className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-600"
                    placeholder="0.0 – 2.0" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading}
            className="rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:from-emerald-500 hover:to-emerald-700 disabled:opacity-50">
            {loading ? "Saving..." : "Save Changes"}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded-lg border border-[#333333] bg-[#242424] px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-[#303030]">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
