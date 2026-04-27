"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { deleteAccount, getProfile, updateProfile, UserProfile, getGitHubStatus, getGitHubConnectUrl, disconnectGitHub } from "../../lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // GitHub connection state
  const [ghConnected, setGhConnected] = useState<boolean | null>(null);
  const [ghUsername, setGhUsername] = useState("");
  const [ghConnecting, setGhConnecting] = useState(false);
  const [ghDisconnecting, setGhDisconnecting] = useState(false);

  useEffect(() => {
    if (!token) return;
    getProfile(token)
      .then((p) => { setProfile(p); setName(p.name); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // Check GitHub status in parallel
    getGitHubStatus(token)
      .then((s) => { setGhConnected(s.connected); setGhUsername(s.username); })
      .catch(() => setGhConnected(false));
  }, [token]);

  // Handle ?github=connected redirect back from OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected" && token) {
      getGitHubStatus(token)
        .then((s) => { setGhConnected(s.connected); setGhUsername(s.username); })
        .catch(() => {});
      window.history.replaceState({}, "", "/settings");
    }
  }, [token]);

  async function handleGitHubConnect() {
    if (!token) return;
    setGhConnecting(true);
    try {
      const { url } = await getGitHubConnectUrl(token, "/settings");
      window.location.href = url;
    } catch {
      setGhConnecting(false);
    }
  }

  async function handleGitHubDisconnect() {
    if (!token) return;
    setGhDisconnecting(true);
    try {
      await disconnectGitHub(token);
      setGhConnected(false);
      setGhUsername("");
    } catch {
    } finally {
      setGhDisconnecting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaved(false);
    setError("");

    try {
      const updated = await updateProfile(token, { name });
      setProfile(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token) return;
    setDeleting(true);
    try {
      await deleteAccount(token);
      await signOut({ callbackUrl: "/signin" });
    } catch (err: any) {
      setError(err?.message || "Failed to delete account");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-8 w-32 animate-pulse rounded bg-[#1e1e1e]" />
        <div className="mt-8 space-y-6">
          <div className="h-20 animate-pulse rounded-xl border border-[#2a2a2a] bg-[#141414]" />
          <div className="h-20 animate-pulse rounded-xl border border-[#2a2a2a] bg-[#141414]" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage your account and preferences
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Profile section */}
      <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Profile</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-zinc-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              disabled
              value={profile?.email || ""}
              className="w-full rounded-lg border border-[#333333] bg-[#1e1e1e] px-3 py-2 text-sm text-zinc-500"
            />
          </div>

          <div>
            <label htmlFor="plan" className="mb-1.5 block text-sm font-medium text-zinc-400">
              Plan
            </label>
            <input
              id="plan"
              type="text"
              disabled
              value={profile?.plan_tier ?? "free"}
              className="w-full rounded-lg border border-[#333333] bg-[#1e1e1e] px-3 py-2 text-sm capitalize text-zinc-400"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Token and spend limits apply per calendar month (see dashboard).
            </p>
          </div>

          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#333333] bg-[#141414] px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">
              Team
            </label>
            {profile?.organization_name ? (
              <div className="flex items-center gap-3">
                <span className="rounded-lg border border-[#333333] bg-[#1e1e1e] px-3 py-2 text-sm text-zinc-300">
                  {profile.organization_name}
                </span>
                <Link href="/team" className="text-xs text-emerald-400 hover:text-emerald-300">
                  Manage →
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-500">Not in a team</span>
                <Link href="/team" className="text-xs text-emerald-400 hover:text-emerald-300">
                  Join or create →
                </Link>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-800 px-5 py-2 text-sm font-medium text-white shadow-lg  transition hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saved && (
              <span className="text-sm text-green-400">Saved!</span>
            )}
          </div>
        </form>
      </div>

      {/* GitHub Integration */}
      <div className="mt-6 rounded-xl border border-[#2a2a2a] bg-[#141414] p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* GitHub icon */}
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[#333333] bg-[#1e1e1e]">
              <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" className="text-zinc-300">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">GitHub</h2>
              <p className="text-xs text-zinc-500">
                {ghConnected
                  ? <>Connected as <span className="text-zinc-300">@{ghUsername}</span></>
                  : "Connect to enable one-click PR creation for recommendations"}
              </p>
            </div>
          </div>

          {ghConnected === null ? (
            <div className="h-4 w-20 animate-pulse rounded bg-[#2a2a2a]" />
          ) : ghConnected ? (
            <button
              onClick={handleGitHubDisconnect}
              disabled={ghDisconnecting}
              className="rounded-lg border border-[#333333] px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-red-800 hover:text-red-400 disabled:opacity-50"
            >
              {ghDisconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <button
              onClick={handleGitHubConnect}
              disabled={ghConnecting}
              className="rounded-lg bg-[#238636] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#2ea043] disabled:opacity-50"
            >
              {ghConnecting ? "Redirecting…" : "Connect GitHub"}
            </button>
          )}
        </div>

        {/* Privacy notice — only shown when not connected */}
        {!ghConnected && ghConnected !== null && (
          <div className="mt-4 rounded-lg border border-[#2a2a2a] bg-[#0d0d0e] px-4 py-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">What Traeco can and cannot do</p>
            <ul className="space-y-1.5">
              {[
                { can: true,  text: "Create a branch in your repo" },
                { can: true,  text: "Add one new file: traeco-changes/{rec-type}.md" },
                { can: true,  text: "Open a draft PR with the recommended change" },
                { can: false, text: "Read any of your existing files or code" },
                { can: false, text: "View your commit history or diffs" },
                { can: false, text: "Push to main or merge anything automatically" },
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  {item.can ? (
                    <svg width={12} height={12} fill="none" stroke="#34D399" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width={12} height={12} fill="none" stroke="#F87171" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  )}
                  <span style={{ color: item.can ? "#A1A1AA" : "#71717A" }}>{item.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-600">
              Your code never leaves your repo. Traeco only writes a markdown guide file — you apply the actual change yourself and close the PR.
            </p>
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="mt-8 rounded-xl border border-red-900/50 bg-[#141414] p-6">
        <h2 className="mb-2 text-lg font-semibold text-red-400">
          Danger Zone
        </h2>
        <p className="mb-4 text-sm text-zinc-400">
          Permanently delete your account and all associated data. This action
          cannot be undone.
        </p>

        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="rounded-lg border border-red-800 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-950/50"
          >
            Delete Account
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Yes, Delete My Account"}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="rounded-lg border border-[#333333] bg-[#1e1e1e] px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-[#2a2a2a]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
