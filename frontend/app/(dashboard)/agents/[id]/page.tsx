"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import SpendLineChart from "../../../components/SpendLineChart";
import {
  AgentWithStats,
  deleteAgent,
  getAgent,
  getOptimizations,
  getOverview,
  OptimizationResponse,
  OverviewMetrics,
} from "../../../lib/api";

const PURPOSE_COLORS: Record<string, string> = {
  support: "bg-emerald-900/50 text-emerald-300",
  research: "bg-purple-900/50 text-purple-300",
  code_review: "bg-green-900/50 text-green-300",
  sales: "bg-amber-900/50 text-amber-300",
  email: "bg-emerald-900/50 text-emerald-300",
  general: "bg-[#1e1e1e] text-zinc-300",
};

const SEVERITY_COLORS: Record<string, string> = {
  high: "border-red-800 bg-red-950/30",
  medium: "border-amber-800 bg-amber-950/30",
  low: "border-emerald-800 bg-emerald-950/30",
};

const SEVERITY_BADGE: Record<string, string> = {
  high: "bg-red-900/50 text-red-300",
  medium: "bg-amber-900/50 text-amber-300",
  low: "bg-emerald-900/50 text-emerald-300",
};

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [agent, setAgent] = useState<AgentWithStats | null>(null);
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [optimizations, setOptimizations] = useState<OptimizationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!token || !agentId) return;
    Promise.all([
      getAgent(token, agentId),
      getOverview(token, agentId),
      getOptimizations(token, agentId),
    ])
      .then(([a, o, opt]) => {
        setAgent(a);
        setOverview(o);
        setOptimizations(opt);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, agentId]);

  async function handleDelete() {
    if (!token || !confirm("Are you sure you want to delete this agent?")) return;
    setDeleting(true);
    try {
      await deleteAgent(token, agentId);
      router.push("/agents");
    } catch (e: any) {
      setError(e.message);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-8 w-48 animate-pulse rounded bg-[#1e1e1e]" />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="h-72 animate-pulse rounded-xl border border-[#2a2a2a] bg-[#141414]" />
            <div className="h-72 animate-pulse rounded-xl border border-[#2a2a2a] bg-[#141414]" />
          </div>
          <div className="h-96 animate-pulse rounded-xl border border-[#2a2a2a] bg-[#141414]" />
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-900 bg-red-950/50 p-6 text-red-400">
          {error || "Agent not found"}
        </div>
        <Link href="/agents" className="mt-4 inline-block text-sm text-emerald-400 hover:text-emerald-300">
          Back to Agents
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{agent.name}</h1>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                PURPOSE_COLORS[agent.purpose] || PURPOSE_COLORS.general
              }`}
            >
              {agent.purpose}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm text-zinc-400">
            <span>{agent.provider}</span>
            <span className="text-gray-600">|</span>
            <span>{agent.model}</span>
            {agent.api_key_hint && (
              <>
                <span className="text-gray-600">|</span>
                <span>Key: ****{agent.api_key_hint}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-lg border border-red-800 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-950/50 disabled:opacity-50"
        >
          {deleting ? "Deleting..." : "Delete Agent"}
        </button>
      </div>

      {/* Metric cards */}
      {overview && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
            <p className="text-sm font-medium text-zinc-400">Monthly Cost Est.</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              ${optimizations?.current_monthly_cost_estimate?.toFixed(2) || "0.00"}
            </p>
          </div>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
            <p className="text-sm font-medium text-zinc-400">7d Spend</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              ${overview.total_cost.toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
            <p className="text-sm font-medium text-zinc-400">7d Requests</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {overview.request_count.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
            <p className="text-sm font-medium text-zinc-400">Avg Latency</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {(overview.avg_latency / 1000).toFixed(2)}s
            </p>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Charts (left side) */}
        <div className="lg:col-span-2 space-y-6">
          <SpendLineChart agentId={agentId} />
        </div>

        {/* Optimizations (right side) */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">
            Optimization Recommendations
          </h2>

          {!optimizations || optimizations.recommendations.length === 0 ? (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-6 text-center">
              <svg className="mx-auto mb-3 h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="text-sm text-zinc-400">
                No recommendations at this time. Your agent is running efficiently!
              </p>
            </div>
          ) : (
            optimizations.recommendations.map((rec, i) => (
              <div
                key={i}
                className={`rounded-xl border p-4 ${
                  SEVERITY_COLORS[rec.severity] || SEVERITY_COLORS.low
                }`}
              >
                <div className="mb-2 flex items-start justify-between">
                  <h3 className="text-sm font-medium text-white">
                    {rec.title}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      SEVERITY_BADGE[rec.severity] || SEVERITY_BADGE.low
                    }`}
                  >
                    {rec.severity}
                  </span>
                </div>
                <p className="mb-3 text-sm text-zinc-400">{rec.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-green-400">
                    Save ~${rec.estimated_savings_usd.toFixed(2)}/mo
                  </span>
                </div>
                <p className="mt-2 rounded-md bg-[#141414]/50 px-3 py-2 text-xs text-zinc-300">
                  {rec.action}
                </p>
              </div>
            ))
          )}

          {/* Provider comparison */}
          {optimizations && optimizations.provider_comparison.length > 0 && (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
              <h3 className="mb-3 text-sm font-semibold text-white">
                Provider Cost Comparison
              </h3>
              <div className="space-y-2">
                {optimizations.provider_comparison.map((pc, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md bg-[#1e1e1e]/50 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="text-zinc-300">{pc.model}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-white">
                        ${pc.estimated_monthly_cost.toFixed(2)}
                      </span>
                      {pc.vs_current && (
                        <span
                          className={`text-xs font-medium ${
                            pc.vs_current.startsWith("-")
                              ? "text-green-400"
                              : pc.vs_current.startsWith("+")
                              ? "text-red-400"
                              : "text-zinc-500"
                          }`}
                        >
                          {pc.vs_current}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
