"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { deleteAccount, getProfile, updateProfile, UserProfile } from "../../lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!token) return;
    getProfile(token)
      .then((p) => {
        setProfile(p);
        setName(p.name);
        setOrganization(p.organization_name);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaved(false);
    setError("");

    try {
      const updated = await updateProfile(token, {
        name,
        organization_name: organization,
      });
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
        <div className="h-8 w-32 animate-pulse rounded bg-gray-800" />
        <div className="mt-8 space-y-6">
          <div className="h-20 animate-pulse rounded-xl border border-gray-800 bg-gray-900" />
          <div className="h-20 animate-pulse rounded-xl border border-gray-800 bg-gray-900" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">
          Manage your account and preferences
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Profile section */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Profile</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              disabled
              value={profile?.email || ""}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-500"
            />
          </div>

          <div>
            <label htmlFor="plan" className="mb-1.5 block text-sm font-medium text-gray-400">
              Plan
            </label>
            <input
              id="plan"
              type="text"
              disabled
              value={profile?.plan_tier ?? "free"}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm capitalize text-gray-400"
            />
            <p className="mt-1 text-xs text-gray-500">
              Token and spend limits apply per calendar month (see dashboard).
            </p>
          </div>

          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-gray-300">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <div id="organization" className="scroll-mt-24">
            <label htmlFor="org" className="mb-1.5 block text-sm font-medium text-gray-300">
              Organization
            </label>
            <input
              id="org"
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
              placeholder="e.g. Acme Labs"
            />
            <p className="mt-1 text-xs text-gray-500">
              Use the same name across teammates to unlock <strong className="font-medium text-gray-400">Team</strong> spend on the dashboard.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-orange-950/30 transition hover:from-orange-400 hover:to-orange-500 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saved && (
              <span className="text-sm text-green-400">Saved!</span>
            )}
          </div>
        </form>
      </div>

      {/* Danger zone */}
      <div className="mt-8 rounded-xl border border-red-900/50 bg-gray-900 p-6">
        <h2 className="mb-2 text-lg font-semibold text-red-400">
          Danger Zone
        </h2>
        <p className="mb-4 text-sm text-gray-400">
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
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
