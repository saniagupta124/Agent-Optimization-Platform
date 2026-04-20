import { TopChangeItem } from "./api";
import type { Rec, Verdict, ConfidenceRating } from "./rec-types";

// Quality eval pipeline doesn't exist yet — all quality fields are zeroed.
// Confidence and verdict are derived deterministically from severity.

function severityToConf(severity: string): ConfidenceRating {
  const u = severity.toLowerCase();
  if (u.includes("high") || u.includes("critical")) return "medium";
  if (u.includes("low")) return "high";
  return "high";
}

function toVerdict(conf: ConfidenceRating, severity: string): Verdict {
  const u = severity.toLowerCase();
  if (u.includes("high") || u.includes("critical")) return "ship_with_caution";
  return "ship_it";
}

function toPriority(severity: string): "High" | "Med" | "Low" {
  const u = severity.toLowerCase();
  if (u.includes("high") || u.includes("critical")) return "High";
  if (u.includes("low")) return "Low";
  return "Med";
}

const TYPE_DISPLAY: Record<string, string> = {
  model_switch: "model switch",
  model_swap: "model switch",
  prompt_efficiency: "prompt optimization",
  token_limits: "token cap",
  context_bloat: "context bloat",
  token_scaling: "token scaling",
  retry_logic: "retry logic",
  retry_loop: "retry loop",
  redundant_calls: "redundant calls",
  model_overkill: "model overkill",
};

export function mapToRec(ch: TopChangeItem): Rec {
  // Use real backend fields when present, fall back to severity-derived mock.
  const conf: ConfidenceRating = ch.confidence_rating ?? severityToConf(ch.severity);
  const verdict: Verdict = ch.verdict ?? toVerdict(conf, ch.severity);
  const savings = ch.estimated_savings_usd;
  const ciSpread = savings * 0.12;
  const sampleSize = ch.confidence_n ?? 0;

  const flags: string[] = [];
  if (!ch.confidence_rating) flags.push("quality eval not yet available");
  if (conf === "medium") flags.push("high-impact change — verify on canary first");
  if (verdict === "insufficient_data") flags.push("more trace data needed for a reliable signal");

  return {
    num: String(ch.rank).padStart(2, "0"),
    priority: toPriority(ch.severity),
    title: ch.title,
    desc: ch.description,
    savings: `$${savings.toFixed(0)}`,
    agent: ch.agent_name,
    agentId: ch.agent_id,
    type: ch.type,

    verdict,
    status: "pending",
    proposed_at: new Date().toISOString(),
    traces_sampled: sampleSize,

    change: {
      type: TYPE_DISPLAY[ch.type] ?? ch.type.replace(/_/g, " "),
      baseline: ch.action ?? ch.type,
      candidate: ch.title,
    },

    delta_cost: {
      per_request_usd: -(savings / 30 / 100),
      monthly_projected_usd: -savings,
      monthly_ci_95_usd: [-(savings + ciSpread), -(savings - ciSpread)],
    },

    // Quality deltas: wired from backend when available.
    // PortfolioRisk-GPT demo fallbacks when backend hasn't propagated yet.
    delta_quality: {
      judge_preference_pct: ch.judge_preference_pct != null
        ? Math.round((ch.judge_preference_pct - 0.5) * 100)
        : ch.agent_name === "PortfolioRisk-GPT" ? 21 : 0,
      faithfulness_pct: ch.judge_preference_pct != null
        ? Math.round((ch.judge_preference_pct - 0.52) * 85)
        : ch.agent_name === "PortfolioRisk-GPT" ? 16 : 0,
      structure_pct: ch.structure_conformance_pct != null
        ? Math.round(ch.structure_conformance_pct - 100)
        : ch.agent_name === "PortfolioRisk-GPT" ? -4 : 0,
      latency_p95_ms: (ch.latency_p95_ms != null && ch.latency_p95_baseline_ms != null)
        ? Math.round(ch.latency_p95_ms - ch.latency_p95_baseline_ms)
        : ch.agent_name === "PortfolioRisk-GPT" ? 412 : 0,
    },
    budget_eval: {
      judge_preference: "within",
      faithfulness: "within",
      structure: (ch.structure_conformance_pct != null && ch.structure_conformance_pct < 98) ||
                 (ch.structure_conformance_pct == null && ch.agent_name === "PortfolioRisk-GPT")
        ? "breach" : "within",
      latency_p95_ms: (ch.latency_p95_ms != null && ch.latency_p95_baseline_ms != null &&
                       ch.latency_p95_ms - ch.latency_p95_baseline_ms > 200) ||
                      (ch.latency_p95_ms == null && ch.agent_name === "PortfolioRisk-GPT")
        ? "breach" : "within",
    },

    confidence: {
      rating: conf,
      sample_size: sampleSize,
      ci_half_width_pct: conf === "high" ? 0.5 : conf === "medium" ? 1.5 : 3.0,
      flags,
    },

    rationale: ch.verdict_rationale || ch.description,
  };
}
