"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { getUsageSummary, TopChangeItem, UsageSummary } from "../../lib/api";

function severityLabel(s: string): "High" | "Med" | "Low" {
  const u = s.toLowerCase();
  if (u.includes("high") || u.includes("critical")) return "High";
  if (u.includes("low")) return "Low";
  return "Med";
}

function severityBadgeClass(label: "High" | "Med" | "Low"): string {
  if (label === "High") return "text-[#F87171]";
  if (label === "Low") return "text-[#71717A]";
  return "text-[#FBBF24]";
}

const TYPE_LABELS: Record<string, string> = {
  model_switch: "Model Switch",
  prompt_efficiency: "Prompt Efficiency",
  token_limits: "Token Limits",
};

export default function RecommendationsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [scope, setScope] = useState<"me" | "team">("me");
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    getUsageSummary(token, days, scope)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [token, days, scope]);

  const recs: TopChangeItem[] = summary?.top_changes ?? [];
  const teamAvailable = summary?.team_view_available ?? false;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Recommendations</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Optimization opportunities ranked by estimated monthly impact.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Scope toggle */}
          <div className="inline-flex rounded-full border border-[#2a2a2a] bg-[#161617] p-0.5">
            <button
              type="button"
              onClick={() => setScope("me")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                scope === "me" ? "bg-[#242424] text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              My workspace
            </button>
            <button
              type="button"
              disabled={!teamAvailable}
              onClick={() => teamAvailable && setScope("team")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                scope === "team" ? "bg-[#242424] text-white" : "text-zinc-500 hover:text-zinc-300"
              } ${!teamAvailable ? "cursor-not-allowed opacity-40" : ""}`}
            >
              Team
            </button>
          </div>

          {/* Period */}
          <div className="flex rounded-xl border border-[#2a2a2a] bg-[#161617] p-0.5">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  days === d ? "bg-[#242424] text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Savings summary */}
      {!loading && summary && (
        <div className="mb-8 rounded-xl border border-[#3A3A3F] bg-[#2E2E33] p-6" style={{ borderLeft: "3px solid #34D399" }}>
          <p className="text-lg text-zinc-300">
            You could save{" "}
            <span className="font-semibold" style={{ color: "#1BA86F" }}>
              ${summary.potential_savings_usd.toFixed(2)}/mo
            </span>{" "}
            across {recs.length} recommendation{recs.length !== 1 ? "s" : ""} in the last {days} days.
          </p>
        </div>
      )}

      {/* Recommendations list */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border border-[#2a2a2a] bg-[#141414]/30" />
          ))}
        </div>
      ) : recs.length === 0 ? (
        <div className="rounded-2xl border border-[#2a2a2a]/90 bg-[#161617] p-10 text-center">
          <p className="text-zinc-500">No recommendations yet. Add agents and run them to generate data.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recs.map((ch) => {
            const sev = severityLabel(ch.severity);
            return (
              <Link
                key={`${ch.agent_id}-${ch.type}-${ch.rank}`}
                href={`/recommendations/${ch.type}?agent_id=${ch.agent_id}&days=${days}&scope=${scope}`}
                className="flex flex-col gap-3 rounded-xl border border-[#3A3A3F] bg-[#2E2E33] p-5 transition hover:border-[#4A4A50] hover:bg-[#27272B] sm:flex-row sm:items-start"
              >
                {/* Rank */}
                <span className="text-3xl font-bold tabular-nums text-zinc-700 sm:w-10 sm:shrink-0">
                  {String(ch.rank).padStart(2, "0")}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-zinc-100">{ch.title}</span>
                    <span className={`text-xs font-semibold uppercase tracking-wide ${severityBadgeClass(sev)}`}>
                      {sev}
                    </span>
                    {ch.type && (
                      <span className="rounded bg-[#242424] px-2 py-0.5 text-xs text-zinc-400">
                        {TYPE_LABELS[ch.type] ?? ch.type}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#71717A]">{ch.agent_name}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">{ch.description}</p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-base font-semibold tabular-nums" style={{ color: "#1BA86F" }}>
                    Save ~${ch.estimated_savings_usd.toFixed(2)}/mo
                  </p>
                  <p className="mt-1 text-xs text-[#71717A]">View details →</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
