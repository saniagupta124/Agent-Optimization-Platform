"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push(nextPath.startsWith("/") ? nextPath : "/");
      router.refresh();
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: "rgba(14,113,74,0.18)", border: "1px solid rgba(45,224,128,0.25)" }}>
          <svg width="22" height="24" viewBox="0 0 52 56" fill="none">
            <defs>
              <radialGradient id="lg0i" cx="35%" cy="25%" r="75%">
                <stop offset="0%" stopColor="#2bdb82" />
                <stop offset="45%" stopColor="#1BA86F" />
                <stop offset="100%" stopColor="#084830" />
              </radialGradient>
            </defs>
            <circle cx="16" cy="12" r="12" fill="url(#lg0i)" />
            <circle cx="37" cy="14" r="10" fill="url(#lg0i)" />
            <circle cx="11" cy="36" r="9" fill="url(#lg0i)" />
            <circle cx="34" cy="42" r="8" fill="url(#lg0i)" />
            <ellipse cx="24" cy="27" rx="11" ry="13" fill="url(#lg0i)" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-white" style={{ letterSpacing: "-0.028em" }}>Welcome back</h1>
        <p className="mt-1 text-sm" style={{ color: "#71717a" }}>Sign in to Traeco</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium" style={{ color: "#a1a1aa" }}>Email</label>
          <input
            id="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(27,168,111,0.6)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium" style={{ color: "#a1a1aa" }}>Password</label>
          <input
            id="password" type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(27,168,111,0.6)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
            placeholder="Enter your password"
          />
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #1BA86F 0%, #0E714A 100%)" }}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm" style={{ color: "#52525b" }}>
        Don&apos;t have an account?{" "}
        <Link
          href={nextPath !== "/" ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup"}
          className="font-medium transition hover:opacity-80"
          style={{ color: "#2de080" }}
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm animate-pulse rounded-lg p-8" style={{ background: "rgba(255,255,255,0.03)" }} />}>
      <SignInForm />
    </Suspense>
  );
}
