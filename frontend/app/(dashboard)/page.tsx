"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
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

function fmtPct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtChange(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function changeToneClass(n: number): string {
  if (n > 0) return "text-amber-300";
  if (n < 0) return "text-emerald-400";
  return "text-zinc-500";
}

function SectionHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-100">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-zinc-500">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function KpiCard({
  label,
  hint,
  value,
  footer,
  accent,
}: {
  label: string;
  hint?: string;
  value: React.ReactNode;
  footer?: React.ReactNode;
  accent: "violet" | "sky" | "emerald" | "teal" | "amber";
}) {
  const bar = {
    violet: "from-violet-500 to-fuchsia-500",
    sky: "from-sky-400 to-cyan-400",
    emerald: "from-emerald-400 to-teal-400",
    teal: "from-teal-400 to-cyan-500",
    amber: "from-amber-400 to-orange-400",
  }[accent];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-5 shadow-lg shadow-black/20 ring-1 ring-white/[0.04] transition hover:border-white/[0.1] hover:bg-zinc-900/55">
      <div
        className={`absolute left-0 top-0 h-1 w-full bg-gradient-to-r ${bar} opacity-90`}
        aria-hidden
      />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <div className="mt-2 text-[2rem] font-semibold leading-none tracking-tight text-white tabular-nums sm:text-[2.125rem]">
        {value}
      </div>
      {hint && (
        <p className="mt-2 text-xs leading-snug text-zinc-500">{hint}</p>
      )}
      {footer && <div className="mt-3 text-xs">{footer}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const myUserId = (session as any)?.userId as string | undefined;
  const firstName = session?.user?.name?.split(" ")[0];

  const [scope, setScope] = useState<"me" | "team">("me");
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [breakdown, setBreakdown] = useState<DashboardUsageBreakdown | null>(
    null
  );
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
      getUsageTimeline(token, Math.max(days, 14), scope),
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

  const b = summary?.behavioral;

  const maxDailyCost =
    timeline && timeline.points.length
      ? Math.max(...timeline.points.map((p) => p.cost_usd), 1e-9)
      : 1;

  const DAILY_CHART_BAR_MAX_PX = 104;
  const periodLabel =
    days === 7 ? "last week" : days === 14 ? "last 2 weeks" : "last 30 days";

  const teamAvailable = summary?.team_view_available ?? false;
  const scopeLabel =
    scope === "team" ? "Team (organization)" : "My workspace";

  return (
    <div className="relative mx-auto max-w-6xl px-4 py-8 pb-16 sm:px-6 lg:px-8 lg:py-10">
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-gradient-to-b from-violet-500/[0.07] to-transparent blur-3xl"
        aria-hidden
      />

      <header className="relative mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-violet-400/90">
            {firstName ? `Hi, ${firstName}` : "Welcome"}
          </p>
          <h1 className="mt-1 bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
            Spend & savings
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Built for small teams: see your burn, estimated savings, and where
            infrastructure spend goes — {scopeLabel}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-white/[0.08] bg-zinc-900/60 p-1 shadow-inner shadow-black/30">
            <button
              type="button"
              onClick={() => setScope("me")}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                scope === "me"
                  ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              My workspace
            </button>
            <button
              type="button"
              disabled={!teamAvailable}
              onClick={() => {
                if (teamAvailable) setScope("team");
              }}
              title={
                teamAvailable
                  ? "All agents for users in your organization"
                  : "Add a company name in Settings to enable team view"
              }
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                scope === "team"
                  ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
                  : "text-zinc-500 hover:text-zinc-300"
              } ${!teamAvailable ? "cursor-not-allowed opacity-40" : ""}`}
            >
              Team
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-900/60 p-1">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  days === d
                    ? "bg-white/10 text-white ring-1 ring-white/10"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <Link
            href="/agents/new"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-fuchsia-500"
          >
            Add agent
          </Link>
        </div>
      </header>

      {error && (
        <div
          className="relative mb-8 rounded-2xl border border-red-500/20 bg-red-950/40 px-5 py-4 text-sm text-red-200 shadow-lg shadow-red-950/20"
          role="alert"
        >
          <p className="font-medium text-red-100">Couldn&apos;t load data</p>
          <p className="mt-1 text-red-200/80">{error}</p>
        </div>
      )}

      {/* 1 — Hero: spend + savings + 3 changes (dashboard template) */}
      <section className="relative mb-12 overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-zinc-900/80 via-zinc-900/50 to-violet-950/30 p-6 shadow-2xl shadow-black/30 ring-1 ring-white/[0.05] sm:p-8">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              This month
            </p>
            {loading || !summary ? (
              <div className="mt-3 h-14 w-48 animate-pulse rounded-lg bg-zinc-800/80" />
            ) : (
              <>
                <p className="mt-2 text-4xl font-bold tracking-tight text-white tabular-nums sm:text-5xl">
                  ${summary.monthly_cost_usd.toFixed(2)}
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  {scope === "team"
                    ? "Total LLM spend for your organization this calendar month."
                    : "Your agents’ spend this calendar month."}
                </p>
                {scope === "team" && summary.team_member_count > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    {summary.team_member_count} teammate
                    {summary.team_member_count === 1 ? "" : "s"} in this org
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
                  <span className="rounded-md bg-zinc-800/80 px-2 py-1">
                    Plan: {summary.plan_tier}
                  </span>
                  <span className="rounded-md bg-zinc-800/80 px-2 py-1">
                    {summary.cost_budget_utilization_pct.toFixed(0)}% of your
                    monthly spend cap
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="border-t border-white/[0.06] pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/90">
              Estimated savings
            </p>
            {loading || !summary ? (
              <div className="mt-3 h-14 w-40 animate-pulse rounded-lg bg-zinc-800/80" />
            ) : (
              <>
                <p className="mt-2 text-4xl font-bold tracking-tight text-emerald-300 tabular-nums sm:text-5xl">
                  $
                  {summary.potential_savings_usd.toFixed(2)}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Combined from the top three optimization opportunities (same
                  engine as each agent&apos;s page). Not guaranteed savings —
                  use them as a prioritized backlog.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-8 border-t border-white/[0.06] pt-8">
          <p className="mb-4 text-sm font-semibold text-zinc-200">
            Three changes to make first
          </p>
          {loading || !summary ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-xl bg-zinc-800/50"
                />
              ))}
            </div>
          ) : summary.top_changes.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No optimization opportunities matched your traffic yet — open an
              agent to see model-specific checks, or add more history (30d
              helps).
            </p>
          ) : (
            <ol className="grid gap-4 sm:grid-cols-1 lg:grid-cols-3">
              {summary.top_changes.slice(0, 3).map((ch) => (
                <li
                  key={`${ch.agent_id}-${ch.rank}`}
                  className="flex flex-col rounded-xl border border-white/[0.08] bg-zinc-950/40 p-4 ring-1 ring-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-sm font-bold text-violet-200">
                      {ch.rank}
                    </span>
                    <span className="text-right text-xs font-semibold text-emerald-400/90 tabular-nums">
                      ~${ch.estimated_savings_usd.toFixed(0)} saved
                    </span>
                  </div>
                  <p className="mt-3 font-medium leading-snug text-zinc-100">
                    {ch.title}
                  </p>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-500">
                    {ch.description}
                  </p>
                  <p className="mt-3 text-xs text-zinc-600">
                    Agent:{" "}
                    <span className="text-zinc-400">{ch.agent_name}</span>
                  </p>
                  <Link
                    href={`/agents/${ch.agent_id}`}
                    className="mt-3 text-sm font-medium text-violet-400 hover:text-violet-300"
                  >
                    View details & full recommendations →
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* 2 — Infrastructure split */}
      <section className="relative mb-12">
        <SectionHeader
          title="Infrastructure split"
          subtitle="Where cost goes by model and by endpoint (feature tag) in the selected period."
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {(
            [
              {
                title: "By model",
                subtitle: "Provider / model — your LLM infrastructure mix",
                rows: breakdown?.by_model ?? [],
              },
              {
                title: "By endpoint",
                subtitle: "From the feature_tag on each request",
                rows: breakdown?.by_endpoint ?? [],
              },
            ] as const
          ).map((block) => (
            <div
              key={block.title}
              className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/25 shadow-lg shadow-black/15 ring-1 ring-white/[0.03]"
            >
              <div className="border-b border-white/[0.06] bg-zinc-900/40 px-5 py-4">
                <h3 className="font-semibold text-zinc-100">{block.title}</h3>
                <p className="mt-0.5 text-xs text-zinc-500">{block.subtitle}</p>
              </div>
              <div className="p-2">
                {loading || !block.rows.length ? (
                  <p className="px-3 py-10 text-center text-sm text-zinc-500">
                    {loading ? "Loading…" : "No data for this period"}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {block.rows.slice(0, 8).map((row) => (
                      <li
                        key={row.label}
                        className="rounded-lg px-3 py-2.5 transition hover:bg-white/[0.04]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`min-w-0 truncate font-mono text-xs ${
                              block.title === "By model"
                                ? "text-sky-200/90"
                                : "text-zinc-300"
                            }`}
                            title={row.label}
                          >
                            {row.label}
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-white">
                            ${row.total_cost_usd.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 opacity-90"
                              style={{
                                width: `${Math.min(100, row.share_of_cost_pct)}%`,
                              }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
                            {row.share_of_cost_pct.toFixed(0)}%
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3 — At a glance */}
      <section className="relative mb-12">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
          At a glance · {periodLabel}
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {loading || !summary ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-2xl border border-white/[0.04] bg-zinc-900/30"
              />
            ))
          ) : (
            <>
              <KpiCard
                accent="violet"
                label="Period spend"
                hint={`vs previous ${summary.period_days} days`}
                value={`$${summary.current_total_cost_usd.toFixed(2)}`}
                footer={
                  <span className="text-zinc-500">
                    Change{" "}
                    <span
                      className={`font-semibold tabular-nums ${changeToneClass(
                        summary.cost_change_pct ?? 0
                      )}`}
                    >
                      {fmtPct(summary.cost_change_pct)}
                    </span>
                  </span>
                }
              />
              <KpiCard
                accent="sky"
                label="Avg tokens / request"
                hint="Larger prompts & completions cost more"
                value={summary.avg_tokens_per_request.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              />
              <KpiCard
                accent="emerald"
                label="Tool calls / request"
                hint="Per LLM turn"
                value={summary.avg_tool_calls_per_request.toFixed(2)}
              />
              <KpiCard
                accent="teal"
                label="Stability"
                hint="Successful requests"
                value={
                  <>
                    {summary.stability_score.toFixed(0)}
                    <span className="text-xl font-medium text-zinc-500">%</span>
                  </>
                }
              />
              <KpiCard
                accent="amber"
                label="Requests in period"
                hint={`Last ${summary.period_days} days · ${scope === "team" ? "team" : "your workspace"}`}
                value={summary.request_count.toLocaleString()}
              />
            </>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
        <section className="rounded-2xl border border-white/[0.06] bg-zinc-900/25 p-6 shadow-xl shadow-black/20 ring-1 ring-white/[0.03] backdrop-blur-sm">
          <SectionHeader
            title="How behavior shifted"
            subtitle="Before vs after the same-length windows."
          />
          <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-zinc-950/40">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] bg-zinc-900/50">
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-500">
                    Metric
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-500">
                    Before
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-500">
                    After
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-500">
                    Δ
                  </th>
                </tr>
              </thead>
              <tbody className="text-zinc-200">
                {loading || !b ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-10 text-center text-zinc-500"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : (
                  <>
                    {[
                      {
                        name: "Tokens / request",
                        b: b.avg_tokens_before.toFixed(0),
                        a: b.avg_tokens_after.toFixed(0),
                        ch: b.tokens_pct_change,
                      },
                      {
                        name: "Tool calls / request",
                        b: b.avg_tool_calls_before.toFixed(2),
                        a: b.avg_tool_calls_after.toFixed(2),
                        ch: b.tool_calls_pct_change,
                      },
                      {
                        name: "Latency",
                        b: `${b.avg_latency_ms_before.toFixed(0)} ms`,
                        a: `${b.avg_latency_ms_after.toFixed(0)} ms`,
                        ch: b.latency_pct_change,
                      },
                      {
                        name: "Cost / request",
                        b: `$${b.cost_per_request_before.toFixed(4)}`,
                        a: `$${b.cost_per_request_after.toFixed(4)}`,
                        ch: b.cost_per_request_pct_change,
                      },
                    ].map((row, i) => (
                      <tr
                        key={row.name}
                        className={`border-b border-white/[0.04] last:border-0 ${
                          i % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]"
                        }`}
                      >
                        <td className="px-4 py-3.5 font-medium text-zinc-300">
                          {row.name}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                          {row.b}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-white">
                          {row.a}
                        </td>
                        <td
                          className={`px-4 py-3.5 font-semibold tabular-nums ${changeToneClass(
                            row.ch
                          )}`}
                        >
                          {fmtChange(row.ch)}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
          {!loading && b && (
            <p className="mt-3 text-center text-xs text-zinc-600">
              {b.before_period_label} → {b.after_period_label}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-white/[0.06] bg-zinc-900/25 p-6 shadow-xl shadow-black/20 ring-1 ring-white/[0.03] backdrop-blur-sm">
          <SectionHeader
            title="Insights & alerts"
            subtitle="Includes the same optimization signals as agent pages, plus trend notes."
          />
          <ul className="space-y-3">
            {loading || !summary ? (
              <li className="rounded-xl border border-white/[0.04] bg-zinc-950/30 px-4 py-8 text-center text-sm text-zinc-500">
                Loading…
              </li>
            ) : summary.insights.length === 0 ? (
              <li className="rounded-xl border border-dashed border-zinc-700/60 bg-zinc-950/20 px-4 py-8 text-center text-sm text-zinc-500">
                Nothing to report for this window.
              </li>
            ) : (
              summary.insights.map((line, i) => (
                <li
                  key={i}
                  className="flex gap-3 rounded-xl border border-white/[0.06] bg-gradient-to-r from-violet-500/[0.06] to-transparent px-4 py-3.5 text-sm leading-relaxed text-zinc-200"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-xs font-bold text-violet-300"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <span>{line}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <section className="relative mt-12 rounded-2xl border border-white/[0.06] bg-zinc-900/25 p-6 shadow-xl shadow-black/20 ring-1 ring-white/[0.03] backdrop-blur-sm">
        <SectionHeader
          title="Daily spend"
          subtitle="Bar height = that day’s cost vs the busiest day. Hover for amount."
        />
        {loading || !timeline?.points.length ? (
          <div className="h-28 animate-pulse rounded-xl bg-zinc-950/40" />
        ) : (
          <div className="rounded-xl border border-white/[0.06] bg-zinc-950/50 p-4">
            <div className="mb-2 flex justify-between text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              <span>{timeline.points[0]?.date}</span>
              <span>{timeline.points[timeline.points.length - 1]?.date}</span>
            </div>
            <div className="flex h-28 items-end gap-0.5 sm:gap-1">
              {timeline.points.map((p) => {
                const barPx = Math.max(
                  4,
                  Math.round((p.cost_usd / maxDailyCost) * DAILY_CHART_BAR_MAX_PX)
                );
                return (
                  <div
                    key={p.date}
                    className="group relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-end"
                  >
                    <div
                      className="w-full max-w-[12px] shrink-0 rounded-t-md bg-gradient-to-t from-violet-600 via-violet-400 to-fuchsia-400/90 opacity-95 shadow-sm shadow-violet-900/40 transition group-hover:opacity-100 sm:max-w-[14px]"
                      style={{ height: `${barPx}px` }}
                      title={`${p.date}: $${p.cost_usd.toFixed(2)}`}
                    />
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-200 opacity-0 shadow-xl transition group-hover:opacity-100">
                      {p.date}
                      <br />
                      <span className="text-violet-300">
                        ${p.cost_usd.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="relative mt-14 border-t border-white/[0.06] pt-12">
        <SectionHeader title="Your agents">
          <Link
            href="/agents"
            className="text-sm font-medium text-violet-400 hover:text-violet-300"
          >
            View all →
          </Link>
        </SectionHeader>
        {loading ? (
          <div className="h-28 animate-pulse rounded-2xl bg-zinc-900/30" />
        ) : agents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700/70 bg-zinc-900/20 px-6 py-12 text-center">
            <p className="text-sm text-zinc-400">
              No agents yet — register one to attribute spend.
            </p>
            <Link
              href="/agents/new"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/[0.14]"
            >
              Register agent
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.slice(0, 6).map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="group flex gap-4 rounded-2xl border border-white/[0.06] bg-zinc-900/30 p-4 shadow-md shadow-black/10 ring-1 ring-white/[0.03] transition hover:border-violet-500/25 hover:bg-zinc-900/50"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/30 to-fuchsia-600/20 text-lg font-bold text-violet-200">
                  {agent.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-zinc-100 group-hover:text-white">
                      {agent.name}
                    </p>
                    {scope === "team" &&
                      myUserId &&
                      agent.user_id !== myUserId && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                          Teammate
                        </span>
                      )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                    {agent.model}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Last 7 days:{" "}
                    <span className="font-semibold tabular-nums text-zinc-200">
                      ${agent.total_cost_7d.toFixed(2)}
                    </span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
