"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAgents, type AgentWithStats } from "../../lib/api";

function fmt(n: number | undefined, decimals = 2) {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: n < 100 ? decimals : 0, maximumFractionDigits: 2 });
}

export default function AgentsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const router = useRouter();

  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    getAgents(token).then(setAgents).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  const totalCost = agents.reduce((s, a) => s + (a.total_cost_7d ?? 0), 0);
  const totalRuns = agents.reduce((s, a) => s + (a.request_count_7d ?? 0), 0);
  const activeCount = agents.filter((a) => (a.request_count_7d ?? 0) > 0).length;

  return (
    <div className="tr-page">
      <div className="tr-page-head">
        <div>
          <h1 className="tr-page-title">Agents</h1>
          <div className="tr-page-sub">All agents connected to Traeco. Click a row to see its trace.</div>
        </div>
      </div>

      {/* Stats */}
      <div className="tr-section-title">At a glance</div>
      <div className="tr-stat-grid cols-4">
        <div className="tr-stat">
          <div className="tr-stat-label">Active agents</div>
          <div className="tr-stat-value">{activeCount}</div>
          <div className="tr-stat-sub">{agents.length - activeCount} idle</div>
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">Runs (30d)</div>
          <div className="tr-stat-value">{totalRuns.toLocaleString()}</div>
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">Spend (30d)</div>
          <div className="tr-stat-value">${fmt(totalCost)}</div>
        </div>
        <div className="tr-stat">
          <div className="tr-stat-label">Agents</div>
          <div className="tr-stat-value">{agents.length}</div>
          <div className="tr-stat-sub">connected</div>
        </div>
      </div>

      {/* Table */}
      <div className="tr-section-title">All agents</div>
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {[1,2,3].map((i) => (
            <div key={i} style={{ height: 56, background: "var(--bg-card)", borderRadius: i === 1 ? "10px 10px 0 0" : i === 3 ? "0 0 10px 10px" : 0, opacity: 0.6 }} />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="tr-empty">
          No agents yet.{" "}
          <button className="tr-btn tr-btn-ghost tr-btn-sm" style={{ display: "inline-flex" }} onClick={() => router.push("/agents/new")}>
            Add your first agent
          </button>
        </div>
      ) : (
        <div className="tr-table-wrap">
          <table className="tr-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Provider / model</th>
                <th className="r">Runs (30d)</th>
                <th className="r">Cost (30d)</th>
                <th className="r">Avg / run</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const live = (a.request_count_7d ?? 0) > 0;
                const avg = a.request_count_7d && a.request_count_7d > 0
                  ? (a.total_cost_7d ?? 0) / a.request_count_7d
                  : null;
                return (
                  <tr key={a.id} onClick={() => router.push(`/agents/${a.id}`)}>
                    <td>
                      <span className={`tr-dot${live ? "" : " idle"}`} />
                      {a.name}
                    </td>
                    <td className="muted">{a.provider} / {a.model}</td>
                    <td className="r">{(a.request_count_7d ?? 0).toLocaleString()}</td>
                    <td className="r">${fmt(a.total_cost_7d)}</td>
                    <td className="r">{avg != null ? `$${avg.toFixed(4)}` : "—"}</td>
                    <td className="r tr-chev">
                      <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
