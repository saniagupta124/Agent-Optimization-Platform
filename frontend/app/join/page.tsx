"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { previewTeamInvite, acceptTeamInvite } from "../lib/api";

type State = "loading" | "preview" | "accepting" | "done" | "error" | "invalid";

export default function JoinPage() {
  const { data: session, status } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const searchParams = useSearchParams();
  const router = useRouter();
  const inviteToken = searchParams.get("token") ?? "";

  const [state, setState] = useState<State>("loading");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!inviteToken) { setState("invalid"); return; }
    previewTeamInvite(inviteToken)
      .then((res) => {
        if (!res.valid) {
          setError(res.expired ? "This invite link has expired." : "This invite link is invalid.");
          setState("error");
        } else {
          setTeamName(res.team_name ?? "");
          setState("preview");
        }
      })
      .catch(() => { setError("Could not load invite details."); setState("error"); });
  }, [inviteToken]);

  async function handleAccept() {
    if (!token) {
      signIn(undefined, { callbackUrl: `/join?token=${encodeURIComponent(inviteToken)}` });
      return;
    }
    setState("accepting");
    try {
      await acceptTeamInvite(token, inviteToken);
      setState("done");
      setTimeout(() => router.push("/team"), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not accept invite.");
      setState("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "#1B1B1D" }}>
      <div
        className="w-full max-w-sm rounded-2xl border p-8"
        style={{ background: "#18181B", borderColor: "#2a2a2a" }}
      >
        {/* Logo */}
        <div className="mb-6 flex justify-center">
          <svg width="20" height="22" viewBox="0 0 52 56" fill="none">
            <defs><radialGradient id="lg0" cx="35%" cy="25%" r="75%">
              <stop offset="0%" stopColor="#2bdb82"/>
              <stop offset="45%" stopColor="#1BA86F"/>
              <stop offset="100%" stopColor="#084830"/>
            </radialGradient></defs>
            <circle cx="16" cy="12" r="12" fill="url(#lg0)"/>
            <circle cx="37" cy="14" r="10" fill="url(#lg0)"/>
            <circle cx="11" cy="36" r="9" fill="url(#lg0)"/>
            <circle cx="34" cy="42" r="8" fill="url(#lg0)"/>
            <ellipse cx="24" cy="27" rx="11" ry="13" fill="url(#lg0)"/>
          </svg>
        </div>

        {state === "loading" && (
          <p className="text-center text-sm text-zinc-500">Checking invite…</p>
        )}

        {state === "preview" && (
          <>
            <h1 className="mb-1 text-center text-xl font-semibold text-white">
              You&apos;re invited
            </h1>
            <p className="mb-6 text-center text-sm text-zinc-400">
              Join <span className="font-medium text-white">{teamName}</span> on Traeco
            </p>
            {status === "unauthenticated" && (
              <p className="mb-4 text-center text-xs text-zinc-500">
                You&apos;ll be asked to sign in or create an account first.
              </p>
            )}
            <button
              onClick={handleAccept}
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition"
              style={{ background: "#1BA86F" }}
            >
              Accept invite
            </button>
          </>
        )}

        {state === "accepting" && (
          <p className="text-center text-sm text-zinc-400">Joining team…</p>
        )}

        {state === "done" && (
          <>
            <p className="text-center text-sm font-medium text-emerald-400">
              You&apos;ve joined {teamName}.
            </p>
            <p className="mt-1 text-center text-xs text-zinc-500">Redirecting…</p>
          </>
        )}

        {(state === "error" || state === "invalid") && (
          <>
            <h1 className="mb-2 text-center text-lg font-semibold text-white">
              {state === "invalid" ? "No invite token" : "Invite unavailable"}
            </h1>
            <p className="text-center text-sm text-zinc-400">
              {error || "Ask the team owner for a new link."}
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-6 w-full rounded-xl border py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
              style={{ borderColor: "#2a2a2a" }}
            >
              Go to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
