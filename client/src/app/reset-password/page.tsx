"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  // Supabase puts the recovery tokens in the URL hash. The browser client
  // picks them up automatically and emits PASSWORD_RECOVERY.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setSessionReady(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessionReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      setSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-8 backdrop-blur">
          <h1 className="text-2xl font-bold mb-1">Set a new password</h1>
          <p className="text-slate-400 text-sm mb-6">
            Choose a strong password — at least 8 characters.
          </p>

          {success ? (
            <div className="bg-green-500/10 border border-green-500/30 text-green-300 rounded-xl p-4 text-sm">
              Password updated! Redirecting to your dashboard…
            </div>
          ) : !sessionReady ? (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl p-4 text-sm">
                This link is invalid or has expired. Please request a new reset email.
              </div>
              <Link
                href="/forgot-password"
                className="block w-full text-center px-4 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white font-medium rounded-xl transition"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  New password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Confirm password
                </label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
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
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
