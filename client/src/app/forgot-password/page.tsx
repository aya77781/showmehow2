"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const supabase = createSupabaseBrowserClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }

    setLoading(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${window.location.origin}/reset-password` },
      );
      if (resetErr) throw resetErr;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-8 backdrop-blur">
          <h1 className="text-2xl font-bold mb-1">Reset your password</h1>
          <p className="text-slate-400 text-sm mb-6">
            We&apos;ll email you a link to set a new password.
          </p>

          {sent ? (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/30 text-green-300 rounded-xl p-4 text-sm">
                If <span className="font-semibold">{email}</span> is registered, a reset link is on its way. Check your inbox (and spam folder).
              </div>
              <Link
                href="/login"
                className="block w-full text-center px-4 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white font-medium rounded-xl transition"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
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
                {loading ? "Sending…" : "Send reset link"}
              </button>

              <Link
                href="/login"
                className="block text-center text-sm text-slate-400 hover:text-white transition"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
