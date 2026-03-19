"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import AgentBarChart from "../components/AgentBarChart";
import CustomerBarChart from "../components/CustomerBarChart";
import MetricCard from "../components/MetricCard";
import ProviderBarChart from "../components/ProviderBarChart";
import SpendLineChart from "../components/SpendLineChart";
import {
  AgentWithStats,
  getAgents,
  getOverview,
  OverviewMetrics,
} from "../lib/api";

const PURPOSE_COLORS: Record<string, string> = {
  support: "bg-blue-900/50 text-blue-300",
  research: "bg-purple-900/50 text-purple-300",
  code_review: "bg-green-900/50 text-green-300",
  sales: "bg-amber-900/50 text-amber-300",
  email: "bg-cyan-900/50 text-cyan-300",
  general: "bg-gray-800 text-gray-300",
};

export default function Dashboard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([getOverview(token), getAgents(token)])
      .then(([o, a]) => {
        setOverview(o);
        setAgents(a);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const userName = session?.user?.name || "there";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Welcome back, {userName}
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Your AI agent spend overview
          </p>
        </div>
        <Link
          href="/agents/new"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Agent
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/50 p-4 text-red-400">
          API unreachable: {error}
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-gray-800 bg-gray-900"
              />
            ))}
          </>
        ) : overview ? (
          <>
            <MetricCard
              title="Total Spend (7d)"
              value={`$${overview.total_cost.toFixed(2)}`}
            />
            <MetricCard
              title="Total Tokens"
              value={overview.total_tokens.toLocaleString()}
            />
            <MetricCard
              title="Request Count"
              value={overview.request_count.toLocaleString()}
            />
            <MetricCard
              title="Avg Latency"
              value={`${(overview.avg_latency / 1000).toFixed(2)}s`}
            />
          </>
        ) : null}
      </div>

      {/* Agents section */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Your Agents</h2>
          <Link
            href="/agents"
            className="text-sm font-medium text-indigo-400 hover:text-indigo-300"
          >
            View all
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-xl border border-gray-800 bg-gray-900"
              />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/50 p-12 text-center">
            <svg className="mx-auto mb-4 h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <h3 className="mb-1 text-sm font-medium text-gray-300">
              No agents yet
            </h3>
            <p className="mb-4 text-sm text-gray-500">
              Add your first AI agent to start tracking costs
            </p>
            <Link
              href="/agents/new"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Agent
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.slice(0, 6).map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="rounded-xl border border-gray-800 bg-gray-900 p-5 transition hover:border-gray-700"
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
                <p className="mb-3 text-sm text-gray-500">
                  {agent.model}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">
                    7d cost:{" "}
                    <span className="font-medium text-white">
                      ${agent.total_cost_7d.toFixed(2)}
                    </span>
                  </span>
                  <span className="text-gray-500">
                    {agent.request_count_7d.toLocaleString()} reqs
                  </span>
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

      <div className="mb-8">
        <SpendLineChart />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgentBarChart />
        <CustomerBarChart />
      </div>

      <div className="mt-6">
        <ProviderBarChart />
      </div>
    </div>
  );
}
