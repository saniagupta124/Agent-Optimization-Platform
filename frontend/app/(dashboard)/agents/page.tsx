"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { AgentWithStats, getAgents } from "../../lib/api";

const PURPOSE_COLORS: Record<string, string> = {
  support: "bg-emerald-900/50 text-emerald-300",
  research: "bg-purple-900/50 text-purple-300",
  code_review: "bg-green-900/50 text-green-300",
  sales: "bg-amber-900/50 text-amber-300",
  email: "bg-emerald-900/50 text-emerald-300",
  general: "bg-[#1e1e1e] text-zinc-300",
};

export default function AgentsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getAgents(token)
      .then(setAgents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Agents</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Manage your AI agents and track their usage
          </p>
        </div>
        <Link
          href="/agents/new"
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-800 px-4 py-2 text-sm font-medium text-white shadow-md  transition hover:from-emerald-600 hover:to-emerald-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Agent
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/50 p-4 text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-xl border border-[#2a2a2a] bg-[#141414]"
            />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#333333] bg-[#141414]/50 p-16 text-center">
          <svg className="mx-auto mb-4 h-12 w-12 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <h3 className="mb-2 text-base font-medium text-zinc-300">
            No agents yet
          </h3>
          <p className="mb-6 text-sm text-zinc-500">
            Register your first AI agent to start tracking token usage and get
            optimization recommendations.
          </p>
          <Link
            href="/agents/new"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-800 px-5 py-2.5 text-sm font-medium text-white shadow-md  hover:from-emerald-600 hover:to-emerald-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Your First Agent
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5 transition hover:border-[#333333]"
            >
              <div className="mb-3 flex items-start justify-between">
                <h3 className="font-medium text-white">{agent.name}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    PURPOSE_COLORS[agent.purpose] || PURPOSE_COLORS.general
                  }`}
                >
                  {agent.purpose}
                </span>
              </div>
              <div className="mb-4 space-y-1 text-sm text-zinc-500">
                <p>{agent.provider} / {agent.model}</p>
                {agent.api_key_hint && (
                  <p>Key: ****{agent.api_key_hint}</p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-[#2a2a2a] pt-4">
                <div>
                  <p className="text-xs text-zinc-500">7d Cost</p>
                  <p className="text-sm font-medium text-white">
                    ${agent.total_cost_7d.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Tokens</p>
                  <p className="text-sm font-medium text-white">
                    {agent.total_tokens_7d.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Requests</p>
                  <p className="text-sm font-medium text-white">
                    {agent.request_count_7d.toLocaleString()}
                  </p>
                </div>
              </div>
              {agent.top_recommendation && (
                <div className="mt-3 rounded-md bg-amber-950/30 px-3 py-1.5 text-xs text-amber-400">
                  {agent.top_recommendation}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
