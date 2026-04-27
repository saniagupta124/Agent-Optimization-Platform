"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface EvalCluster {
  id: string;
  cluster_label: string;
  cluster_size: number;
  example_input: string | null;
  auto_draft_criteria: string | null;
  good_answer_criteria: string | null;
  skip_criteria: boolean;
}

interface EvalData {
  agent_id: string;
  agent_name: string;
  clusters: EvalCluster[];
  criteria_set: number;
  rubric_active: boolean;
}

export default function AgentEvalsPage({ params }: { params: { agentId: string } }) {
  const { agentId } = params;
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const router = useRouter();

  const [data, setData] = useState<EvalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/agents/${agentId}/eval-clusters`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, agentId]);

  async function saveCriteria(cluster: EvalCluster, skipOnly = false) {
    if (!token) return;
    const criteria = skipOnly ? null : (editing[cluster.id] ?? cluster.good_answer_criteria ?? "");
    const skip = skipOnly;
    setSaving((s) => ({ ...s, [cluster.id]: true }));
    try {
      await fetch(`${BASE_URL}/agents/${agentId}/eval-clusters/${cluster.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ good_answer_criteria: criteria || null, skip_criteria: skip }),
      });
      setData((d) =>
        d
          ? {
              ...d,
              clusters: d.clusters.map((c) =>
                c.id === cluster.id ? { ...c, good_answer_criteria: criteria || null, skip_criteria: skip } : c
              ),
              criteria_set: d.clusters.filter(
                (c) => c.id === cluster.id
                  ? skip || !!criteria
                  : c.skip_criteria || !!c.good_answer_criteria
              ).length,
            }
          : d
      );
      setSaved((s) => ({ ...s, [cluster.id]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [cluster.id]: false })), 2000);
    } finally {
      setSaving((s) => ({ ...s, [cluster.id]: false }));
    }
  }

  if (loading) return <div className="tr-page"><div className="tr-empty">Loading…</div></div>;
  if (!data) return <div className="tr-page"><div className="tr-empty">Could not load eval clusters.</div></div>;

  const rubricPct = data.clusters.length > 0
    ? Math.round((data.criteria_set / data.clusters.length) * 100)
    : 0;

  return (
    <div className="tr-page">
      <button className="tr-back" onClick={() => router.push("/evals")}>
        <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        Back to Evals
      </button>

      <div className="tr-page-head">
        <div>
          <h1 className="tr-page-title">{data.agent_name}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--fg3)" }}>
            {data.criteria_set}/{data.clusters.length} clusters have criteria ·{" "}
            {data.rubric_active ? (
              <span style={{ color: "var(--green)" }}>Rubric judge active</span>
            ) : (
              <span style={{ color: "var(--fg4)" }}>Need {Math.max(0, 5 - data.criteria_set)} more to activate rubric judge</span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--fg3)" }}>{rubricPct}% coverage</div>
          <div style={{ width: 120, height: 6, borderRadius: 3, background: "var(--border-default)" }}>
            <div style={{ width: `${rubricPct}%`, height: "100%", borderRadius: 3, background: data.rubric_active ? "var(--green)" : "var(--warning-med)", transition: "width 300ms" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
        {data.clusters.map((cluster) => {
          const currentCriteria = editing[cluster.id] ?? cluster.good_answer_criteria ?? "";
          const isDone = cluster.skip_criteria || !!cluster.good_answer_criteria;
          return (
            <div
              key={cluster.id}
              className="rounded-2xl border p-5"
              style={{
                background: "var(--bg-card)",
                borderColor: isDone ? "rgba(52,211,153,0.2)" : "var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, color: "var(--fg1)" }}>{cluster.cluster_label}</span>
                    {cluster.cluster_size > 0 && (
                      <span style={{ fontSize: 11, color: "var(--fg4)", background: "var(--border-subtle)", borderRadius: 4, padding: "1px 6px" }}>
                        {cluster.cluster_size} traces
                      </span>
                    )}
                    {isDone && (
                      <span style={{ fontSize: 11, color: "var(--green)" }}>✓</span>
                    )}
                  </div>
                  {cluster.example_input && (
                    <p style={{ fontSize: 12, color: "var(--fg4)", marginTop: 4, fontStyle: "italic" }}>
                      e.g. "{cluster.example_input.slice(0, 80)}{cluster.example_input.length > 80 ? "…" : ""}"
                    </p>
                  )}
                </div>
                <button
                  onClick={() => saveCriteria(cluster, !cluster.skip_criteria)}
                  style={{
                    fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border-default)",
                    background: cluster.skip_criteria ? "rgba(248,113,113,0.1)" : "transparent",
                    color: cluster.skip_criteria ? "var(--warning-high)" : "var(--fg3)",
                    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  {cluster.skip_criteria ? "Skipped — click to unskip" : "Judge by preference only"}
                </button>
              </div>

              {!cluster.skip_criteria && (
                <>
                  {cluster.auto_draft_criteria && !cluster.good_answer_criteria && (
                    <div style={{ fontSize: 12, color: "var(--fg3)", background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
                      <span style={{ color: "var(--fg4)" }}>Auto-draft: </span>{cluster.auto_draft_criteria}
                      <button
                        onClick={() => setEditing((e) => ({ ...e, [cluster.id]: cluster.auto_draft_criteria! }))}
                        style={{ marginLeft: 8, fontSize: 11, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                      >
                        Use this
                      </button>
                    </div>
                  )}
                  <textarea
                    value={currentCriteria}
                    onChange={(e) => setEditing((ed) => ({ ...ed, [cluster.id]: e.target.value }))}
                    placeholder="What makes a good answer for this type of input? One sentence is enough."
                    rows={2}
                    style={{
                      width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-default)",
                      borderRadius: 8, color: "var(--fg1)", fontSize: 13, padding: "10px 12px",
                      resize: "vertical", fontFamily: "inherit", outline: "none",
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      onClick={() => saveCriteria(cluster)}
                      disabled={saving[cluster.id] || !currentCriteria.trim()}
                      style={{
                        fontSize: 12, padding: "6px 16px", borderRadius: 8,
                        background: saved[cluster.id] ? "rgba(52,211,153,0.15)" : "#1BA86F",
                        color: saved[cluster.id] ? "var(--green)" : "#fff",
                        border: "none", cursor: saving[cluster.id] || !currentCriteria.trim() ? "not-allowed" : "pointer",
                        opacity: saving[cluster.id] || !currentCriteria.trim() ? 0.5 : 1,
                      }}
                    >
                      {saving[cluster.id] ? "Saving…" : saved[cluster.id] ? "Saved ✓" : "Save criteria"}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
