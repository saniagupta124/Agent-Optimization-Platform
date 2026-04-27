"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  getAgent, getAgentDashboard, getSpanRecommendations,
  type AgentWithStats, type AgentDashboard, type SpanRecommendation,
} from "../../../lib/api";
import { mapToRec } from "../../../lib/mapToRec";
import type { Rec, RecStatus } from "../../../lib/rec-types";
import { DecisionCard } from "../../../components/DecisionCard";

function fmt(n: number | undefined | null, d = 2) {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: n < 100 ? d : 0, maximumFractionDigits: d });
}

export default function AgentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const router = useRouter();

  const [agent, setAgent]       = useState<AgentWithStats | null>(null);
  const [dash,  setDash]        = useState<AgentDashboard | null>(null);
  const [recs,  setRecs]        = useState<Rec[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      getAgent(token, id),
      getAgentDashboard(token, id),
      getSpanRecommendations(token, id),
    ]).then(([a, d, spanRecs]) => {
      setAgent(a);
      setDash(d);
      // Map SpanRecommendations → TopChangeItem shape → Rec
      const mapped = spanRecs.map((sr, idx): Rec => mapToRec({
        rank: idx + 1,
        title: `${sr.rec_type.replace(/_/g, " ")} on ${sr.span_name}`,
        description: sr.explanation,
        action: sr.rec_type,
        estimated_savings_usd: sr.savings_per_month,
        severity: sr.confidence >= 80 ? "medium" : "high",
        type: sr.rec_type,
        agent_id: id,
        agent_name: a.name,
        confidence_rating: sr.confidence_rating,
        confidence_n: sr.confidence_n,
        confidence_score: sr.confidence_score,
        quality_impact: sr.quality_impact as "none" | "low" | "medium" | "high" | undefined,
        verdict: sr.verdict as "ship_it" | "ship_with_caution" | "canary_only" | "hold" | "insufficient_data" | undefined,
        latency_p95_ms: sr.latency_p95_ms,
        latency_p95_baseline_ms: sr.latency_p95_baseline_ms,
        structure_conformance_pct: sr.structure_conformance_pct,
        judge_preference_pct: sr.judge_preference_pct,
      }));
      setRecs(mapped);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [token, id]);

  const onStatusChange = (recId: string, next: RecStatus) => {
    setRecs((prev) => prev.map((r) => (r.num === recId ? { ...r, status: next } : r)));
  };

  const live = (agent?.request_count_7d ?? 0) > 0;
  const sessionCost = dash?.session_cost_usd ?? 0;
  const alltimeCost = dash?.alltime_cost_usd ?? 0;
  const sessionReqs = dash?.session_request_count ?? 0;
  const alltimeReqs = dash?.alltime_request_count ?? 0;

  if (loading) {
    return (
      <div className="tr-page">
        <div style={{ height: 32, width: 120, background: "var(--bg-card)", borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 48, width: 280, background: "var(--bg-card)", borderRadius: 8, marginBottom: 32 }} />
        <div className="tr-stat-grid cols-4">
          {[1,2,3,4].map((i) => <div key={i} className="tr-stat" style={{ height: 100, opacity: 0.5 }} />)}
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="tr-page">
        <div className="tr-empty">Agent not found.</div>
      </div>
    );
  }

  return (
    <div className="tr-page">
      {/* Back */}
      <button className="tr-back" onClick={() => router.push("/agents")}>
        <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        Back to agents
      </button>

      {/* Header */}
      <div className="tr-page-head">
        <div>
          <h1 className="tr-page-title">
            <span className={`tr-dot${live ? "" : " idle"}`} style={{ marginRight: 6 }} />
            {agent.name}
          </h1>
          <div className="tr-page-sub">
            {agent.provider} · {agent.model}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="tr-stat-grid cols-4">
        <div className="tr-stat accent">
          <div className="tr-stat-label">Session cost</div>
          <div className="tr-stat-value">${fmt(sessionCost)}</div>
          <div className="tr-stat-sub">{sessionReqs.toLocaleString()} reqs this session</div>
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">All-time cost</div>
          <div className="tr-stat-value">${fmt(alltimeCost)}</div>
          <div className="tr-stat-sub">{alltimeReqs.toLocaleString()} total requests</div>
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">Req / min</div>
          <div className="tr-stat-value">{(dash?.requests_per_minute ?? 0).toFixed(2)}</div>
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">Avg cost / req</div>
          <div className="tr-stat-value">
            {alltimeReqs > 0 ? `$${(alltimeCost / alltimeReqs).toFixed(4)}` : "—"}
          </div>
        </div>
      </div>

      {/* Recommendations */}
      {recs.length > 0 && (
        <>
          <div className="tr-section-title" style={{ marginTop: 40 }}>Recommendations for this agent</div>
          {recs.map((r) => (
            <DecisionCard key={r.num} rec={r} token={token} onStatusChange={onStatusChange} />
          ))}
        </>
      )}

      {/* Retry loops */}
      {dash && dash.retry_loops.length > 0 && (
        <>
          <div className="tr-section-title">Detected retry loops</div>
          <div className="tr-table-wrap">
            <table className="tr-table">
              <thead>
                <tr>
                  <th>Span</th>
                  <th className="r">Occurrences</th>
                  <th className="r">Window</th>
                </tr>
              </thead>
              <tbody>
                {dash.retry_loops.map((r) => (
                  <tr key={r.span_name} style={{ cursor: "default" }}>
                    <td style={{ color: "var(--warning-high)" }}>{r.span_name}</td>
                    <td className="r">{r.occurrences}</td>
                    <td className="r">{r.window_seconds}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
