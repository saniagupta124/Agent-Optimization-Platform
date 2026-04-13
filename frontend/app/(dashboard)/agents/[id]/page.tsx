"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import SpendLineChart from "../../../components/SpendLineChart";
import {
  AgentDashboard,
  AgentWithStats,
  applySpanRecommendation,
  deleteAgent,
  getAgent,
  getAgentDashboard,
  getOptimizations,
  getOverview,
  getSpanRecommendations,
  OptimizationResponse,
  OverviewMetrics,
  SpanRecommendation,
} from "../../../lib/api";

const POLL_MS = 10_000;

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

const REC_TYPE_LABELS: Record<string, string> = {
  model_swap: "Model Swap",
  retry_loop: "Retry Loop",
  context_bloat: "Context Bloat",
  redundant_calls: "Redundant Calls",
  model_overkill: "Model Overkill",
};

const REC_TYPE_COLORS: Record<string, string> = {
  model_swap: "bg-blue-900/50 text-blue-300",
  retry_loop: "bg-rose-900/50 text-rose-300",
  context_bloat: "bg-amber-900/50 text-amber-300",
  redundant_calls: "bg-purple-900/50 text-purple-300",
  model_overkill: "bg-orange-900/50 text-orange-300",
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
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null);
  const [spanRecs, setSpanRecs] = useState<SpanRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<"step" | "model">("step");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial load
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

  // Poll dashboard + span recs every 10s
  useEffect(() => {
    if (!token || !agentId) return;

    function fetchLive() {
      if (!token) return;
      Promise.all([
        getAgentDashboard(token, agentId),
        getSpanRecommendations(token, agentId),
      ])
        .then(([d, r]) => {
          setDashboard(d);
          setSpanRecs(r);
        })
        .catch(() => {
          // non-fatal — live panel just stays empty
        });
    }

    fetchLive();
    pollRef.current = setInterval(fetchLive, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
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

  async function handleApply(recId: string) {
    if (!token) return;
    setApplying(recId);
    try {
      await applySpanRecommendation(token, recId);
      setSpanRecs((prev) =>
        prev.map((r) => (r.id === recId ? { ...r, applied: true } : r))
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApplying(null);
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

      {/* KPI cards — static 7d overview + live session cost */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
          <p className="text-sm font-medium text-zinc-400">Monthly Cost Est.</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            ${optimizations?.current_monthly_cost_estimate?.toFixed(2) || "0.00"}
          </p>
        </div>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
          <p className="text-sm font-medium text-zinc-400">Session Cost (1h)</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            ${dashboard?.session_cost_usd?.toFixed(4) ?? overview?.total_cost?.toFixed(2) ?? "0.00"}
          </p>
          {dashboard && (
            <p className="mt-0.5 text-xs text-zinc-600">
              {dashboard.requests_per_minute.toFixed(1)} req/min
            </p>
          )}
        </div>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
          <p className="text-sm font-medium text-zinc-400">7d Requests</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {overview?.request_count?.toLocaleString() ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
          <p className="text-sm font-medium text-zinc-400">Avg Latency</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {overview ? `${(overview.avg_latency / 1000).toFixed(2)}s` : "—"}
          </p>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: charts + span breakdown */}
        <div className="lg:col-span-2 space-y-6">
          <SpendLineChart agentId={agentId} />

          {/* Tabbed cost breakdown — always shown */}
          {(
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414]">
              {/* Tab bar */}
              <div className="flex items-center justify-between border-b border-[#2a2a2a] px-5 pt-4">
                <div className="flex gap-6">
                  {(
                    [
                      { id: "step" as const, label: "By Step" },
                      { id: "model" as const, label: "By Model" },
                    ]
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setBreakdownTab(id)}
                      className={`relative pb-3 text-sm font-medium transition ${
                        breakdownTab === id
                          ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-emerald-500"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="pb-3 text-xs text-zinc-600">updates every 10s</span>
              </div>

              {/* Tab content */}
              <div className="p-5">
                {breakdownTab === "step" ? (
                  dashboard.by_span.length === 0 ? (
                    <p className="py-4 text-center text-sm text-zinc-500">
                      No span data yet — add{" "}
                      <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-emerald-400 text-xs">
                        @span
                      </code>{" "}
                      decorators to your agent functions.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {dashboard.by_span.map((row) => {
                        const maxCost = dashboard.by_span[0]?.total_cost || 1;
                        const pct = Math.round((row.total_cost / maxCost) * 100);
                        return (
                          <div key={row.span_name}>
                            <div className="mb-1.5 flex items-center justify-between text-xs">
                              <span className="font-mono text-zinc-300">{row.span_name}</span>
                              <span className="tabular-nums text-zinc-400">
                                ${row.total_cost.toFixed(4)}{" "}
                                <span className="text-zinc-600">({row.request_count} calls)</span>
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#222]">
                              <div
                                className="h-full rounded-full bg-emerald-500/70"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  dashboard.by_model.length === 0 ? (
                    <p className="py-4 text-center text-sm text-zinc-500">No model data for this period.</p>
                  ) : (
                    <div className="space-y-2">
                      {dashboard.by_model.map((row) => {
                        const maxCost = dashboard.by_model[0]?.total_cost || 1;
                        const pct = Math.round((row.total_cost / maxCost) * 100);
                        return (
                          <div key={row.model}>
                            <div className="mb-1.5 flex items-center justify-between text-xs">
                              <span className="font-mono text-zinc-300">{row.model}</span>
                              <span className="tabular-nums text-zinc-400">
                                ${row.total_cost.toFixed(4)}{" "}
                                <span className="text-zinc-600">· {row.request_count} calls</span>
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#222]">
                              <div
                                className="h-full rounded-full bg-indigo-500/70"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}

                {/* Retry loop warnings — always show if present */}
                {dashboard.retry_loops.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {dashboard.retry_loops.map((loop, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs"
                      >
                        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                        <span className="text-rose-300">
                          <span className="font-mono font-semibold">{loop.span_name}</span>
                          {" "}fired 3+ times in {loop.window_seconds}s — possible retry loop
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right column: recommendations */}
        <div className="space-y-4">

          {/* Span recommendations (new, live) */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Recommendations</h2>
              {spanRecs.length > 0 && (
                <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-400">
                  ${spanRecs.reduce((s, r) => s + (r.applied ? 0 : r.savings_per_month), 0).toFixed(2)}/mo potential
                </span>
              )}
            </div>

            {spanRecs.length === 0 ? (
              <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-6 text-center">
                <svg className="mx-auto mb-3 h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <p className="text-sm text-zinc-400">No recommendations yet — run your agent to generate data.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {spanRecs.map((rec) => (
                  <div
                    key={rec.id}
                    className={`rounded-xl border p-4 transition ${
                      rec.applied
                        ? "border-[#2a2a2a] bg-[#141414] opacity-60"
                        : "border-[#2a2a2a] bg-[#161617]"
                    }`}
                  >
                    {/* Type badge + span name */}
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          REC_TYPE_COLORS[rec.rec_type] || "bg-[#242424] text-zinc-400"
                        }`}
                      >
                        {REC_TYPE_LABELS[rec.rec_type] ?? rec.rec_type}
                      </span>
                      <span className="font-mono text-xs text-zinc-500">{rec.span_name}</span>
                      <span className="ml-auto text-xs tabular-nums text-zinc-600">
                        {rec.confidence}% confidence
                      </span>
                    </div>

                    {/* Explanation */}
                    <p className="mb-3 text-sm leading-relaxed text-zinc-400">{rec.explanation}</p>

                    {/* Cost numbers */}
                    <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-xs text-zinc-600">Current</p>
                        <p className="text-sm font-semibold text-zinc-300">
                          ${rec.current_monthly_cost.toFixed(2)}/mo
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-600">After Fix</p>
                        <p className="text-sm font-semibold text-zinc-300">
                          ${rec.projected_monthly_cost.toFixed(2)}/mo
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-600">Save</p>
                        <p className="text-sm font-semibold text-emerald-400">
                          ${rec.savings_per_month.toFixed(2)}/mo
                        </p>
                      </div>
                    </div>

                    {/* Apply button */}
                    {rec.applied ? (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        Applied
                      </div>
                    ) : (
                      <button
                        onClick={() => handleApply(rec.id)}
                        disabled={applying === rec.id}
                        className="w-full rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-900/40 disabled:opacity-50"
                      >
                        {applying === rec.id ? "Applying..." : "Mark as Applied"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Existing optimization recommendations (model/prompt/outlier) */}
          {optimizations && optimizations.recommendations.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-zinc-500">Agent-Level Checks</h2>
              <div className="space-y-3">
                {optimizations.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className={`rounded-xl border p-4 ${
                      SEVERITY_COLORS[rec.severity] || SEVERITY_COLORS.low
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <h3 className="text-sm font-medium text-white">{rec.title}</h3>
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
                ))}
              </div>
            </div>
          )}

          {/* Provider comparison */}
          {optimizations && optimizations.provider_comparison.length > 0 && (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
              <h3 className="mb-3 text-sm font-semibold text-white">Provider Cost Comparison</h3>
              <div className="space-y-2">
                {optimizations.provider_comparison.slice(0, 6).map((pc, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md bg-[#1e1e1e]/50 px-3 py-2 text-sm"
                  >
                    <span className="text-zinc-300">{pc.model}</span>
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
