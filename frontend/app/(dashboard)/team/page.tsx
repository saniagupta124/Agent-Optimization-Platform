"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  createTeam,
  createTeamInvite,
  getTeamOverview,
  joinTeam,
  leaveTeam,
  TeamOverview,
} from "../../lib/api";

function tierBadge(tier: string) {
  const t = tier.toLowerCase();
  if (t === "pro") {
    return (
      <span className="rounded-md bg-orange-950/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-orange-300 ring-1 ring-orange-800/50">
        Pro
      </span>
    );
  }
  if (t === "team") {
    return (
      <span className="rounded-md bg-sky-950/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-300 ring-1 ring-sky-800/50">
        Team
      </span>
    );
  }
  return (
    <span className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 ring-1 ring-zinc-700">
      Free
    </span>
  );
}

export default function TeamPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [data, setData] = useState<TeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create / Join form state
  const [mode, setMode] = useState<"create" | "join">("join");
  const [teamName, setTeamName] = useState("");
  const [teamPassword, setTeamPassword] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // Leave confirmation
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState("");

  function fetchTeam() {
    if (!token) return;
    setLoading(true);
    setError(null);
    getTeamOverview(token)
      .then(setData)
      .catch(() => {
        // 404 means no team — that's fine
        setData(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setFormLoading(true);
    try {
      if (mode === "create") {
        await createTeam(token, { name: teamName, password: teamPassword });
      } else {
        await joinTeam(token, { name: teamName, password: teamPassword });
      }
      setTeamName("");
      setTeamPassword("");
      fetchTeam();
    } catch (err: any) {
      setFormError(err?.message || "Failed");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleLeave() {
    if (!token) return;
    setLeaving(true);
    try {
      await leaveTeam(token);
      setData(null);
      setLeaveConfirm(false);
    } catch (err: any) {
      setError(err?.message || "Failed to leave team");
    } finally {
      setLeaving(false);
    }
  }

  const totalSpend = data?.members.reduce((s, m) => s + m.total_cost_7d, 0) ?? 0;
  const totalAgents = data?.members.reduce((s, m) => s + m.agent_count, 0) ?? 0;
  const totalRequests = data?.members.reduce((s, m) => s + m.total_requests_7d, 0) ?? 0;
  const userId = (session as { userId?: string } | undefined)?.userId;
  const isOwner =
    data?.members.some((m) => m.id === userId && m.role === "owner") ?? false;

  async function handleCreateInvite() {
    if (!token) return;
    setInviteErr("");
    setInviteBusy(true);
    try {
      const inv = await createTeamInvite(token, 14);
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const path = `/join?token=${encodeURIComponent(inv.token)}`;
      setInviteUrl(inv.invite_url || (origin ? `${origin}${path}` : path));
    } catch (e: unknown) {
      setInviteErr(e instanceof Error ? e.message : "Could not create invite");
    } finally {
      setInviteBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="mt-8 grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/50" />
          ))}
        </div>
      </div>
    );
  }

  /* ---- No team: show create / join ---- */
  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-white">Team</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Create a new team or join an existing one. Team members can view each
          other&apos;s agent spend on the dashboard.
        </p>

        {/* Toggle */}
        <div className="mt-6 flex rounded-xl border border-zinc-800 bg-[#1c1c1c] p-1">
          <button
            type="button"
            onClick={() => { setMode("join"); setFormError(""); }}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              mode === "join" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Join a team
          </button>
          <button
            type="button"
            onClick={() => { setMode("create"); setFormError(""); }}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              mode === "create" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Create a team
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
              {formError}
            </div>
          )}

          <div>
            <label htmlFor="teamName" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Team Name
            </label>
            <input
              id="teamName"
              type="text"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
              placeholder={mode === "create" ? "e.g. My Company" : "Enter team name"}
            />
          </div>

          <div>
            <label htmlFor="teamPassword" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Team Password
            </label>
            <input
              id="teamPassword"
              type="password"
              required
              value={teamPassword}
              onChange={(e) => setTeamPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
              placeholder={mode === "create" ? "Set a password for your team" : "Enter team password"}
            />
            {mode === "create" && (
              <p className="mt-1.5 text-xs text-zinc-500">
                Share this password with teammates so they can join.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={formLoading}
            className="w-full rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-orange-950/30 transition hover:from-orange-400 hover:to-orange-500 disabled:opacity-50"
          >
            {formLoading
              ? (mode === "create" ? "Creating..." : "Joining...")
              : (mode === "create" ? "Create Team" : "Join Team")}
          </button>
        </form>
      </div>
    );
  }

  /* ---- Has team: show overview ---- */
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-950/40 px-5 py-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mb-8 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-white">Team</h1>
        <span className="rounded-full bg-zinc-800 px-3 py-1 text-sm font-medium text-zinc-300">
          {data.team_name}
        </span>
        <span className="rounded-full bg-zinc-800/60 px-2.5 py-1 text-xs font-medium text-zinc-500">
          {data.members.length} member{data.members.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isOwner && (
        <div className="mb-8 rounded-2xl border border-orange-900/40 bg-[#1c1c1c] p-5">
          <h2 className="text-sm font-semibold text-orange-200">Invite teammates</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Generates a single-use link. For deployed apps, set{" "}
            <code className="rounded bg-zinc-800 px-1 text-zinc-400">PUBLIC_APP_URL</code> on the API
            so the URL is absolute, or copy the path below.
          </p>
          {inviteErr && (
            <p className="mt-2 text-xs text-red-400">{inviteErr}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={inviteBusy}
              onClick={() => void handleCreateInvite()}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {inviteBusy ? "Generating…" : "New invite link"}
            </button>
            {inviteUrl && (
              <input
                readOnly
                value={inviteUrl}
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
              />
            )}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Team Spend (7d)</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">${totalSpend.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Total Agents</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{totalAgents}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/90 bg-[#1c1c1c] p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Requests (7d)</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{totalRequests.toLocaleString()}</p>
        </div>
      </div>

      {/* Members list */}
      <div className="rounded-2xl border border-zinc-800/90 bg-[#1c1c1c]">
        <div className="border-b border-zinc-800/90 px-5 py-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Members</h2>
        </div>
        <ul className="divide-y divide-zinc-800/60">
          {data.members.map((member) => (
            <li key={member.id}>
              <Link
                href={`/team/${member.id}`}
                className="flex items-center gap-4 px-5 py-4 transition hover:bg-zinc-800/40"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-sm font-semibold text-white ring-1 ring-zinc-600">
                  {member.name[0]?.toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">{member.name}</p>
                  <p className="truncate text-xs text-zinc-500">{member.email}</p>
                </div>
                <div className="hidden text-center sm:block sm:w-24">
                  <p className="text-sm font-semibold tabular-nums text-zinc-200">{member.agent_count}</p>
                  <p className="text-xs text-zinc-600">agents</p>
                </div>
                <div className="w-28 text-right">
                  <p className="text-sm font-semibold tabular-nums text-white">${member.total_cost_7d.toFixed(2)}</p>
                  <p className="text-xs text-zinc-600">{member.total_requests_7d.toLocaleString()} reqs</p>
                </div>
                <div className="hidden w-28 shrink-0 text-right sm:block">
                  <span className="mr-2 text-[10px] font-medium uppercase text-zinc-500">
                    {member.role}
                  </span>
                  {tierBadge(member.plan_tier)}
                </div>
                <svg className="h-4 w-4 shrink-0 text-zinc-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Leave team */}
      <div className="mt-8 rounded-xl border border-red-900/50 bg-[#1c1c1c] p-6">
        <h2 className="mb-2 text-lg font-semibold text-red-400">Leave Team</h2>
        <p className="mb-4 text-sm text-zinc-400">
          You will no longer see team spend data or appear in the member list.
        </p>
        {!leaveConfirm ? (
          <button
            onClick={() => setLeaveConfirm(true)}
            className="rounded-lg border border-red-800 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-950/50"
          >
            Leave Team
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {leaving ? "Leaving..." : "Yes, Leave"}
            </button>
            <button
              onClick={() => setLeaveConfirm(false)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
