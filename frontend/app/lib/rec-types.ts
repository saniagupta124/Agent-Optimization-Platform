// Types for the Decision Surface (PRD §4, §6)
// This is the canonical Rec shape — matches the mockup data.ts contract.

export type Verdict =
  | "ship_it"
  | "ship_with_caution"
  | "canary_only"
  | "hold"
  | "insufficient_data";

export type ConfidenceRating = "high" | "medium" | "low";

export type RecStatus = "pending" | "accepted" | "rejected" | "deferred";

export type BudgetEval = "within" | "breach";

export type RejectReasonCategory =
  | "quality_risk"
  | "cost_unclear"
  | "business_context"
  | "other";

export type Rec = {
  num: string;
  priority: "High" | "Med" | "Low";
  title: string;
  desc: string;
  savings: string;
  agent: string;
  agentId: string;
  type: string;

  verdict: Verdict;
  status: RecStatus;
  proposed_at: string;
  traces_sampled: number;
  change: {
    type: string;
    baseline: string;
    candidate: string;
  };
  delta_cost: {
    per_request_usd: number;
    monthly_projected_usd: number;
    monthly_ci_95_usd: [number, number];
  };
  delta_quality: {
    judge_preference_pct: number;
    faithfulness_pct: number;
    structure_pct: number;
    latency_p95_ms: number;
  };
  budget_eval: {
    judge_preference: BudgetEval;
    faithfulness: BudgetEval;
    structure: BudgetEval;
    latency_p95_ms: BudgetEval;
  };
  confidence: {
    rating: ConfidenceRating;
    sample_size: number;
    ci_half_width_pct: number;
    flags: string[];
  };
  rationale: string;
};
