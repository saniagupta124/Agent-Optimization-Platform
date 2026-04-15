"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { AgentWithStats, getAgents } from "../../lib/api";

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
    <div className="px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white" style={{ letterSpacing: "-0.02em" }}>Agents</h1>
        <p className="mt-1 text-sm text-[#71717A]">All connected agents and their cost profiles</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[#3A3A3F] bg-[#27272B] overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr_1fr_32px] gap-4 border-b border-[#3A3A3F] px-6 py-3">
          {["Agent", "Provider/Model", "Runs", "Cost", "Avg/run", "Trend", ""].map((h) => (
            <span key={h} className="text-xs font-semibold uppercase tracking-wider text-[#71717A]">{h}</span>
          ))}
        </div>

        {loading ? (
          <div className="divide-y divide-[#2F2F35]">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr_1fr_32px] gap-4 px-6 py-4">
                {[1, 2, 3, 4, 5, 6].map((j) => (
                  <div key={j} className="h-4 animate-pulse rounded bg-[#3A3A3F]" />
                ))}
              </div>
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="py-20 text-center">
            <svg className="mx-auto mb-4 h-10 w-10 text-[#3A3A3F]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <p className="text-sm text-[#71717A]">No agents yet</p>
            <Link
              href="/agents/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1A1A1E]"
              style={{ background: "#F5C518" }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add your first agent
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[#2F2F35]">
            {agents.map((agent) => {
              const avgPerRun = agent.request_count_7d > 0
                ? agent.total_cost_7d / agent.request_count_7d
                : 0;
              return (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr_1fr_32px] gap-4 px-6 py-4 transition hover:bg-[#2E2E33] items-center"
                >
                  {/* Agent name + status dot */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#34D399]" />
                    <span className="truncate text-sm font-medium text-white">{agent.name}</span>
                  </div>
                  {/* Provider/Model */}
                  <div className="min-w-0">
                    <span className="truncate text-xs text-[#71717A]">
                      {agent.provider} / {agent.model.split("/").pop()}
                    </span>
                  </div>
                  {/* Runs */}
                  <span className="text-sm text-white tabular-nums">
                    {agent.request_count_7d.toLocaleString()}
                  </span>
                  {/* Cost */}
                  <span className="text-sm font-medium text-white tabular-nums">
                    ${agent.total_cost_7d.toFixed(2)}
                  </span>
                  {/* Avg/run */}
                  <span className="text-sm text-white tabular-nums">
                    ${avgPerRun.toFixed(4)}
                  </span>
                  {/* Trend placeholder */}
                  <span className="text-sm font-medium text-[#34D399]">—</span>
                  {/* Chevron */}
                  <svg className="h-4 w-4 text-[#52525B]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
