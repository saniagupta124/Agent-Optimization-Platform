"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { getMemberDetail, MemberDetail } from "../../../lib/api";

function tierBadge(tier: string) {
  const t = tier.toLowerCase();
  if (t === "pro") {
    return (
      <span className="rounded-md bg-orange-950/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-orange-300 ring-1 ring-orange-800/50">
        Pro
      </span>
    );
  }
  return (
    <span className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 ring-1 ring-zinc-700">
      Free
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-600">{sub}</p>}
    </div>
  );
}

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [data, setData] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    setLoading(true);
    getMemberDetail(token, id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-6 w-32 animate-pulse rounded bg-zinc-800" />
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/50" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/team" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Back to Team
        </Link>
        <p className="mt-6 text-sm text-red-400">{error || "Member not found"}</p>
      </div>
    );
  }

  const topAgentCost = Math.max(...data.agents.map((a) => a.cost_7d), 1e-9);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <Link href="/team" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Back to Team
      </Link>

      {/* Header */}
      <div className="mt-6 flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xl font-bold text-white ring-1 ring-zinc-600">
          {data.name[0]?.toUpperCase() || "?"}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{data.name}</h1>
          <p className="text-sm text-zinc-500">{data.email}</p>
        </div>
        <div className="ml-auto">{tierBadge(data.plan_tier)}</div>
      </div>

      {/* Summary stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Agents" value={String(data.agent_count)} />
        <StatCard label="Spend (7d)" value={`$${data.total_cost_7d.toFixed(2)}`} />
        <StatCard label="Requests (7d)" value={data.total_requests_7d.toLocaleString()} />
        <StatCard
          label="Spend (30d)"
          value={`$${data.total_cost_30d.toFixed(2)}`}
          sub={`${data.total_requests_30d.toLocaleString()} reqs`}
        />
      </div>

      {/* Agent breakdown */}
      <div className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Agents
        </h2>
        {data.agents.length === 0 ? (
          <p className="text-sm text-zinc-500">No agents yet.</p>
        ) : (
          <div className="rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] divide-y divide-zinc-800/60">
            {data.agents.map((agent) => {
              const bar = Math.min(100, (agent.cost_7d / topAgentCost) * 100);
              return (
                <div key={agent.id} className="px-5 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-zinc-100">{agent.name}</p>
                      <p className="mt-0.5 text-sm text-zinc-500">{agent.purpose || "No description"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-400">
                          {agent.model}
                        </span>
                        <span className="text-xs text-zinc-600">{agent.provider}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-semibold tabular-nums text-white">
                        ${agent.cost_7d.toFixed(2)}
                        <span className="ml-1 text-xs font-normal text-zinc-500">7d</span>
                      </p>
                      <p className="text-xs text-zinc-500">
                        {agent.requests_7d.toLocaleString()} reqs
                      </p>
                    </div>
                  </div>

                  {/* Cost bar */}
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-orange-500"
                      style={{ width: `${bar}%` }}
                    />
                  </div>

                  {/* Secondary stats row */}
                  <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-xs font-semibold tabular-nums text-zinc-300">
                        {agent.avg_tokens_7d.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-xs text-zinc-600">avg tokens/req</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold tabular-nums text-zinc-300">
                        ${agent.cost_30d.toFixed(2)}
                      </p>
                      <p className="text-xs text-zinc-600">spend (30d)</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold tabular-nums text-zinc-300">
                        {agent.requests_30d.toLocaleString()}
                      </p>
                      <p className="text-xs text-zinc-600">reqs (30d)</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
