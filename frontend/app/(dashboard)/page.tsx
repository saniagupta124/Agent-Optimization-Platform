"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  getUsageSummary, getUsageBreakdown, getUsageTimeline,
  type UsageSummary, type DashboardUsageBreakdown, type UsageBreakdownRow, type TimelinePoint,
} from "../lib/api";
import { mapToRec } from "../lib/mapToRec";
import type { Rec } from "../lib/rec-types";
import { DecisionCardCompact } from "../components/DecisionCard";

const ROW_COLORS = ["#34D399","#A3E635","#60A5FA","#FBBF24","#C084FC","#2DD4BF"];

// ── Grouped bar chart ───────────────────────────────────────────
interface WeekBar { label: string; cost: number }
interface ChartSeries { label: string; share: number; color: string; totalCost: number }

const CHART_H = 160; // px — bar column height

function yLabel(v: number) {
  if (v === 0) return "$0";
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
}

function SpendBarChart({ weeks, series }: { weeks: WeekBar[]; series: ChartSeries[] }) {
  const n       = Math.min(series.length, 4);
  const maxCost = Math.max(...weeks.map((w) => w.cost), 0.001);
  const ticks   = [1, 0.75, 0.5, 0.25, 0];

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
      {/* Y-axis labels */}
      <div style={{ width: 44, flexShrink: 0, display: "flex", flexDirection: "column",
        justifyContent: "space-between", paddingBottom: 28 }}>
        {ticks.map((t) => (
          <div key={t} style={{ fontSize: 10, color: "rgba(255,255,255,0.3)",
            textAlign: "right", paddingRight: 8, lineHeight: 1 }}>
            {yLabel(maxCost * t)}
          </div>
        ))}
      </div>

      {/* Chart body */}
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {/* Horizontal gridlines */}
        {ticks.map((t) => (
          <div key={t} style={{
            position: "absolute", left: 0, right: 0,
            top: (1 - t) * CHART_H,
            height: 1,
            background: t === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
          }} />
        ))}

        {/* Week groups */}
        <div style={{ display: "flex", height: CHART_H + 28 }}>
          {weeks.map((week) => {
            const isEmpty = week.cost === 0;
            return (
              <div key={week.label} style={{ flex: 1, display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                {/* Bar cluster */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: CHART_H }}>
                  {series.slice(0, n).map((s, si) => {
                    const h = isEmpty
                      ? 6 + si * 2
                      : Math.max(4, (week.cost * s.share / maxCost) * CHART_H);
                    return (
                      <div key={s.label} style={{
                        width: 22, height: h,
                        background: s.color,
                        opacity: isEmpty ? 0.15 : 1,
                        borderRadius: "3px 3px 0 0",
                        flexShrink: 0,
                      }} />
                    );
                  })}
                </div>
                {/* Week label */}
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)",
                  marginTop: 8, height: 20, lineHeight: "20px" }}>
                  {week.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Legend list below chart ──────────────────────────────────────
function SpendLegend({ rows }: { rows: UsageBreakdownRow[] }) {
  const max = Math.max(...rows.map((r) => r.share_of_cost_pct), 1);
  return (
    <div className="tr-legend">
      {rows.slice(0, 6).map((row, i) => (
        <div key={row.label} className="tr-legend-row">
          <div className="tr-legend-ident">
            <span className="tr-legend-dot" style={{ background: ROW_COLORS[i % ROW_COLORS.length] }} />
            <div>
              <div className="tr-legend-name">{row.label}</div>
            </div>
          </div>
          <div className="tr-track">
            <div
              className="tr-fill"
              style={{ width: `${(row.share_of_cost_pct / max) * 100}%`, background: ROW_COLORS[i % ROW_COLORS.length] }}
            />
          </div>
          <div className="tr-legend-amt">
            ${row.total_cost_usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="tr-legend-delta" style={{ color: "var(--fg4)" }}>
            {row.share_of_cost_pct.toFixed(1)}%
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────
const BREAKDOWN_TABS = [
  { id: "by_model",    label: "By tool spend" },
  { id: "by_step",     label: "By step" },
  { id: "by_provider", label: "By provider" },
  { id: "by_agent",    label: "By agent" },
] as const;
type BreakdownTab = typeof BREAKDOWN_TABS[number]["id"];

// ── Page ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const router = useRouter();

  const [summary,   setSummary]   = useState<UsageSummary | null>(null);
  const [breakdown, setBreakdown] = useState<DashboardUsageBreakdown | null>(null);
  const [timeline,  setTimeline]  = useState<TimelinePoint[]>([]);
  const [tab,       setTab]       = useState<BreakdownTab>("by_model");
  const [recs,      setRecs]      = useState<Rec[]>([]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      getUsageSummary(token, 30),
      getUsageBreakdown(token, 30),
      getUsageTimeline(token, 30),
    ]).then(([s, b, tl]) => {
      setSummary(s);
      setBreakdown(b);
      setTimeline(tl?.points ?? []);
      setRecs((s.top_changes ?? []).slice(0, 3).map(mapToRec));
    }).catch(() => {});
  }, [token]);

  const firstName = (session?.user?.name ?? "there").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const savings   = summary?.potential_savings_usd ?? 0;
  const totalCost = summary?.current_total_cost_usd ?? 0;
  const monthCost = summary?.monthly_cost_usd ?? 0;
  const runs      = summary?.request_count ?? 0;
  const avgRun    = runs > 0 ? totalCost / runs : 0;

  // Tab rows (legend list)
  const tabRows: UsageBreakdownRow[] = useMemo(() => {
    if (!breakdown) return [];
    return (breakdown[tab] ?? []);
  }, [breakdown, tab]);

  // Group timeline daily points → weeks, always pad to 4 weeks
  const weeklyBars: WeekBar[] = useMemo(() => {
    const sorted = [...timeline].sort((a, b) => a.date.localeCompare(b.date));
    const weeks: WeekBar[] = [];
    let wNum = 0;
    let bucket: TimelinePoint[] = [];
    for (let i = 0; i < sorted.length; i++) {
      bucket.push(sorted[i]);
      if (bucket.length === 7 || i === sorted.length - 1) {
        wNum++;
        weeks.push({
          label: `Week ${wNum}`,
          cost: bucket.reduce((s, p) => s + (p.cost_usd ?? 0), 0),
        });
        bucket = [];
      }
    }
    // Always show 4 weeks — future weeks get a near-zero placeholder cost
    while (weeks.length < 4) {
      weeks.push({ label: `Week ${weeks.length + 1}`, cost: 0 });
    }
    return weeks.slice(0, 4);
  }, [timeline]);

  // Series: tab rows as proportional slices of each weekly bar
  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!tabRows.length) return [];
    const total = tabRows.reduce((s, r) => s + r.share_of_cost_pct, 0) || 100;
    return tabRows.slice(0, 4).map((r, i) => ({
      label: r.label,
      share: r.share_of_cost_pct / total,
      color: ROW_COLORS[i % ROW_COLORS.length],
      totalCost: r.total_cost_usd,
    }));
  }, [tabRows]);

  const hasChart = weeklyBars.length > 0 && chartSeries.length > 0;

  return (
    <div className="tr-page">
      {/* Header */}
      <div className="tr-page-head">
        <div>
          <h1 className="tr-page-title">{greeting}, {firstName}</h1>
          <div className="tr-page-sub">Here&apos;s what your agents spent in the last 30 days.</div>
        </div>
      </div>

      {/* Savings banner */}
      {savings > 0 && (
        <div className="tr-savings">
          <div className="tr-savings-copy">
            <div className="tr-eyebrow">Savings available</div>
            <div className="tr-savings-hero">
              Save <span style={{ color: "var(--green)", fontWeight: 600 }}>${Math.round(savings).toLocaleString()}/mo</span> in {recs.length} changes
            </div>
            <div className="tr-savings-sub">Ranked by estimated monthly impact. Accept or defer in one click.</div>
          </div>
          <button className="tr-btn tr-btn-success" onClick={() => router.push("/recommendations")}>
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Review all
          </button>
        </div>
      )}

      {/* Top recs */}
      {recs.length > 0 && (
        <>
          <div className="tr-section-title">Top recommendations</div>
          <div className="tr-rec-row">
            {recs.map((r) => (
              <DecisionCardCompact
                key={r.num}
                rec={r}
                onClick={() => router.push("/recommendations")}
              />
            ))}
          </div>
        </>
      )}

      {/* At a glance */}
      <div className="tr-section-title">At a glance</div>
      <div className="tr-stat-grid cols-4">
        <div className="tr-stat accent">
          <div className="tr-stat-label">Month to date</div>
          <div className="tr-stat-value">${monthCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          <div className="tr-stat-sub" style={{ color: "var(--fg4)" }}>
            {summary?.cost_budget_utilization_pct != null
              ? `${summary.cost_budget_utilization_pct.toFixed(0)}% of budget`
              : ""}
          </div>
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">Total cost (30d)</div>
          <div className="tr-stat-value">${totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          {summary?.cost_change_pct != null && (
            <div className="tr-stat-delta" style={{ color: summary.cost_change_pct > 0 ? "var(--warning-high)" : "var(--green)" }}>
              {summary.cost_change_pct > 0 ? "+" : ""}{summary.cost_change_pct.toFixed(1)}% vs prev 30d
            </div>
          )}
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">Runs (30d)</div>
          <div className="tr-stat-value">{runs.toLocaleString()}</div>
          <div className="tr-stat-sub">
            {summary?.avg_tool_calls_per_request != null
              ? `${summary.avg_tool_calls_per_request.toFixed(1)} tool calls/req`
              : ""}
          </div>
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">Avg cost / run</div>
          <div className="tr-stat-value">${avgRun.toFixed(4)}</div>
          <div className="tr-stat-sub">
            {summary?.avg_tokens_per_request != null
              ? `${Math.round(summary.avg_tokens_per_request).toLocaleString()} tokens/req`
              : ""}
          </div>
        </div>
      </div>

      {/* Spend breakdown */}
      <div className="tr-section-title">Spend breakdown</div>
      <div className="tr-chart">
        <div className="tr-chart-head">
          <div className="tr-tabs">
            {BREAKDOWN_TABS.map((t) => (
              <button
                key={t.id}
                className={`tr-tab${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {!hasChart && tabRows.length === 0 ? (
          <div className="tr-empty" style={{ border: "none", background: "transparent", padding: "24px 0" }}>
            No data yet for this period.
          </div>
        ) : hasChart ? (
          <>
            <SpendBarChart weeks={weeklyBars} series={chartSeries} />
            <SpendLegend rows={tabRows} />
          </>
        ) : (
          /* Fallback: no timeline but have breakdown totals */
          <SpendLegend rows={tabRows} />
        )}
      </div>
    </div>
  );
}
