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

/** Design-system chart palette */
const CHART_HEX = ["#1BA86F", "#2DD4BF", "#60A5FA", "#A3E635"] as const;

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

function severityColor(label: "High" | "Med" | "Low"): string {
  if (label === "High") return "#F87171";
  if (label === "Low") return "#9999A8";
  return "#FBBF24";
}

function severityLabel(s: string): "High" | "Med" | "Low" {
  const u = s.toLowerCase();
  if (u.includes("high") || u.includes("critical")) return "High";
  if (u.includes("low")) return "Low";
  return "Med";
}

function KpiCard({
  label,
  value,
  subline,
}: {
  label: string;
  value: React.ReactNode;
  subline?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "#262628", border: "1px solid #333336" }}
    >
      <p className="text-xs font-medium" style={{ color: "#9999A8" }}>{label}</p>
      <div className="mt-2 text-2xl font-bold leading-none text-white tabular-nums">
        {value}
      </div>
      {subline && (
        <div className="mt-1.5 text-xs leading-relaxed" style={{ color: "#9999A8" }}>
          {subline}
        </div>
      )}
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
      if (showSpinner) { setLoading(true); setError(null); }
      try {
        const [s, b, t, a] = await Promise.all([
          getUsageSummary(auth, days, scope),
          getUsageBreakdown(auth, days, scope),
          getUsageTimeline(auth, Math.max(days, 35), scope),
          getAgents(auth, scope),
        ]);
        if (!cancelled) { setSummary(s); setBreakdown(b); setTimeline(t); setAgents(a); }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (!cancelled && showSpinner) setLoading(false);
      }
    }

    void load(true);
    const interval = setInterval(() => void load(false), DASHBOARD_REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token, days, scope]);

  const chartModel = useMemo(() => {
    const points = [...(timeline?.points ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const NUM_BARS = 5;
    const weekTotals: number[] = [];
    const weekLabels: string[] = [];

    if (!points.length) {
      for (let w = 0; w < NUM_BARS; w++) { weekTotals.push(0); weekLabels.push(`Week ${w + 1}`); }
    } else {
      const chunk = Math.max(1, Math.ceil(points.length / NUM_BARS));
      for (let w = 0; w < NUM_BARS; w++) {
        const sl = points.slice(w * chunk, (w + 1) * chunk);
        weekTotals.push(sl.reduce((s, p) => s + p.cost_usd, 0));
        if (sl.length) {
          const d = new Date(sl[0].date + "T00:00:00");
          weekLabels.push(`${d.getMonth() + 1}/${d.getDate()}`);
        } else {
          weekLabels.push(`Week ${w + 1}`);
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

  const CHART_H = 140;

  const displayMax = useMemo(() => {
    let m = 1e-9;
    for (const w of chartModel.weekTotals) m = Math.max(m, w);
    const raw = Math.max(m * 1.08, 0.0001);
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
      if (v >= 1) return `$${Math.round(v)}`;
      if (v >= 0.01) return `$${v.toFixed(2)}`;
      return `$${v.toFixed(4)}`;
    };
    return [displayMax, displayMax * 0.75, displayMax * 0.5, displayMax * 0.25, 0].map(fmt);
  }, [displayMax]);

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

  const maxMemberCost = Math.max(...sortedAgents.map((r) => r.total_cost_usd), 1e-9);
  const maxToolCost   = Math.max(...sortedTools.map((r) => r.total_cost_usd), 1e-9);
  const maxStepCost   = Math.max(...sortedSteps.map((r) => r.total_cost_usd), 1e-9);
  const maxProviderCost = Math.max(...sortedProviders.map((r) => r.total_cost_usd), 1e-9);
  const teamAvailable = summary?.team_view_available ?? false;

  const TABS = [
    { id: "member"   as const, label: "By team member" },
    { id: "tool"     as const, label: "By tool spend"  },
    { id: "step"     as const, label: "By step"        },
    { id: "provider" as const, label: "By provider"    },
  ];

  return (
    <div className="px-8 py-7 pb-16 max-w-5xl">
      {error && (
        <div className="mb-6 rounded-xl p-4 text-sm text-red-300" style={{ background: "#2A1515", border: "1px solid #4A2020" }}>
          {error}
        </div>
      )}

      {/* Page header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ letterSpacing: "-0.02em" }}>
            Spend &amp; Behavior
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "#9999A8" }}>
            What it cost, what changed, and where your budget goes
          </p>
        </div>
        {/* Period + scope controls */}
        <div className="flex items-center gap-2">
          {teamAvailable && (
            <div className="flex rounded-lg p-0.5" style={{ background: "#262628", border: "1px solid #333336" }}>
              {(["me", "team"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setScope(s)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium transition"
                  style={{ background: scope === s ? "#333336" : "transparent", color: scope === s ? "#fff" : "#9999A8" }}>
                  {s === "me" ? "My workspace" : "Team"}
                </button>
              ))}
            </div>
          )}
          <div className="flex rounded-lg p-0.5" style={{ background: "#262628", border: "1px solid #333336" }}>
            {([7, 14, 30] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className="rounded-md px-3 py-1.5 text-xs font-medium transition"
                style={{ background: days === d ? "#333336" : "transparent", color: days === d ? "#fff" : "#9999A8" }}>
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Savings hero */}
      {loading || !summary ? (
        <div className="mb-6 space-y-3">
          <div className="h-7 w-80 animate-pulse rounded-lg" style={{ background: "#262628" }} />
          <div className="h-12 w-64 animate-pulse rounded-lg" style={{ background: "#262628" }} />
          <div className="h-4 w-72 animate-pulse rounded-lg" style={{ background: "#262628" }} />
        </div>
      ) : (
        <div className="mb-6">
          <p className="text-lg font-medium text-white">
            You spent{" "}
            <span className="font-bold tabular-nums">${summary.current_total_cost_usd.toFixed(2)}</span>{" "}
            the last month.
          </p>
          <p className="mt-0.5 text-[2.25rem] font-bold leading-none tabular-nums" style={{ color: "#B8F4C8" }}>
            You could save ${summary.potential_savings_usd.toFixed(2)}.
          </p>
          {summary.top_changes.length > 0 && (
            <p className="mt-2 text-sm" style={{ color: "#9999A8" }}>
              {summary.top_changes.length} changes across your agents, ranked by estimated monthly impact.
            </p>
          )}
        </div>
      )}

      {/* Recommendation cards */}
      {!loading && summary && summary.top_changes.length > 0 && (
        <div className="mb-8 grid grid-cols-3 gap-3">
          {summary.top_changes.slice(0, 3).map((ch) => {
            const sev = severityLabel(ch.severity);
            return (
              <Link
                key={`${ch.agent_id}-${ch.type}-${ch.rank}`}
                href={`/recommendations/${ch.type}?agent_id=${ch.agent_id}&days=${days}&scope=${scope}`}
                className="flex flex-col rounded-xl p-4 transition hover:opacity-90"
                style={{ background: "#262628", border: "1px solid #333336" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-white leading-snug">
                    {String(ch.rank).padStart(2, "0")}. {ch.title}
                  </span>
                  <span className="shrink-0 text-xs font-semibold" style={{ color: severityColor(sev) }}>
                    {sev}
                  </span>
                </div>
                <p className="mt-1 text-xs" style={{ color: "#666670" }}>{ch.agent_name}</p>
                <p className="mt-2 line-clamp-4 flex-1 text-xs leading-relaxed" style={{ color: "#9999A8" }}>
                  {ch.description}
                </p>
                <p className="mt-4 text-sm font-semibold tabular-nums" style={{ color: "#1BA86F" }}>
                  Save ~${ch.estimated_savings_usd.toFixed(2)}/mo
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {/* Spend Breakdown */}
      <p className="mb-2 text-sm font-medium text-white">Spend Breakdown</p>
      <section className="mb-8 rounded-xl overflow-hidden" style={{ background: "#262628", border: "1px solid #333336" }}>
        {/* Tabs */}
        <div className="flex gap-0 overflow-x-auto" style={{ borderBottom: "1px solid #333336" }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setBreakdownTab(id)}
              className="relative shrink-0 px-5 py-3 text-sm font-medium transition"
              style={{
                color: breakdownTab === id ? "#ffffff" : "#9999A8",
                borderBottom: breakdownTab === id ? "2px solid #1BA86F" : "2px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {loading || !timeline ? (
          <div className="h-48 animate-pulse m-5 rounded-lg" style={{ background: "#333336" }} />
        ) : (
          <>
            {/* Chart */}
            <div className="px-5 pt-5 pb-2">
              <div className="flex gap-2">
                {/* Y-axis */}
                <div className="flex w-10 shrink-0 flex-col justify-between pb-0.5 text-right text-[11px] tabular-nums" style={{ color: "#666670" }}>
                  {yTickLabels.map((t, i) => <span key={i}>{t}</span>)}
                </div>
                {/* Bars */}
                <div className="relative flex-1" style={{ borderLeft: "1px solid #333336" }}>
                  <div
                    className="pointer-events-none absolute inset-0 left-0"
                    style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent calc(25% - 0.5px), #333336 calc(25% - 0.5px), #333336 25%)" }}
                    aria-hidden
                  />
                  <div className="relative flex items-end justify-between gap-1 px-2" style={{ height: CHART_H }}>
                    {chartModel.weekTotals.map((weekTotal, wi) => (
                      <div key={wi} className="flex h-full flex-1 items-end justify-center gap-[2px]">
                        {chartModel.props.map((p, si) => {
                          const raw = weekTotal * p;
                          const h = Math.max(raw > 0 ? 3 : 0, Math.round((raw / displayMax) * CHART_H));
                          return (
                            <div
                              key={si}
                              className="w-full max-w-[10px] rounded-t-sm"
                              style={{ height: `${h}px`, backgroundColor: CHART_HEX[si] }}
                              title={`${chartModel.labels[si]}: $${raw.toFixed(4)}`}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* X-axis */}
              <div className="mt-2 flex pl-12 text-[11px]" style={{ color: "#666670" }}>
                {chartModel.weekLabels.map((lbl, i) => (
                  <div key={i} className="flex-1 text-center">{lbl}</div>
                ))}
              </div>
              {/* Legend */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 pl-12">
                {chartModel.labels.map((lbl, i) => lbl !== "—" ? (
                  <div key={lbl} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CHART_HEX[i] }} />
                    <span className="text-[11px] truncate max-w-[120px]" style={{ color: "#9999A8" }}>{lbl}</span>
                  </div>
                ) : null)}
              </div>
            </div>

            {/* Breakdown rows */}
            <ul className="mt-2 divide-y" style={{ borderTop: "1px solid #333336", ['--tw-divide-opacity' as any]: 1 }}>
              {(() => {
                let rows: UsageBreakdownRow[] = [];
                let maxCost = 1e-9;
                if (breakdownTab === "member") { rows = sortedAgents; maxCost = maxMemberCost; }
                else if (breakdownTab === "step") { rows = sortedSteps; maxCost = maxStepCost; }
                else if (breakdownTab === "provider") { rows = sortedProviders; maxCost = maxProviderCost; }
                else { rows = sortedTools; maxCost = maxToolCost; }

                if (rows.length === 0) {
                  return (
                    <li className="py-6 text-center text-sm" style={{ color: "#9999A8" }}>
                      No data for this period.
                    </li>
                  );
                }
                return rows.slice(0, 6).map((row, i) => (
                  <li key={row.label} className="flex items-center gap-3 px-5 py-3.5" style={{ borderColor: "#333336" }}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_HEX[i % 4] }} />
                    <div className="w-32 shrink-0 min-w-0">
                      <p className="truncate text-sm font-medium text-white">{row.label}</p>
                      <p className="truncate text-xs" style={{ color: "#666670" }}>
                        {row.request_count.toLocaleString()} req
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "#333336" }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, (row.total_cost_usd / maxCost) * 100)}%`, background: "#1BA86F" }}
                        />
                      </div>
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-white">
                      ${row.total_cost_usd.toFixed(2)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums" style={{ color: "#666670" }}>
                      {row.share_of_cost_pct.toFixed(1)}%
                    </span>
                  </li>
                ));
              })()}
            </ul>
          </>
        )}
      </section>

      {/* At a glance */}
      <p className="mb-3 text-xs font-medium uppercase tracking-widest" style={{ color: "#9999A8" }}>
        At a glance: Last {days} days
      </p>
      <div className="grid grid-cols-5 gap-3">
        {loading || !summary ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl" style={{ background: "#262628" }} />
          ))
        ) : (
          <>
            <KpiCard
              label="Total Cost"
              value={fmtDollars(summary.current_total_cost_usd)}
              subline={
                <span style={{ color: (summary.cost_change_pct ?? 0) < 0 ? "#1BA86F" : "#F87171" }}>
                  {fmtPct(summary.cost_change_pct)} vs prev {days}d
                </span>
              }
            />
            <KpiCard
              label="Avg tokens/req"
              value={summary.avg_tokens_per_request.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              subline="Larger prompts cost more"
            />
            <KpiCard
              label="Avg tool calls/req"
              value={summary.avg_tool_calls_per_request.toFixed(2)}
              subline="Tools, retrieval, sub-calls"
            />
            <KpiCard
              label="Stability"
              value={<>{summary.stability_score.toFixed(0)}<span className="text-base font-medium" style={{ color: "#9999A8" }}>%</span></>}
              subline="Requests that succeeded"
            />
            <KpiCard
              label="Month to date"
              value={fmtDollars(summary.monthly_cost_usd)}
              subline={`${summary.cost_budget_utilization_pct.toFixed(0)}% of monthly budget`}
            />
          </>
        )}
      </div>

      <p className="mt-8 text-sm" style={{ color: "#666670" }}>
        <Link href="/agents" className="transition hover:opacity-80" style={{ color: "#1BA86F" }}>
          View all agents →
        </Link>
      </p>
    </div>
  );
}
