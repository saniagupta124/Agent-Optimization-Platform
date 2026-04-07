"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense, useEffect, useState } from "react";
import { completeOnboarding, getGitHubConnectUrl, getGitHubStatus } from "../lib/api";

const STEPS = ["welcome", "how_agents_work", "connect_github", "done"] as const;
type Step = typeof STEPS[number];

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [step, setStep] = useState<Step>("welcome");
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState("");
  const [githubConnecting, setGithubConnecting] = useState(false);

  // Load GitHub status on mount
  useEffect(() => {
    if (!token) return;
    getGitHubStatus(token)
      .then((gh) => {
        setGithubConnected(gh.connected);
        setGithubUsername(gh.username);
      })
      .catch(() => {});
  }, [token]);

  // Handle redirect back from GitHub OAuth
  useEffect(() => {
    const githubParam = searchParams.get("github");
    if (githubParam === "connected") {
      if (token) {
        getGitHubStatus(token).then((gh) => {
          setGithubConnected(gh.connected);
          setGithubUsername(gh.username);
        });
      }
      setStep("connect_github");
      router.replace("/onboarding");
    }
  }, [searchParams, token, router]);

  async function handleGitHubConnect() {
    if (!token) return;
    setGithubConnecting(true);
    try {
      const { url } = await getGitHubConnectUrl(token, "/onboarding");
      window.location.href = url;
    } catch {
      setGithubConnecting(false);
    }
  }

  async function handleFinish() {
    if (token) {
      try { await completeOnboarding(token); } catch {}
    }
    router.push("/");
  }

  const stepIndex = STEPS.indexOf(step);
  const progressPct = (stepIndex / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen bg-[#111111] flex items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800 ring-1 ring-zinc-700">
            <Image src="/logo.png" alt="Slash" width={22} height={22} className="object-contain" />
          </div>
          <span className="font-display text-lg font-semibold text-white">TRAECO</span>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="mb-2 flex justify-between text-xs text-zinc-500">
            <span>Step {stepIndex + 1} of {STEPS.length}</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-800">
            <div
              className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Step: Welcome */}
        {step === "welcome" && (
          <div className="rounded-2xl border border-zinc-800 bg-[#1c1c1c] p-8">
            <div className="mb-6">
              <h1 className="font-display text-3xl font-semibold text-white">Welcome to TRAECO</h1>
              <p className="mt-2 text-zinc-400">
                Your AI spend intelligence platform. Let&apos;s get you set up in a few quick steps.
              </p>
            </div>

            <div className="mb-8 space-y-4">
              {[
                { icon: "🔍", title: "Track API Usage", desc: "See exactly what each agent costs, down to the request level." },
                { icon: "💡", title: "Smart Recommendations", desc: "Get model-swap, prompt, and token limit suggestions that protect output quality." },
                { icon: "⚡", title: "One-click Implementation", desc: "Connect GitHub and TRAECO opens pull requests to apply optimizations automatically." },
              ].map((item) => (
                <div key={item.title} className="flex gap-4 rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4">
                  <span className="text-2xl">{item.icon}</span>
                  <div>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="mt-0.5 text-sm text-zinc-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep("how_agents_work")}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-cyan-400 hover:to-emerald-400"
            >
              Get Started
            </button>
          </div>
        )}

        {/* Step: How agents work */}
        {step === "how_agents_work" && (
          <div className="rounded-2xl border border-zinc-800 bg-[#1c1c1c] p-8">
            <div className="mb-6">
              <h2 className="font-display text-2xl font-semibold text-white">How agents work</h2>
              <p className="mt-1 text-sm text-zinc-400">
                An agent is any LLM-powered process you want to track — a chatbot, a pipeline step, a background job.
              </p>
            </div>

            <div className="mb-6 space-y-3">
              {[
                {
                  step: "1",
                  title: "Register an agent",
                  desc: "Go to Agents → Add New Agent. Give it a name, pick your model, and set a quality sensitivity so TRAECO knows how aggressively to optimize.",
                  color: "bg-blue-600",
                },
                {
                  step: "2",
                  title: "Add the SDK token to your code",
                  desc: "After creating an agent you get a unique SDK token. Drop it into your code so TRAECO can attribute every API call to the right agent.",
                  color: "bg-violet-600",
                },
                {
                  step: "3",
                  title: "Watch spend data appear",
                  desc: "Every LLM call is tracked in real time — cost, latency, token counts, model used. Recommendations surface automatically as patterns emerge.",
                  color: "bg-emerald-600",
                },
              ].map((item) => (
                <div key={item.step} className="flex gap-4 rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.color} text-xs font-bold text-white`}>
                    {item.step}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mb-6 rounded-xl border border-zinc-700/40 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-400">
              You can create your first agent any time from the{" "}
              <span className="font-medium text-zinc-200">Agents</span> page in the sidebar. No API keys needed — just the SDK token.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setStep("connect_github")}
                className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-cyan-400 hover:to-emerald-400"
              >
                Next
              </button>
              <button
                onClick={() => setStep("welcome")}
                className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-300 transition hover:bg-zinc-700"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Step: Connect GitHub */}
        {step === "connect_github" && (
          <div className="rounded-2xl border border-zinc-800 bg-[#1c1c1c] p-8">
            <div className="mb-6">
              <h2 className="font-display text-2xl font-semibold text-white">Connect GitHub</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Let TRAECO open pull requests in your repos to apply cost-saving recommendations automatically — no copy-pasting required.
              </p>
            </div>

            {githubConnected ? (
              <div className="mb-6 flex items-center gap-4 rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-700 bg-emerald-950">
                  <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Connected as @{githubUsername}</p>
                  <p className="text-xs text-zinc-400">TRAECO can now open PRs on your repositories.</p>
                </div>
              </div>
            ) : (
              <div className="mb-6 space-y-4">
                <div className="space-y-3">
                  {[
                    "TRAECO detects a cost-saving opportunity (e.g. switch gpt-4o → gpt-4o-mini)",
                    "You click \"Implement\" on the recommendation page",
                    "TRAECO opens a PR in your repo with the exact code change",
                    "You review and merge — done",
                  ].map((text, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm text-zinc-400">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-300">
                        {i + 1}
                      </span>
                      {text}
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleGitHubConnect}
                  disabled={githubConnecting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-800 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  {githubConnecting ? "Redirecting to GitHub..." : "Connect GitHub"}
                </button>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep("done")}
                className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-cyan-400 hover:to-emerald-400"
              >
                {githubConnected ? "Continue" : "Skip for now"}
              </button>
              <button
                onClick={() => setStep("how_agents_work")}
                className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-300 transition hover:bg-zinc-700"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="rounded-2xl border border-zinc-800 bg-[#1c1c1c] p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-950 border border-emerald-800">
              <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="font-display text-2xl font-semibold text-white">You&apos;re all set!</h2>
            <p className="mt-2 text-zinc-400">
              Head to the dashboard to explore your spend data. When you&apos;re ready, add your first agent from the sidebar.
            </p>

            <div className="mt-8 flex flex-col gap-3">
              <button
                onClick={handleFinish}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-cyan-400 hover:to-emerald-400"
              >
                Go to Dashboard
              </button>
              <Link
                href="/agents/new"
                onClick={async () => {
                  if (token) try { await completeOnboarding(token); } catch {}
                }}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 py-3 text-center text-sm font-medium text-zinc-300 transition hover:bg-zinc-700"
              >
                Add my first agent →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}
