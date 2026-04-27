"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { register } from "../../lib/api";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = (searchParams.get("next") || "").trim();
  const prefillEmail = (searchParams.get("email") || "").trim();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await register({ email, name, password, organization_name: organization });

      const result = await signIn("credentials", { email, password, redirect: false });

      if (result?.error) {
        setError("Account created but sign-in failed. Please try signing in.");
      } else {
        router.push(nextPath && nextPath.startsWith("/") ? nextPath : "/onboarding");
        router.refresh();
      }
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("409") || msg.includes("already registered")) {
        setError("An account with this email already exists");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: "#262628", border: "1px solid #333336" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/traeco-icon.png" alt="Traeco" style={{ height: 28, width: "auto", objectFit: "contain" }} />
        </div>
        <h1 className="text-2xl font-semibold text-white" style={{ letterSpacing: "-0.02em" }}>Create your account</h1>
        <p className="mt-1 text-sm text-[#71717A]">Start optimizing your AI agent spend</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium" style={{ color: "#a1a1aa" }}>Full name</label>
          <input
            id="name" type="text" required value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition"
            style={{ background: "#262628", border: "1px solid #333336" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#1BA86F")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#333336")}
            placeholder="Jane Smith"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium" style={{ color: "#a1a1aa" }}>Email</label>
          <input
            id="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition"
            style={{ background: "#262628", border: "1px solid #333336" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#1BA86F")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#333336")}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="org" className="mb-1.5 block text-sm font-medium" style={{ color: "#a1a1aa" }}>
            Organization <span style={{ color: "#52525b" }}>(optional)</span>
          </label>
          <input
            id="org" type="text" value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition"
            style={{ background: "#262628", border: "1px solid #333336" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#1BA86F")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#333336")}
            placeholder="Acme Inc."
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium" style={{ color: "#a1a1aa" }}>Password</label>
          <input
            id="password" type="password" required minLength={6} value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition"
            style={{ background: "#262628", border: "1px solid #333336" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#1BA86F")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#333336")}
            placeholder="At least 6 characters"
          />
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full rounded-lg py-2.5 text-sm font-semibold transition disabled:opacity-50"
          style={{ background: "#E8A020", color: "#1B1B1D" }}
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[#52525B]">
        Already have an account?{" "}
        <Link
          href={nextPath ? `/signin?next=${encodeURIComponent(nextPath)}` : "/signin"}
          className="font-medium transition hover:opacity-80" style={{ color: "#1BA86F" }}
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm animate-pulse rounded-lg p-8" style={{ background: "rgba(255,255,255,0.03)" }} />}>
      <SignUpForm />
    </Suspense>
  );
}
