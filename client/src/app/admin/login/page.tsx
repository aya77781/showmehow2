"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">Loading…</div>}>
      <AdminLoginInner />
    </Suspense>
  );
}

function AdminLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { data, error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInErr || !data.user) {
      setError(signInErr?.message || "Login failed");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileErr } = await supabase
      .from("users")
      .select("is_admin")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileErr || !profile?.is_admin) {
      await supabase.auth.signOut();
      setError("This account is not an admin.");
      setLoading(false);
      return;
    }

    router.replace(redirect);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-8 backdrop-blur">
          <h1 className="text-2xl font-bold mb-1">Admin login</h1>
          <p className="text-slate-400 text-sm mb-6">ShowMeHow dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full px-4 py-2 bg-white/5 border border-white/10 text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full px-4 py-2 bg-white/5 border border-white/10 text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>

            <Link
              href="/forgot-password"
              className="block text-center text-xs text-slate-400 hover:text-indigo-300 transition"
            >
              Forgot password?
            </Link>
          </form>
        </div>
      </div>
    </div>
  );
}
