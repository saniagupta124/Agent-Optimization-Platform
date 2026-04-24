"use client";

import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { getUsageSummary, getRecDecisions, type TopChangeItem, type UsageSummary } from "../../lib/api";
import { mapToRec } from "../../lib/mapToRec";
import type { Rec, RecStatus, Verdict } from "../../lib/rec-types";
import { DecisionCard } from "../../components/DecisionCard";

type VerdictFilter = "all" | Verdict;

const VERDICT_OPTIONS: Array<{ id: VerdictFilter; label: string }> = [
  { id: "all",               label: "All verdicts" },
  { id: "ship_it",           label: "Ship it" },
  { id: "ship_with_caution", label: "Ship with caution" },
  { id: "canary_only",       label: "Canary only" },
  { id: "hold",              label: "Hold" },
  { id: "insufficient_data", label: "Insufficient data" },
];

const STATUS_TABS: Array<{ id: RecStatus | "all"; label: string }> = [
  { id: "pending",  label: "Pending" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
  { id: "deferred", label: "Deferred" },
  { id: "all",      label: "All" },
];

export default function RecommendationsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [scope, setScope] = useState<"me" | "team">("me");
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [statusFilter, setStatusFilter] = useState<RecStatus | "all">("pending");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      getUsageSummary(token, days, scope),
      getRecDecisions(token).catch(() => [] as import("../../lib/api").RecDecision[]),
    ])
      .then(([s, decisions]) => {
        setSummary(s);
        const mapped = (s.top_changes ?? []).map(mapToRec).map((r) => {
          const d = decisions.find(
            (dec) => dec.agent_id === r.agentId && dec.rec_type === r.type
          );
          return d ? { ...r, status: d.status as Rec["status"] } : r;
        });
        setRecs(mapped);
      })
      .catch(() => {
        setSummary(null);
        setRecs([]);
      })
      .finally(() => setLoading(false));
  }, [token, days, scope]);

  const teamAvailable = summary?.team_view_available ?? false;

  // Unique agents for the filter dropdown
  const agentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of recs) seen.set(r.agentId, r.agent);
    return Array.from(seen.entries());
  }, [recs]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: recs.length };
    for (const r of recs) counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
  }, [recs]);

  const filtered = useMemo(() => {
    return recs.filter((r) => {
      if (agentFilter !== "all" && r.agentId !== agentFilter) return false;
      if (verdictFilter !== "all" && r.verdict !== verdictFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [recs, agentFilter, verdictFilter, statusFilter]);

  const onStatusChange = (id: string, next: RecStatus) => {
    setRecs((prev) => prev.map((r) => (r.num === id ? { ...r, status: next } : r)));
  };

  const pendingSavings = recs
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + parseFloat(r.savings.replace(/[$,]/g, "")), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Recommendations</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cost, quality, and confidence side-by-side. Accept, reject, or defer in one action.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Scope toggle */}
          <div className="inline-flex rounded-full border border-[#2a2a2a] bg-[#161617] p-0.5">
            <button
              type="button"
              onClick={() => setScope("me")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                scope === "me" ? "bg-[#242424] text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              My workspace
            </button>
            <button
              type="button"
              disabled={!teamAvailable}
              onClick={() => teamAvailable && setScope("team")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                scope === "team" ? "bg-[#242424] text-white" : "text-zinc-500 hover:text-zinc-300"
              } ${!teamAvailable ? "cursor-not-allowed opacity-40" : ""}`}
            >
              Team
            </button>
          </div>

          {/* Period */}
          <div className="flex rounded-xl border border-[#2a2a2a] bg-[#161617] p-0.5">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  days === d ? "bg-[#242424] text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Savings summary */}
      {!loading && recs.length > 0 && (
        <div
          className="mb-8 rounded-xl border border-[#3A3A3F] bg-[#27272B] p-6"
          style={{ borderLeft: "3px solid #34D399" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#34D399" }}>
            Savings available
          </p>
          <p className="mt-2 text-2xl font-semibold text-white" style={{ letterSpacing: "-0.02em" }}>
            ${Math.round(pendingSavings).toLocaleString()}/mo
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {recs.filter((r) => r.status === "pending").length} pending recommendation
            {recs.filter((r) => r.status === "pending").length !== 1 ? "s" : ""} in the last {days} days
          </p>
        </div>
      )}

      {/* Decision surface */}
      <div className="traeco-dashboard" style={{ background: "transparent" }}>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-56 animate-pulse rounded-xl"
                style={{ background: "#27272B", border: "1px solid #2F2F35" }}
              />
            ))}
          </div>
        ) : recs.length === 0 ? (
          <div className="tr-empty">
            No recommendations yet. Add agents and run them to generate data.
          </div>
        ) : (
          <>
            {/* Status tabs + filters */}
            <div className="tr-inbox-tabs">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.id}
                  className={`tr-inbox-tab ${statusFilter === t.id ? "active" : ""}`}
                  onClick={() => setStatusFilter(t.id)}
                >
                  {t.label}
                  <span className="tr-inbox-tab-count">{statusCounts[t.id] ?? 0}</span>
                </button>
              ))}
              <div className="tr-inbox-filters">
                {agentOptions.length > 1 && (
                  <select
                    className="tr-select tr-inbox-select"
                    value={agentFilter}
                    onChange={(e) => setAgentFilter(e.target.value)}
                    aria-label="Filter by agent"
                  >
                    <option value="all">All agents</option>
                    {agentOptions.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                )}
                <select
                  className="tr-select tr-inbox-select"
                  value={verdictFilter}
                  onChange={(e) => setVerdictFilter(e.target.value as VerdictFilter)}
                  aria-label="Filter by verdict"
                >
                  {VERDICT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Cards */}
            {filtered.length === 0 ? (
              <div className="tr-empty">No recommendations match the current filters.</div>
            ) : (
              <div>
                {filtered.map((r) => (
                  <DecisionCard key={r.num} rec={r} token={token} onStatusChange={onStatusChange} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
