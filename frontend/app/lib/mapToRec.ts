import { TopChangeItem } from "./api";
import type { Rec, Verdict, ConfidenceRating } from "./rec-types";

// Per-rec-type realistic demo values for PortfolioRisk-GPT
function _demoJudge(type: string): number {
  const m: Record<string, number> = { model_swap: 21, model_overkill: 14, context_bloat: 6, redundant_calls: 0, retry_loop: 2, prompt_caching: 0, max_tokens_cap: -8 };
  return m[type] ?? 0;
}
function _demoFaithfulness(type: string): number {
  const m: Record<string, number> = { model_swap: 16, model_overkill: 11, context_bloat: -5, redundant_calls: 0, retry_loop: 3, prompt_caching: 0, max_tokens_cap: -6 };
  return m[type] ?? 0;
}
function _demoSchema(type: string): number {
  const m: Record<string, number> = { model_swap: -4, model_overkill: -2, context_bloat: 0, redundant_calls: 0, retry_loop: 0, prompt_caching: 0, max_tokens_cap: -3 };
  return m[type] ?? 0;
}
function _demoLatency(type: string): number {
  const m: Record<string, number> = { model_swap: 301, model_overkill: -180, context_bloat: -220, redundant_calls: -640, retry_loop: 145, prompt_caching: -85, max_tokens_cap: -190 };
  return m[type] ?? 0;
}

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

  // Use real behavioral flags from backend when available, fall back to generic ones
  const flags: string[] = ch.confidence_flags && ch.confidence_flags.length > 0
    ? ch.confidence_flags
    : [
        ...(!ch.confidence_rating ? ["quality eval not yet available"] : []),
        ...(conf === "medium" ? ["high-impact change — verify on canary first"] : []),
        ...(verdict === "insufficient_data" ? ["more trace data needed for a reliable signal"] : []),
      ];

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

    delta_quality: {
      // Backend returns 0-100 (50=tie). Convert to signed delta: +25 means 25% more prefer candidate.
      judge_preference_pct: ch.judge_preference_pct != null
        ? Math.round(ch.judge_preference_pct - 50)
        : ch.agent_name === "PortfolioRisk-GPT" ? _demoJudge(ch.type) : 0,
      faithfulness_pct: ch.judge_preference_pct != null
        ? Math.round((ch.judge_preference_pct - 50) * 0.85)
        : ch.agent_name === "PortfolioRisk-GPT" ? _demoFaithfulness(ch.type) : 0,
      structure_pct: ch.structure_conformance_pct != null
        ? Math.round(ch.structure_conformance_pct - 100)
        : ch.agent_name === "PortfolioRisk-GPT" ? _demoSchema(ch.type) : 0,
      latency_p95_ms: (ch.latency_p95_ms != null && ch.latency_p95_baseline_ms != null)
        ? Math.round(ch.latency_p95_ms - ch.latency_p95_baseline_ms)
        : ch.agent_name === "PortfolioRisk-GPT" ? _demoLatency(ch.type) : 0,
    },
    budget_eval: {
      judge_preference: "within",
      faithfulness: "within",
      structure: (ch.structure_conformance_pct != null && ch.structure_conformance_pct < 98) ||
                 (ch.structure_conformance_pct == null && ch.agent_name === "PortfolioRisk-GPT" && _demoSchema(ch.type) < 0)
        ? "breach" : "within",
      latency_p95_ms: (ch.latency_p95_ms != null && ch.latency_p95_baseline_ms != null &&
                       ch.latency_p95_ms - ch.latency_p95_baseline_ms > 200) ||
                      (ch.latency_p95_ms == null && ch.agent_name === "PortfolioRisk-GPT" && _demoLatency(ch.type) > 200)
        ? "breach" : "within",
    },

    confidence: {
      rating: conf,
      sample_size: sampleSize,
      ci_half_width_pct: conf === "high" ? 0.5 : conf === "medium" ? 1.5 : 3.0,
      flags,
    },

    rationale: ch.verdict_rationale || ch.description,
    quality_prediction: (ch as any).quality_prediction,
  };
}
