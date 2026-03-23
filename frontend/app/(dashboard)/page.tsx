"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
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
    <span className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium tabular-nums text-orange-300 sm:text-base">
      {up ? (
        <svg className="h-4 w-4 shrink-0 text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
        </svg>
      ) : (
        <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      )}
      <span className="whitespace-nowrap">{fmtPct(pct)}</span>
      <span className="whitespace-nowrap font-normal text-orange-300/90">{label}</span>
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
  if (label === "Low") return "bg-zinc-800/90 text-zinc-400 ring-1 ring-zinc-700";
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
  accent: "orange" | "blue";
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] shadow-sm">
      <div className={`h-[3px] w-full ${accent === "orange" ? "bg-amber-500" : "bg-blue-500"}`} aria-hidden />
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
  const [breakdownTab, setBreakdownTab] = useState<"member" | "tool">("member");
  const [search, setSearch] = useState("");

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [breakdown, setBreakdown] = useState<DashboardUsageBreakdown | null>(null);
  const [timeline, setTimeline] = useState<UsageTimeline | null>(null);
  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getUsageSummary(token, days, scope),
      getUsageBreakdown(token, days, scope),
      getUsageTimeline(token, Math.max(days, 35), scope),
      getAgents(token, scope),
    ])
      .then(([s, b, t, a]) => {
        setSummary(s);
        setBreakdown(b);
        setTimeline(t);
        setAgents(a);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, days, scope]);

  /* ---- Chart model: changes with breakdownTab ---- */
  const chartModel = useMemo(() => {
    const points = timeline?.points ?? [];
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const numWeeks = 5;
    const weekTotals: number[] = [];
    if (!sorted.length) {
      for (let w = 0; w < numWeeks; w++) weekTotals.push(0);
    } else {
      const chunk = Math.max(1, Math.ceil(sorted.length / numWeeks));
      for (let w = 0; w < numWeeks; w++) {
        const sl = sorted.slice(w * chunk, (w + 1) * chunk);
        weekTotals.push(sl.reduce((s, p) => s + p.cost_usd, 0));
      }
    }

    let slices: { label: string; proportion: number }[];

    if (breakdownTab === "member") {
      // Proportions from top 4 agents by 7d cost
      const top = [...agents].sort((a, b) => b.total_cost_7d - a.total_cost_7d).slice(0, 4);
      const sumCost = top.reduce((s, a) => s + a.total_cost_7d, 0) || 1;
      slices = top.map((a) => ({ label: a.name, proportion: a.total_cost_7d / sumCost }));
    } else {
      // Proportions from top 4 tools/endpoints by cost
      const tools = [...(breakdown?.by_endpoint ?? [])].sort((a, b) => b.total_cost_usd - a.total_cost_usd).slice(0, 4);
      const sumCost = tools.reduce((s, t) => s + t.total_cost_usd, 0) || 1;
      slices = tools.map((t) => ({ label: t.label, proportion: t.total_cost_usd / sumCost }));
    }

    while (slices.length < 4) slices.push({ label: "—", proportion: 0 });

    return {
      weekTotals,
      props: slices.slice(0, 4).map((s) => s.proportion),
      labels: slices.slice(0, 4).map((s) => s.label),
    };
  }, [timeline, agents, breakdown, breakdownTab]);

  const maxBarVal = useMemo(() => {
    let m = 1e-9;
    for (const w of chartModel.weekTotals) {
      for (let i = 0; i < 4; i++) {
        m = Math.max(m, w * chartModel.props[i]);
      }
    }
    return m;
  }, [chartModel]);

  const displayMax = Math.max(100, maxBarVal * 1.08);
  const CHART_H = 160;

  const sortedAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = [...agents].sort((a, b) => b.total_cost_7d - a.total_cost_7d);
    if (q) {
      list = list.filter(
        (a) => a.name.toLowerCase().includes(q) || a.purpose.toLowerCase().includes(q)
      );
    }
    return list;
  }, [agents, search]);

  const toolRows: UsageBreakdownRow[] = breakdown?.by_endpoint ?? [];
  const sortedTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...toolRows].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
    if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q));
    return rows;
  }, [toolRows, search]);

  const topFourAgents = useMemo(
    () => [...agents].sort((a, b) => b.total_cost_7d - a.total_cost_7d).slice(0, 4),
    [agents]
  );

  const maxMemberCost = Math.max(...sortedAgents.map((a) => a.total_cost_7d), 1e-9);
  const maxToolCost = Math.max(...sortedTools.map((r) => r.total_cost_usd), 1e-9);

  const teamAvailable = summary?.team_view_available ?? false;

  const yTickLabels = useMemo(() => {
    const n = displayMax;
    return [n, n * 0.75, n * 0.5, n * 0.25, 0].map((v) =>
      v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(0)}`
    );
  }, [displayMax]);

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
            <div className="inline-flex rounded-full border border-zinc-800 bg-[#1c1c1c] p-0.5">
              <button
                type="button"
                onClick={() => setScope("me")}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  scope === "me" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
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
                  scope === "team" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
                } ${!teamAvailable ? "cursor-not-allowed opacity-40" : ""}`}
              >
                Team
              </button>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:max-w-xl lg:max-w-none lg:flex-1 lg:flex-row lg:items-center lg:justify-end lg:gap-4">
          <div className="flex w-full min-w-0 flex-1 items-stretch overflow-hidden rounded-2xl border border-zinc-800 bg-[#1c1c1c] lg:max-w-md">
            <span className="flex w-11 shrink-0 items-center justify-center bg-sky-500">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search here..."
              className="min-w-0 flex-1 border-0 bg-transparent py-2.5 pl-3 pr-4 text-base text-white placeholder-zinc-500 outline-none ring-0"
              aria-label="Search"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex rounded-2xl border border-zinc-800 bg-[#1c1c1c] p-1">
              {([7, 14, 30] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`rounded-xl px-3 py-2 text-base font-medium transition ${
                    days === d ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <Link
              href="/agents/new"
              className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-orange-400 via-orange-500 to-red-600 px-5 py-2.5 text-base font-semibold text-white shadow-lg shadow-orange-950/25 transition hover:from-orange-300 hover:to-red-500"
            >
              + Add agent
            </Link>
          </div>
        </div>
      </div>

      {/* Hero — uses period-specific summary data */}
      <section className="mb-10 rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-6 sm:p-9">
        {loading || !summary ? (
          <div className="space-y-4">
            <div className="h-10 w-full max-w-xl animate-pulse rounded-lg bg-zinc-800" />
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-2xl bg-zinc-800/80" />
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
              <span className="font-semibold tabular-nums text-orange-400">
                ${summary.potential_savings_usd.toFixed(2)}
              </span>
              .
            </p>
            {summary.top_changes.length > 0 && (
              <p className="mt-4 text-base leading-relaxed text-zinc-500">
                Top changes across your agents, ranked by estimated monthly impact.
              </p>
            )}

            <div id="recommendations" className="mt-8 scroll-mt-28 border-t border-zinc-800/80 pt-8">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {summary.top_changes.length === 0 ? (
                  <p className="col-span-full text-base text-zinc-500">
                    No recommendations yet — add agents and usage history.
                  </p>
                ) : (
                  summary.top_changes.slice(0, 3).map((ch) => {
                    const sev = severityLabel(ch.severity);
                    return (
                      <div
                        key={`${ch.agent_id}-${ch.type}-${ch.rank}`}
                        className="flex flex-col rounded-2xl border border-zinc-800/80 bg-[#121212] p-5"
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
                        <p className="mt-5 text-base font-semibold tabular-nums text-orange-400">
                          Save ~${ch.estimated_savings_usd.toFixed(2)}/mo
                        </p>
                      </div>
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

      <section className="mb-10 rounded-2xl border border-zinc-800/90 bg-[#1c1c1c]">
        <div className="flex gap-8 border-b border-zinc-800/90 px-5 pt-4">
          <button
            type="button"
            onClick={() => setBreakdownTab("member")}
            className={`relative pb-3 text-base font-medium transition ${
              breakdownTab === "member"
                ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-orange-500"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            By agent
          </button>
          <button
            type="button"
            onClick={() => setBreakdownTab("tool")}
            className={`relative pb-3 text-base font-medium transition ${
              breakdownTab === "tool"
                ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-orange-500"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            By tool / feature
          </button>
        </div>

        {loading || !timeline ? (
          <div className="h-52 animate-pulse p-6">
            <div className="h-full rounded-xl bg-zinc-800/40" />
          </div>
        ) : (
          <>
            {/* Stacked bar chart — changes with breakdownTab */}
            <div className="relative px-2 pb-2 pt-4 sm:px-5">
              <div className="flex gap-2">
                <div className="flex w-11 flex-col justify-between py-0.5 text-right text-xs font-medium tabular-nums text-zinc-500 sm:w-12 sm:text-sm">
                  {yTickLabels.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="relative min-h-0 flex-1 border-l border-zinc-800/80 pl-2">
                  <div
                    className="pointer-events-none absolute inset-0 left-2 opacity-40"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(to bottom, transparent 0, transparent 38px, rgba(63,63,70,0.5) 39px)",
                    }}
                    aria-hidden
                  />
                  <div
                    className="relative flex items-end justify-between gap-0.5 px-1 sm:gap-1"
                    style={{ height: CHART_H }}
                  >
                    {chartModel.weekTotals.map((weekTotal, wi) => (
                      <div
                        key={wi}
                        className="flex h-full min-h-0 flex-1 items-end justify-center gap-px sm:gap-0.5"
                      >
                        {chartModel.props.map((p, si) => {
                          const raw = weekTotal * p;
                          const h = Math.max(3, Math.round((raw / displayMax) * CHART_H));
                          const hex = CHART_HEX[si];
                          return (
                            <div
                              key={si}
                              className="w-full max-w-[18px] rounded-t-[3px] shadow-sm ring-1 ring-black/20"
                              style={{
                                height: `${h}px`,
                                backgroundColor: hex,
                                boxShadow: hex === "#FFF35C" ? "inset 0 0 0 1px rgba(0,0,0,0.15)" : undefined,
                              }}
                              title={`${chartModel.labels[si]}: $${raw.toFixed(2)}`}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Legend */}
              <div className="mt-3 flex flex-wrap items-center gap-4 pl-14">
                {chartModel.labels.map((lbl, i) =>
                  lbl !== "—" ? (
                    <div key={lbl} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_HEX[i] }} />
                      <span className="text-xs text-zinc-400">{lbl}</span>
                    </div>
                  ) : null
                )}
              </div>
              <div className="mt-2 flex pl-10 text-xs font-medium text-zinc-500 sm:pl-14 sm:text-sm">
                {["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"].map((w) => (
                  <div key={w} className="flex-1 text-center">{w}</div>
                ))}
              </div>
            </div>

            {/* Rows — per-item cost share, not global pct */}
            <ul className="space-y-0 border-t border-zinc-800/90 px-3 py-4 sm:px-5">
              {breakdownTab === "member" ? (
                sortedAgents.length === 0 ? (
                  <li className="px-2 py-6 text-center text-base text-zinc-500">
                    No agents for this scope.
                  </li>
                ) : (
                  sortedAgents.slice(0, 8).map((a, i) => {
                    const topIdx = topFourAgents.findIndex((x) => x.id === a.id);
                    const colorIdx = topIdx >= 0 ? topIdx % 4 : i % 4;
                    const dot = CHART_HEX[colorIdx];
                    const totalCost = agents.reduce((s, x) => s + x.total_cost_7d, 0) || 1;
                    const share = (a.total_cost_7d / totalCost) * 100;
                    return (
                      <li
                        key={a.id}
                        className="flex flex-col gap-3 border-b border-zinc-800/50 py-4 last:border-0 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-4"
                      >
                        <div className="flex min-w-0 items-start gap-3 sm:w-48 sm:shrink-0">
                          <span
                            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10"
                            style={{ backgroundColor: dot }}
                          />
                          <div className="min-w-0">
                            <p className="text-base font-medium text-white">{a.name}</p>
                            <p className="text-sm text-zinc-500">{a.purpose || "Agent"}</p>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1 px-0 sm:px-2">
                          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${Math.min(100, (a.total_cost_7d / maxMemberCost) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex w-full shrink-0 flex-col items-end gap-1.5 sm:w-auto sm:min-w-[10rem] sm:flex-row sm:items-center sm:justify-end sm:gap-4">
                          <span className="text-base font-semibold tabular-nums text-white">
                            ${a.total_cost_7d.toFixed(2)}
                          </span>
                          <span className="text-sm tabular-nums text-zinc-500">
                            {share.toFixed(1)}% of total
                          </span>
                        </div>
                      </li>
                    );
                  })
                )
              ) : sortedTools.length === 0 ? (
                <li className="px-2 py-6 text-center text-base text-zinc-500">
                  No endpoint data for this period.
                </li>
              ) : (
                sortedTools.slice(0, 8).map((row, i) => (
                  <li
                    key={row.label}
                    className="flex flex-col gap-3 border-b border-zinc-800/50 py-4 last:border-0 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-4"
                  >
                    <div className="flex min-w-0 items-start gap-3 sm:w-48 sm:shrink-0">
                      <span
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10"
                        style={{ backgroundColor: CHART_HEX[i % 4] }}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-mono text-base text-white">{row.label}</p>
                        <p className="text-sm text-zinc-500">{row.request_count.toLocaleString()} requests</p>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 px-0 sm:px-2">
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.min(100, (row.total_cost_usd / maxToolCost) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex w-full shrink-0 flex-col items-end gap-1.5 sm:w-auto sm:min-w-[10rem] sm:flex-row sm:items-center sm:justify-end sm:gap-4">
                      <span className="text-base font-semibold tabular-nums text-white">
                        ${row.total_cost_usd.toFixed(2)}
                      </span>
                      <span className="text-sm tabular-nums text-zinc-500">
                        {row.share_of_cost_pct.toFixed(1)}% of total
                      </span>
                    </div>
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
              <div key={i} className="h-36 animate-pulse rounded-2xl border border-zinc-800/80 bg-zinc-900/30" />
            ))
          ) : (
            <>
              <KpiCard
                accent="orange"
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
        <Link href="/agents" className="text-orange-400 hover:text-orange-300">
          View all agents →
        </Link>
      </p>
    </div>
  );
}
