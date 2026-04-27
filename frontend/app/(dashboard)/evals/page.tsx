"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { getAgents, type AgentWithStats } from "../../lib/api";

export default function EvalsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const router = useRouter();
  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    getAgents(token).then(setAgents).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="tr-page">
      <div className="tr-page-head">
        <div>
          <h1 className="tr-page-title">Eval Criteria</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--fg3)" }}>
            Define quality criteria per cluster to upgrade the LLM judge from generic to domain-specific scoring.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="tr-stat-grid cols-3" style={{ marginTop: 24 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="tr-stat" style={{ height: 80, opacity: 0.4 }} />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="tr-empty" style={{ marginTop: 40 }}>
          No agents yet. Add an agent first to set up eval criteria.
        </div>
      ) : (
        <div className="tr-stat-grid cols-3" style={{ marginTop: 24 }}>
          {agents.map((a) => (
            <button
              key={a.id}
              className="tr-stat"
              style={{ textAlign: "left", cursor: "pointer" }}
              onClick={() => router.push(`/evals/${a.id}`)}
            >
              <div className="tr-stat-label">{a.name}</div>
              <div className="tr-stat-value" style={{ fontSize: 14, marginTop: 4 }}>
                {a.provider} · {a.model}
              </div>
              <div className="tr-stat-sub" style={{ marginTop: 4 }}>
                Set up eval criteria →
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
