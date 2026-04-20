"use client";

import { useState, type CSSProperties } from "react";
import { RejectModal, type RejectReasonCategory } from "./RejectModal";
import type { BudgetEval, Rec, Verdict } from "../lib/rec-types";

// Verdict metadata — single source of truth for colors + copy.
const VERDICT_META: Record<Verdict, { label: string; short: string; color: string; bg: string }> = {
  ship_it: {
    label: "Ship it",
    short: "Ship",
    color: "var(--green)",
    bg: "rgba(52, 211, 153, 0.14)",
  },
  ship_with_caution: {
    label: "Ship with caution",
    short: "Caution",
    color: "var(--warning-med)",
    bg: "rgba(251, 191, 36, 0.14)",
  },
  canary_only: {
    label: "Canary only",
    short: "Canary",
    color: "var(--blue)",
    bg: "rgba(96, 165, 250, 0.14)",
  },
  hold: {
    label: "Hold",
    short: "Hold",
    color: "var(--warning-high)",
    bg: "rgba(248, 113, 113, 0.14)",
  },
  insufficient_data: {
    label: "Insufficient data",
    short: "Insufficient",
    color: "var(--fg3)",
    bg: "rgba(255, 255, 255, 0.04)",
  },
};

export function VerdictBadge({
  verdict,
  short,
  style,
}: {
  verdict: Verdict;
  short?: boolean;
  style?: CSSProperties;
}) {
  const m = VERDICT_META[verdict];
  return (
    <span className="tr-verdict" style={{ color: m.color, background: m.bg, ...style }}>
      {short ? m.short : m.label}
    </span>
  );
}

// Formatting helpers
function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const digits = abs < 100 ? 2 : 0;
  const s = abs.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "−" : "+"}$${s}`;
}

function signedPct(n: number): string {
  if (n === 0) return "═ 0%";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

function signedMs(n: number): string {
  if (n === 0) return "═ 0ms";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${Math.abs(n)}ms`;
}

function qualityLineColor(delta: number, evalResult: BudgetEval, higherIsWorse = true): string {
  if (evalResult === "breach") return "var(--warning-high)";
  if (delta === 0) return "var(--fg3)";
  const isRegression = higherIsWorse ? delta > 0 : delta < 0;
  return isRegression ? "var(--fg2)" : "var(--green)";
}

function dateShort(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

// Full Decision Card
export function DecisionCard({
  rec,
  onStatusChange,
}: {
  rec: Rec;
  onStatusChange?: (
    id: string,
    next: Rec["status"],
    reason?: { category: RejectReasonCategory; note: string }
  ) => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);

  const accept = (asCanary = false) => {
    onStatusChange?.(rec.num, "accepted");
    // TODO: wire to real accept mutation
    void asCanary;
  };
  const defer = () => onStatusChange?.(rec.num, "deferred");
  const reject = (category: RejectReasonCategory, note: string) => {
    onStatusChange?.(rec.num, "rejected", { category, note });
    setRejectOpen(false);
  };

  const cost = rec.delta_cost;
  const q = rec.delta_quality;
  const b = rec.budget_eval;
  const c = rec.confidence;

  return (
    <>
      <div className="tr-decision" data-status={rec.status}>
        <div className="tr-decision-head">
          <div>
            <div className="tr-decision-title">
              <span className="tr-rec-num">{rec.num}</span>
              <span>{rec.agent}</span>
              <span className="tr-decision-title-sep">·</span>
              <span className="tr-decision-change">
                {rec.title}
              </span>
            </div>
            <div className="tr-decision-meta">
              Proposed {dateShort(rec.proposed_at)}
              {rec.traces_sampled > 0 && ` · ${rec.traces_sampled} traces sampled`}
            </div>
          </div>
          <VerdictBadge verdict={rec.verdict} />
        </div>

        <div className="tr-decision-body">
          {/* Cost column */}
          <div className="tr-decision-col">
            <div className="tr-decision-col-label">Cost</div>
            <div
              className="tr-decision-hero"
              style={{ color: cost.monthly_projected_usd < 0 ? "var(--green)" : "var(--warning-high)" }}
            >
              {formatMoney(cost.monthly_projected_usd)}
              <span className="tr-decision-hero-sub">/mo</span>
            </div>
            <div className="tr-decision-line">
              {formatMoney(cost.per_request_usd)}
              <span className="tr-decision-line-sub">/req</span>
            </div>
            <div className="tr-decision-ci">
              CI: [{formatMoney(cost.monthly_ci_95_usd[0])}, {formatMoney(cost.monthly_ci_95_usd[1])}]
            </div>
          </div>

          {/* Quality column */}
          <div className="tr-decision-col">
            <div className="tr-decision-col-label">Quality</div>
            <div
              className="tr-decision-line"
              style={{ color: qualityLineColor(q.judge_preference_pct, b.judge_preference) }}
            >
              {signedPct(q.judge_preference_pct)}
              <span className="tr-decision-line-sub">preference</span>
            </div>
            <div
              className="tr-decision-line"
              style={{ color: qualityLineColor(q.faithfulness_pct, b.faithfulness) }}
            >
              {signedPct(q.faithfulness_pct)}
              <span className="tr-decision-line-sub">faithful.</span>
            </div>
            <div
              className="tr-decision-line"
              style={{ color: qualityLineColor(q.structure_pct, b.structure) }}
            >
              {signedPct(q.structure_pct)}
              <span className="tr-decision-line-sub">schema</span>
            </div>
            <div
              className="tr-decision-line"
              style={{ color: qualityLineColor(q.latency_p95_ms, b.latency_p95_ms) }}
            >
              {signedMs(q.latency_p95_ms)}
              <span className="tr-decision-line-sub">p95</span>
            </div>
          </div>

          {/* Confidence column */}
          <div className="tr-decision-col">
            <div className="tr-decision-col-label">Confidence</div>
            <div className={`tr-decision-conf conf-${c.rating}`}>
              <span className="tr-decision-conf-dot" />
              {c.rating === "high" ? "High" : c.rating === "medium" ? "Medium" : "Low"}
            </div>
            <div className="tr-decision-line-sub tr-decision-conf-stats">
              {c.sample_size > 0 ? `n=${c.sample_size}, ` : ""}CI ±{c.ci_half_width_pct.toFixed(1)}%
            </div>
            {c.flags.length > 0 && (
              <div className="tr-decision-flags">
                {c.flags.slice(0, 3).map((f) => (
                  <div key={f} className="tr-decision-flag">• {f}</div>
                ))}
                {c.flags.length > 3 && (
                  <div className="tr-decision-flag tr-decision-flag-more">
                    +{c.flags.length - 3} more
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="tr-decision-rationale">
          <div className="tr-decision-col-label">Rationale</div>
          <p>{rec.rationale}</p>
        </div>

        {rec.status === "pending" ? (
          <div className="tr-decision-actions">
            <button
              className="tr-btn tr-btn-success"
              onClick={() => accept(false)}
              disabled={rec.verdict === "hold"}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Accept
            </button>
            <button
              className="tr-btn tr-btn-ghost"
              onClick={() => accept(true)}
              disabled={rec.verdict === "hold"}
            >
              Accept as canary
            </button>
            <button className="tr-btn tr-btn-ghost" onClick={() => setRejectOpen(true)}>
              Reject
            </button>
            <button className="tr-btn tr-btn-ghost" onClick={defer}>
              Defer
            </button>
          </div>
        ) : (
          <div className={`tr-decision-status tr-decision-status-${rec.status}`}>
            <span className="tr-decision-status-label">
              {rec.status === "accepted" && "✓ Accepted"}
              {rec.status === "rejected" && "✕ Rejected"}
              {rec.status === "deferred" && "◷ Deferred"}
            </span>
            <button
              className="tr-btn tr-btn-ghost tr-btn-sm"
              onClick={() => onStatusChange?.(rec.num, "pending")}
            >
              Undo
            </button>
          </div>
        )}
      </div>

      {rejectOpen && (
        <RejectModal
          recTitle={rec.title}
          onClose={() => setRejectOpen(false)}
          onSubmit={reject}
        />
      )}
    </>
  );
}

// Compact Decision Card (dashboard top-recs row)
export function DecisionCardCompact({
  rec,
  onClick,
}: {
  rec: Rec;
  onClick?: () => void;
}) {
  const q = rec.delta_quality;
  const qSummary =
    q.faithfulness_pct < 0 || q.judge_preference_pct < 0
      ? signedPct(Math.min(q.judge_preference_pct, q.faithfulness_pct))
      : "No change";
  const confLabel =
    rec.confidence.rating === "high" ? "High" : rec.confidence.rating === "medium" ? "Med" : "Low";

  return (
    <div
      className="tr-decision-compact"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
    >
      <div className="tr-decision-compact-top">
        <span className="tr-rec-num">{rec.num}</span>
        <VerdictBadge verdict={rec.verdict} short />
      </div>
      <div className="tr-decision-compact-title">{rec.title}</div>
      <div className="tr-decision-compact-agent">{rec.agent}</div>

      <div className="tr-decision-compact-stats">
        <div>
          <div className="tr-decision-compact-stat-label">Cost</div>
          <div
            className="tr-decision-compact-stat-val"
            style={{
              color: rec.delta_cost.monthly_projected_usd < 0 ? "var(--green)" : "var(--warning-high)",
            }}
          >
            {formatMoney(rec.delta_cost.monthly_projected_usd)}<span>/mo</span>
          </div>
        </div>
        <div>
          <div className="tr-decision-compact-stat-label">Quality</div>
          <div className="tr-decision-compact-stat-val">{qSummary}</div>
        </div>
        <div>
          <div className="tr-decision-compact-stat-label">Confidence</div>
          <div className={`tr-decision-compact-stat-val conf-${rec.confidence.rating}`}>
            {confLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
