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
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: "#262628", border: "1px solid #333336" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Traeco" width={24} height={24} style={{ objectFit: "contain" }} />
        </div>
        <h1 className="text-2xl font-semibold text-white" style={{ letterSpacing: "-0.02em" }}>Welcome back</h1>
        <p className="mt-1 text-sm text-[#71717A]">Sign in to Traeco</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[#A1A1AA]">Email</label>
          <input
            id="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-[#52525B] outline-none transition"
            style={{ background: "#262628", border: "1px solid #333336" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#1BA86F")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#333336")}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[#A1A1AA]">Password</label>
          <input
            id="password" type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-[#52525B] outline-none transition"
            style={{ background: "#262628", border: "1px solid #333336" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#1BA86F")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#333336")}
            placeholder="Enter your password"
          />
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full rounded-lg py-2.5 text-sm font-semibold transition disabled:opacity-50"
          style={{ background: "#E8A020", color: "#1B1B1D" }}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[#52525B]">
        Don&apos;t have an account?{" "}
        <Link
          href={nextPath !== "/" ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup"}
          className="font-medium transition hover:opacity-80" style={{ color: "#1BA86F" }}
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm animate-pulse rounded-lg p-8 bg-[#27272B]" />}>
      <SignInForm />
    </Suspense>
  );
}
