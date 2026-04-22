"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const plans = [
  {
    id: "free",
    name: "Free",
    price: "0",
    period: "",
    description: "Try it out",
    perVideo: null,
    features: ["1 video tutorial", "AI script generation", "Real screenshots + highlights", "Download MP4", "Videos are public (SEO)"],
    cta: "Current Plan",
    popular: false,
    badge: null,
    disabled: true,
  },
  {
    id: "pack10",
    name: "Starter",
    price: "5",
    period: "one-time",
    description: "Try the full experience",
    perVideo: "0.50€/video",
    features: ["10 video tutorials", "AI voice narration", "Real screenshots + highlights", "Download MP4", "AI chat tutor", "Make videos private"],
    cta: "Buy Starter",
    popular: false,
    badge: null,
    disabled: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "12",
    period: "one-time",
    description: "Most popular",
    perVideo: "0.40€/video",
    features: ["30 video tutorials", "AI voice narration", "Real screenshots + highlights", "Download MP4", "AI chat tutor", "Make videos private", "Priority generation"],
    cta: "Buy Pro",
    popular: true,
    badge: "Save 20%",
    disabled: false,
  },
  {
    id: "studio",
    name: "Studio",
    price: "25",
    period: "one-time",
    description: "For creators & teams",
    perVideo: "0.33€/video",
    features: ["75 video tutorials", "AI voice narration", "Real screenshots + highlights", "Download MP4", "AI chat tutor", "Make videos private", "Priority generation", "Best price per video"],
    cta: "Buy Studio",
    popular: false,
    badge: "Save 33%",
    disabled: false,
  },
];

export default function Pricing() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><span className="text-slate-500">Loading...</span></div>}>
      <PricingInner />
    </Suspense>
  );
}

function PricingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<string | null>(null);
  const [userPlan, setUserPlan] = useState<any>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      const logged = !!data.session;
      setIsLoggedIn(logged);
      if (logged) {
        api.get("/api/stripe/status").then(({ data }) => setUserPlan(data)).catch(() => {});
      }
    });
  }, []);

  const cancelled = searchParams.get("payment") === "cancelled";

  const handleCheckout = async (plan: string) => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    setLoading(plan);
    try {
      const { data } = await api.post("/api/stripe/checkout", { plan });
      window.location.href = data.url;
    } catch (err: any) {
      alert(err.response?.data?.error || "Checkout failed");
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <a href="/dashboard" className="text-lg sm:text-xl font-bold">ShowMe<span className="text-indigo-400">How</span><span className="text-indigo-300 font-normal text-[0.7em]">.ai</span></a>
          {isLoggedIn ? (
            <div className="flex items-center gap-3">
              <a href="/dashboard" className="px-3 py-1.5 text-sm bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition">Dashboard</a>
            </div>
          ) : (
            <a href="/login" className="px-3 py-1.5 text-sm bg-indigo-500 rounded-lg hover:bg-indigo-400 transition font-medium">Sign In</a>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">Simple pricing</h1>
          <p className="text-slate-400 text-base sm:text-lg max-w-xl mx-auto">
            Generate AI video tutorials with real screenshots and AI voice narration. One-time packs, no subscription.
          </p>
        </div>

        {cancelled && (
          <div className="max-w-md mx-auto mb-8 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-sm text-center">
            Payment was cancelled. Choose a plan to try again.
          </div>
        )}

        {/* Plans */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {plans.map((plan) => {
            const isCurrent = userPlan?.plan === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-6 flex flex-col transition ${
                  plan.popular
                    ? "border-indigo-500/50 bg-indigo-500/5 shadow-lg shadow-indigo-500/10"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-full whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                {plan.badge && !plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-full whitespace-nowrap">
                    {plan.badge}
                  </div>
                )}

                <div className="mb-5">
                  <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                  <p className="text-slate-500 text-sm">{plan.description}</p>
                </div>

                <div className="mb-5">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">&euro;{plan.price}</span>
                    <span className="text-slate-500 text-sm">{plan.period}</span>
                  </div>
                  {plan.perVideo && (
                    <p className="text-xs text-emerald-400 mt-1 font-medium">{plan.perVideo}</p>
                  )}
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <svg className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-slate-300">{f}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <button disabled className="w-full py-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 font-medium text-sm">
                    Current Plan
                  </button>
                ) : plan.disabled ? (
                  <button disabled className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-600 font-medium text-sm cursor-default">
                    {plan.cta}
                  </button>
                ) : (
                  <button
                    onClick={() => handleCheckout(plan.id)}
                    disabled={loading === plan.id}
                    className={`w-full py-2.5 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 ${
                      plan.popular
                        ? "bg-indigo-500 text-white hover:bg-indigo-400"
                        : "bg-white/5 border border-white/10 text-white hover:bg-white/10"
                    } disabled:opacity-50`}
                  >
                    {loading === plan.id ? (
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : plan.cta}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* FAQ */}
        <div className="mt-16 max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-center mb-6">FAQ</h2>
          <div className="space-y-4">
            {[
              { q: "What do I get with a video tutorial?", a: "One complete AI-generated video tutorial: AI writes the script, finds and validates real screenshots, highlights key UI elements, and an AI voice narrates everything. You download the final MP4." },
              { q: "Do credits expire?", a: "No — credits never expire. Buy a pack and use the videos whenever you want." },
              { q: "What payment methods do you accept?", a: "All major credit/debit cards via Stripe. Apple Pay and Google Pay are also supported." },
            ].map(({ q, a }) => (
              <details key={q} className="group border border-white/5 rounded-xl bg-white/[0.02]">
                <summary className="px-5 py-3 text-sm font-medium cursor-pointer hover:text-indigo-400 transition list-none flex items-center justify-between">
                  {q}
                  <svg className="w-4 h-4 text-slate-600 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
                </summary>
                <p className="px-5 pb-4 text-slate-400 text-sm leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>

        <p className="text-center text-slate-700 text-xs mt-12">
          Payments processed securely by Stripe. Prices in EUR.
        </p>
      </main>
    </div>
  );
}
