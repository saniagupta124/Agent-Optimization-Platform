"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

const DASHBOARD_REFRESH_MS = 30_000;
import {
  AgentWithStats,
  DashboardUsageBreakdown,
  getAgents,
  getUsageBreakdown,
  getUsageSummary,
  getUsageTimeline,
  UsageSummary,
  UsageTimeline,
} from "../lib/api";
import type { UsageBreakdownRow } from "../lib/api";

/** Mockup chart palette */
const CHART_HEX = ["#F0655D", "#FFF35C", "#705DF0", "#82F0C1"] as const;

function fmtPct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtDollars(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function changeToneClass(n: number): string {
  if (n > 0) return "text-amber-500";
  if (n < 0) return "text-emerald-400";
  return "text-zinc-500";
}

function TrendBadge({ pct, label }: { pct: number | null | undefined; label: string }) {
  if (pct == null || Number.isNaN(pct)) {
    return <span className="text-sm text-zinc-500">—</span>;
  }
  const up = pct >= 0;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium tabular-nums text-emerald-300 sm:text-base">
      {up ? (
        <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
        </svg>
      ) : (
        <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      )}
      <span className="whitespace-nowrap">{fmtPct(pct)}</span>
      <span className="whitespace-nowrap font-normal text-emerald-300/90">{label}</span>
    </span>
  );
}

function severityLabel(s: string): "High" | "Med" | "Low" {
  const u = s.toLowerCase();
  if (u.includes("high") || u.includes("critical")) return "High";
  if (u.includes("low")) return "Low";
  return "Med";
}

function severityBadgeClass(label: "High" | "Med" | "Low"): string {
  if (label === "High") return "bg-rose-950/70 text-rose-100 ring-1 ring-rose-800/60";
  if (label === "Low") return "bg-[#242424]/90 text-zinc-400 ring-1 ring-[#333333]";
  return "bg-amber-950/55 text-amber-200/95 ring-1 ring-amber-900/50";
}

function KpiCard({
  label,
  value,
  subline,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  subline?: React.ReactNode;
  accent: "green" | "blue";
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#2a2a2a]/90 bg-[#161617] shadow-sm">
      <div className={`h-[3px] w-full ${accent === "green" ? "bg-emerald-500" : "bg-emerald-700"}`} aria-hidden />
      <div className="px-4 pb-4 pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <div className="mt-2 text-3xl font-semibold leading-none tracking-tight text-white tabular-nums sm:text-[2rem]">
          {value}
        </div>
        {subline && <div className="mt-2.5 text-sm leading-relaxed text-zinc-500">{subline}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [scope, setScope] = useState<"me" | "team">("me");
  const [days, setDays] = useState(30);
  const [breakdownTab, setBreakdownTab] = useState<"member" | "step" | "provider" | "tool">("member");
  const [search, setSearch] = useState("");

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [breakdown, setBreakdown] = useState<DashboardUsageBreakdown | null>(null);
  const [timeline, setTimeline] = useState<UsageTimeline | null>(null);
  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const auth = token;
    let cancelled = false;

    async function load(showSpinner: boolean) {
      if (showSpinner) {
        setLoading(true);
        setError(null);
      }
      try {
        const [s, b, t, a] = await Promise.all([
          getUsageSummary(auth, days, scope),
          getUsageBreakdown(auth, days, scope),
          getUsageTimeline(auth, Math.max(days, 35), scope),
          getAgents(auth, scope),
        ]);
        if (!cancelled) {
          setSummary(s);
          setBreakdown(b);
          setTimeline(t);
          setAgents(a);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load dashboard");
        }
      } finally {
        if (!cancelled && showSpinner) setLoading(false);
      }
    }

    void load(true);
    const interval = setInterval(() => void load(false), DASHBOARD_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, days, scope]);

  /* ---- Stacked bar chart model — changes with breakdownTab ---- */
  const chartModel = useMemo(() => {
    const points = [...(timeline?.points ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const NUM_BARS = 5;
    const weekTotals: number[] = [];
    const weekLabels: string[] = [];

    if (!points.length) {
      for (let w = 0; w < NUM_BARS; w++) { weekTotals.push(0); weekLabels.push(""); }
    } else {
      const chunk = Math.max(1, Math.ceil(points.length / NUM_BARS));
      for (let w = 0; w < NUM_BARS; w++) {
        const sl = points.slice(w * chunk, (w + 1) * chunk);
        weekTotals.push(sl.reduce((s, p) => s + p.cost_usd, 0));
        // label: first date of bucket as M/D
        if (sl.length) {
          const d = new Date(sl[0].date + "T00:00:00");
          weekLabels.push(`${d.getMonth() + 1}/${d.getDate()}`);
        } else {
          weekLabels.push("");
        }
      }
    }

    let slices: { label: string; proportion: number }[] = [];
    if (breakdownTab === "member") {
      const top = [...(breakdown?.by_agent ?? [])].sort((a, b) => b.total_cost_usd - a.total_cost_usd).slice(0, 4);
      const sum = top.reduce((s, r) => s + r.total_cost_usd, 0) || 1;
      slices = top.map((r) => ({ label: r.label, proportion: r.total_cost_usd / sum }));
    } else if (breakdownTab === "step") {
      const top = [...(breakdown?.by_step ?? [])].sort((a, b) => b.total_cost_usd - a.total_cost_usd).slice(0, 4);
      const sum = top.reduce((s, r) => s + r.total_cost_usd, 0) || 1;
      slices = top.map((r) => ({ label: r.label, proportion: r.total_cost_usd / sum }));
    } else if (breakdownTab === "provider") {
      const top = [...(breakdown?.by_provider ?? [])].sort((a, b) => b.total_cost_usd - a.total_cost_usd).slice(0, 4);
      const sum = top.reduce((s, r) => s + r.total_cost_usd, 0) || 1;
      slices = top.map((r) => ({ label: r.label, proportion: r.total_cost_usd / sum }));
    } else {
      const top = [...(breakdown?.by_endpoint ?? [])].sort((a, b) => b.total_cost_usd - a.total_cost_usd).slice(0, 4);
      const sum = top.reduce((s, r) => s + r.total_cost_usd, 0) || 1;
      slices = top.map((r) => ({ label: r.label, proportion: r.total_cost_usd / sum }));
    }
    while (slices.length < 4) slices.push({ label: "—", proportion: 0 });

    return {
      weekTotals,
      weekLabels,
      props: slices.slice(0, 4).map((s) => s.proportion),
      labels: slices.slice(0, 4).map((s) => s.label),
    };
  }, [timeline, breakdown, breakdownTab]);

  const CHART_H = 160;
  const displayMax = useMemo(() => {
    let m = 1e-9;
    for (const w of chartModel.weekTotals) m = Math.max(m, w);
    const raw = Math.max(m * 1.08, 0.0001);
    // Round up to a "nice" ceiling so tick labels are clean numbers
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const steps = [1, 2, 2.5, 5, 10];
    for (const s of steps) {
      const candidate = Math.ceil(raw / (magnitude * s)) * (magnitude * s);
      if (candidate >= raw) return candidate;
    }
    return Math.ceil(raw / magnitude) * magnitude;
  }, [chartModel]);

  const yTickLabels = useMemo(() => {
    const fmt = (v: number) => {
      if (v === 0) return "$0";
      if (v >= 1000) return `$${(v / 1000).toFixed(0)}k`;
      if (v >= 100) return `$${Math.round(v)}`;
      if (v >= 10) return `$${Math.round(v)}`;
      if (v >= 1) return `$${v.toFixed(0)}`;
      if (v >= 0.01) return `$${v.toFixed(2)}`;
      return `$${v.toFixed(4)}`;
    };
    return [displayMax, displayMax * 0.75, displayMax * 0.5, displayMax * 0.25, 0].map(fmt);
  }, [displayMax]);

  // "By agent" rows come from the period-accurate breakdown, not the hardcoded 7d agent stats
  const agentBreakdownRows: UsageBreakdownRow[] = breakdown?.by_agent ?? [];
  const sortedAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...agentBreakdownRows].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
    if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q));
    return rows;
  }, [agentBreakdownRows, search]);

  const toolRows: UsageBreakdownRow[] = breakdown?.by_endpoint ?? [];
  const sortedTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...toolRows].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
    if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q));
    return rows;
  }, [toolRows, search]);

  const stepRows: UsageBreakdownRow[] = breakdown?.by_step ?? [];
  const sortedSteps = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...stepRows].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
    if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q));
    return rows;
  }, [stepRows, search]);

  const providerRows: UsageBreakdownRow[] = breakdown?.by_provider ?? [];
  const sortedProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...providerRows].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
    if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q));
    return rows;
  }, [providerRows, search]);

  const maxStepCost = Math.max(...sortedSteps.map((r) => r.total_cost_usd), 1e-9);
  const maxProviderCost = Math.max(...sortedProviders.map((r) => r.total_cost_usd), 1e-9);

  const maxMemberCost = Math.max(...sortedAgents.map((r) => r.total_cost_usd), 1e-9);
  const maxToolCost = Math.max(...sortedTools.map((r) => r.total_cost_usd), 1e-9);

  const teamAvailable = summary?.team_view_available ?? false;

  const periodLabel = `vs prev ${days}d`;

  return (
    <div className="relative mx-auto max-w-6xl px-4 py-8 pb-16 sm:px-6 lg:px-8 lg:py-10">
      {error && (
        <div className="relative mb-8 rounded-xl border border-red-500/20 bg-red-950/40 px-5 py-4 text-sm text-red-200" role="alert">
          <p className="font-medium text-red-100">Couldn&apos;t load data</p>
          <p className="mt-1 text-red-200/80">{error}</p>
        </div>
      )}

      <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-white sm:text-[1.875rem] lg:text-[2rem]">
            Spend &amp; Behavior
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-zinc-500">
            What it cost, what changed, and where your budget goes
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-600">Scope</span>
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
                title={teamAvailable ? "Organization-wide agents" : "Set organization in Settings"}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  scope === "team" ? "bg-[#242424] text-white" : "text-zinc-500 hover:text-zinc-300"
                } ${!teamAvailable ? "cursor-not-allowed opacity-40" : ""}`}
              >
                Team
              </button>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:max-w-xl lg:max-w-none lg:flex-1 lg:flex-row lg:items-center lg:justify-end lg:gap-4">
          <div className="flex w-full min-w-0 flex-1 items-stretch overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#161617] lg:max-w-md">
            <span className="flex w-11 shrink-0 items-center justify-center" style={{ background: "#0E714A" }}>
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="min-w-0 flex-1 border-0 bg-transparent py-2.5 pl-3 pr-4 text-base text-white placeholder-zinc-500 outline-none ring-0"
              aria-label="Search"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex rounded-2xl border border-[#2a2a2a] bg-[#161617] p-1">
              {([7, 14, 30] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`rounded-xl px-3 py-2 text-base font-medium transition ${
                    days === d ? "bg-[#242424] text-white" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <Link
              href="/agents/new"
              className="inline-flex items-center justify-center gap-1.5 rounded-2xl px-5 py-2.5 text-base font-semibold text-white shadow-lg transition hover:opacity-90" style={{ background: "linear-gradient(135deg, #1BA86F 0%, #0E714A 100%)" }}
            >
              + Add agent
            </Link>
          </div>
        </div>
      </div>

      {/* Hero — uses period-specific summary data */}
      <section className="mb-10 rounded-2xl border border-[#2a2a2a]/90 bg-[#161617] p-6 sm:p-9">
        {loading || !summary ? (
          <div className="space-y-4">
            <div className="h-10 w-full max-w-xl animate-pulse rounded-lg bg-[#242424]" />
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-2xl bg-[#242424]/80" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <p className="text-[1.375rem] font-medium leading-snug text-zinc-200 sm:text-[1.5rem] lg:text-[1.625rem]">
              You spent{" "}
              <span className="font-semibold tabular-nums text-white">
                ${summary.current_total_cost_usd.toFixed(2)}
              </span>{" "}
              in the last {days} days. You could save{" "}
              <span className="font-semibold tabular-nums text-emerald-400">
                ${summary.potential_savings_usd.toFixed(2)}
              </span>
              .
            </p>
            {summary.top_changes.length > 0 && (
              <p className="mt-4 text-base leading-relaxed text-zinc-500">
                Top changes across your agents, ranked by estimated monthly impact.
              </p>
            )}

            <div id="recommendations" className="mt-8 scroll-mt-28 border-t border-[#2a2a2a]/80 pt-8">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {summary.top_changes.length === 0 ? (
                  <p className="col-span-full text-base text-zinc-500">
                    No recommendations yet — add agents and usage history.
                  </p>
                ) : (
                  summary.top_changes.slice(0, 3).map((ch) => {
                    const sev = severityLabel(ch.severity);
                    return (
                      <Link
                        key={`${ch.agent_id}-${ch.type}-${ch.rank}`}
                        href={`/recommendations/${ch.type}?agent_id=${ch.agent_id}&days=${days}&scope=${scope}`}
                        className="flex flex-col rounded-2xl border border-[#2a2a2a]/80 bg-[#0d0d0e] p-5 transition hover:border-[#333333] hover:bg-[#141414]/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-lg font-semibold leading-snug text-zinc-100">
                            {String(ch.rank).padStart(2, "0")} — {ch.title}
                          </span>
                          <span
                            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${severityBadgeClass(sev)}`}
                          >
                            {sev}
                          </span>
                        </div>
                        <p className="mt-2 text-xs font-medium text-zinc-600">{ch.agent_name}</p>
                        <p className="mt-2 line-clamp-5 flex-1 text-sm leading-relaxed text-zinc-500">
                          {ch.description}
                        </p>
                        <div className="mt-5 flex items-center justify-between">
                          <p className="text-base font-semibold tabular-nums text-emerald-400">
                            Save ~${ch.estimated_savings_usd.toFixed(2)}/mo
                          </p>
                          <span className="text-xs text-zinc-600 hover:text-zinc-400">View details →</span>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Spend breakdown */}
      <div className="mb-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Spend breakdown
        </h2>
      </div>

      <section className="mb-10 rounded-2xl border border-[#2a2a2a]/90 bg-[#161617]">
        <div className="flex gap-6 border-b border-[#2a2a2a]/90 px-5 pt-4 overflow-x-auto">
          {(
            [
              { id: "member", label: "By agent" },
              { id: "step",   label: "By step" },
              { id: "provider", label: "By provider" },
              { id: "tool",   label: "By tool" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setBreakdownTab(id)}
              className={`relative shrink-0 pb-3 text-base font-medium transition ${
                breakdownTab === id
                  ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-emerald-500"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading || !timeline ? (
          <div className="h-52 animate-pulse p-6">
            <div className="h-full rounded-xl bg-[#242424]/40" />
          </div>
        ) : (
          <>
            {/* Stacked bar chart — proportions from selected tab, totals from timeline */}
            <div className="relative px-2 pb-2 pt-4 sm:px-5">
              <div className="flex gap-2">
                <div className="flex w-11 shrink-0 flex-col justify-between py-0.5 text-right text-xs font-medium tabular-nums text-zinc-500 sm:w-14">
                  {yTickLabels.map((t, i) => <span key={i}>{t}</span>)}
                </div>
                <div className="relative min-h-0 flex-1 border-l border-[#2a2a2a]/80 pl-2">
                  <div
                    className="pointer-events-none absolute inset-0 left-2 opacity-40"
                    style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 38px, rgba(63,63,70,0.5) 39px)" }}
                    aria-hidden
                  />
                  <div className="relative flex items-end justify-between gap-0.5 px-1 sm:gap-1" style={{ height: CHART_H }}>
                    {chartModel.weekTotals.map((weekTotal, wi) => (
                      <div key={wi} className="flex h-full min-h-0 flex-1 items-end justify-center gap-px sm:gap-0.5">
                        {chartModel.props.map((p, si) => {
                          const raw = weekTotal * p;
                          const h = Math.max(raw > 0 ? 3 : 0, Math.round((raw / displayMax) * CHART_H));
                          const hex = CHART_HEX[si];
                          return (
                            <div
                              key={si}
                              className="w-full max-w-[18px] rounded-t-[3px] shadow-sm ring-1 ring-black/20"
                              style={{ height: `${h}px`, backgroundColor: hex, boxShadow: hex === "#FFF35C" ? "inset 0 0 0 1px rgba(0,0,0,0.15)" : undefined }}
                              title={`${chartModel.labels[si]}: $${raw.toFixed(4)}`}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* X-axis date labels */}
              <div className="mt-2 flex pl-10 text-xs text-zinc-500 sm:pl-14">
                {chartModel.weekLabels.map((lbl, i) => (
                  <div key={i} className="flex-1 text-center">{lbl}</div>
                ))}
              </div>
              {/* Legend */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-10 sm:pl-14">
                {chartModel.labels.map((lbl, i) => lbl !== "—" ? (
                  <div key={lbl} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CHART_HEX[i] }} />
                    <span className="max-w-[140px] truncate text-xs text-zinc-400">{lbl}</span>
                  </div>
                ) : null)}
              </div>
            </div>

            {/* Rows — per-item cost share, not global pct */}
            <ul className="space-y-0 border-t border-[#2a2a2a]/90 px-3 py-4 sm:px-5">
              {breakdownTab === "member" ? (
                sortedAgents.length === 0 ? (
                  <li className="px-2 py-6 text-center text-base text-zinc-500">No agent spend data for this period.</li>
                ) : (
                  sortedAgents.slice(0, 8).map((row, i) => (
                    <li key={row.label} className="flex flex-nowrap items-center gap-3 border-b border-[#2a2a2a]/50 py-4 last:border-0 sm:gap-4">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10" style={{ backgroundColor: CHART_HEX[i % 4] }} />
                      <div className="w-36 shrink-0 min-w-0">
                        <p className="truncate text-sm font-medium text-white">{row.label}</p>
                        <p className="truncate text-xs text-zinc-500">{row.request_count.toLocaleString()} req · {(row.total_tokens / 1000).toFixed(0)}k tok</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="h-2 overflow-hidden rounded-full bg-[#242424]">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (row.total_cost_usd / maxMemberCost) * 100)}%` }} />
                        </div>
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-white">${row.total_cost_usd.toFixed(2)}</span>
                      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500">{row.share_of_cost_pct.toFixed(1)}% of total</span>
                    </li>
                  ))
                )
              ) : breakdownTab === "step" ? (
                sortedSteps.length === 0 ? (
                  <li className="px-2 py-6 text-center text-base text-zinc-500">
                    No span data yet — add <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-emerald-400">@span</code> decorators to your agent functions.
                  </li>
                ) : (
                  sortedSteps.slice(0, 8).map((row, i) => (
                    <li key={row.label} className="flex flex-nowrap items-center gap-3 border-b border-[#2a2a2a]/50 py-4 last:border-0 sm:gap-4">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10" style={{ backgroundColor: CHART_HEX[i % 4] }} />
                      <div className="w-36 shrink-0 min-w-0">
                        <p className="truncate font-mono text-sm text-white">{row.label}</p>
                        <p className="truncate text-xs text-zinc-500">{row.request_count.toLocaleString()} calls · {(row.total_tokens / 1000).toFixed(0)}k tok</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="h-2 overflow-hidden rounded-full bg-[#242424]">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (row.total_cost_usd / maxStepCost) * 100)}%` }} />
                        </div>
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-white">${row.total_cost_usd.toFixed(4)}</span>
                      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500">{row.share_of_cost_pct.toFixed(1)}% of total</span>
                    </li>
                  ))
                )
              ) : breakdownTab === "provider" ? (
                sortedProviders.length === 0 ? (
                  <li className="px-2 py-6 text-center text-base text-zinc-500">No provider data for this period.</li>
                ) : (
                  sortedProviders.slice(0, 8).map((row, i) => (
                    <li key={row.label} className="flex flex-nowrap items-center gap-3 border-b border-[#2a2a2a]/50 py-4 last:border-0 sm:gap-4">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10" style={{ backgroundColor: CHART_HEX[i % 4] }} />
                      <div className="w-36 shrink-0 min-w-0">
                        <p className="truncate capitalize text-sm font-medium text-white">{row.label}</p>
                        <p className="truncate text-xs text-zinc-500">{row.request_count.toLocaleString()} requests</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="h-2 overflow-hidden rounded-full bg-[#242424]">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (row.total_cost_usd / maxProviderCost) * 100)}%` }} />
                        </div>
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-white">${row.total_cost_usd.toFixed(2)}</span>
                      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500">{row.share_of_cost_pct.toFixed(1)}% of total</span>
                    </li>
                  ))
                )
              ) : sortedTools.length === 0 ? (
                <li className="px-2 py-6 text-center text-base text-zinc-500">No endpoint data for this period.</li>
              ) : (
                sortedTools.slice(0, 8).map((row, i) => (
                  <li key={row.label} className="flex flex-nowrap items-center gap-3 border-b border-[#2a2a2a]/50 py-4 last:border-0 sm:gap-4">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10" style={{ backgroundColor: CHART_HEX[i % 4] }} />
                    <div className="w-36 shrink-0 min-w-0">
                      <p className="truncate font-mono text-sm text-white">{row.label}</p>
                      <p className="truncate text-xs text-zinc-500">{row.request_count.toLocaleString()} requests</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-[#242424]">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (row.total_cost_usd / maxToolCost) * 100)}%` }} />
                      </div>
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-white">${row.total_cost_usd.toFixed(2)}</span>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500">{row.share_of_cost_pct.toFixed(1)}% of total</span>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </section>

      {/* KPI cards — use period-specific summary, not hardcoded 14d */}
      <section>
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500">
          At a glance — Last {days} days
        </p>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {loading || !summary ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl border border-[#2a2a2a]/80 bg-[#141414]/30" />
            ))
          ) : (
            <>
              <KpiCard
                accent="green"
                label="Total Cost"
                value={fmtDollars(summary.current_total_cost_usd)}
                subline={
                  <span>
                    <span className={`font-semibold tabular-nums ${changeToneClass(summary.cost_change_pct ?? 0)}`}>
                      {fmtPct(summary.cost_change_pct)}
                    </span>{" "}
                    {periodLabel}
                  </span>
                }
              />
              <KpiCard
                accent="blue"
                label="Avg tokens/req"
                value={summary.avg_tokens_per_request.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                subline="Larger prompts cost more"
              />
              <KpiCard
                accent="blue"
                label="Avg tool calls/req"
                value={summary.avg_tool_calls_per_request.toFixed(2)}
                subline="Tools, retrieval, sub-calls"
              />
              <KpiCard
                accent="blue"
                label="Stability"
                value={
                  <>
                    {summary.stability_score.toFixed(0)}
                    <span className="text-xl font-medium text-zinc-500">%</span>
                  </>
                }
                subline="Requests that succeeded"
              />
              <KpiCard
                accent="blue"
                label="Month to date"
                value={fmtDollars(summary.monthly_cost_usd)}
                subline={`${summary.cost_budget_utilization_pct.toFixed(0)}% of monthly budget`}
              />
            </>
          )}
        </div>
      </section>

      <p className="mt-10 text-center text-sm text-zinc-600">
        <Link href="/agents" className="text-emerald-400 hover:text-emerald-300">
          View all agents →
        </Link>
      </p>
    </div>
  );
}
