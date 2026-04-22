"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type EmailCheck = "idle" | "checking" | "available" | "taken" | "invalid";

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isRegister, setIsRegister] = useState(
    searchParams.get("tab") === "register",
  );
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(
    searchParams.get("error") === "google_failed"
      ? "Google sign-in failed. Please try again."
      : "",
  );
  const [loading, setLoading] = useState(false);
  const [emailCheck, setEmailCheck] = useState<EmailCheck>("idle");
  const [verificationSent, setVerificationSent] = useState(false);

  const supabase = createSupabaseBrowserClient();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // Debounced email availability check (register mode only)
  useEffect(() => {
    if (!isRegister) {
      setEmailCheck("idle");
      return;
    }
    const email = form.email.trim();
    if (!email) {
      setEmailCheck("idle");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailCheck("invalid");
      return;
    }
    setEmailCheck("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/auth/check-email?email=${encodeURIComponent(email)}`,
        );
        const data = await res.json();
        setEmailCheck(data.exists ? "taken" : "available");
      } catch {
        setEmailCheck("idle");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form.email, isRegister]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerificationSent(false);

    if (!form.email || !form.password) {
      setError("Please fill in all fields");
      return;
    }
    if (isRegister && !form.name) {
      setError("Please enter your name");
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
          options: {
            data: { name: form.name.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (signUpErr) throw signUpErr;

        // If email confirmation is required, no session yet.
        if (!data.session) {
          setVerificationSent(true);
        } else {
          router.push("/dashboard");
          router.refresh();
        }
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
        if (signInErr) throw signInErr;
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { error: googleErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (googleErr) throw googleErr;
    } catch (err) {
      setError((err as Error).message || "Could not connect to Google");
    }
  };

  if (verificationSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center px-4">
        <div className="bg-slate-900/80 border border-white/10 backdrop-blur rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto mb-4">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-emerald-300"
            >
              <path d="M4 4h16v16H4z" />
              <path d="m4 4 8 8 8-8" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Check your email</h2>
          <p className="text-slate-400 mb-6 text-sm">
            We sent a verification link to{" "}
            <span className="text-white font-medium">{form.email}</span>. Click
            the link to activate your account.
          </p>
          <p className="text-slate-500 text-xs mb-6">
            Nothing in your inbox? Check your spam folder.
          </p>
          <button
            onClick={() => {
              setVerificationSent(false);
              setIsRegister(false);
            }}
            className="text-indigo-400 text-sm hover:underline"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center px-4">
      <div className="bg-slate-900/80 border border-white/10 backdrop-blur rounded-2xl shadow-2xl w-full max-w-md p-8">
        <Link href="/" className="text-indigo-400 text-sm hover:underline">
          &larr; Back to home
        </Link>

        <h2 className="text-3xl font-bold text-white mt-4 mb-2">
          {isRegister ? "Create account" : "Welcome back"}
        </h2>
        <p className="text-slate-400 mb-6">
          {isRegister
            ? "Sign up to start generating tutorials"
            : "Sign in to your account"}
        </p>

        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-gray-800 font-medium rounded-xl hover:bg-gray-100 transition mb-6"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {isRegister ? "Sign up with Google" : "Sign in with Google"}
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-slate-500 text-sm">or with email</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <input
              type="text"
              name="name"
              placeholder="Full name"
              value={form.name}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            />
          )}
          <div>
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={form.email}
              onChange={handleChange}
              className={`w-full px-4 py-3 bg-white/5 border text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 transition ${
                isRegister && emailCheck === "taken"
                  ? "border-red-500/50 focus:ring-red-500"
                  : isRegister && emailCheck === "available"
                    ? "border-emerald-500/50 focus:ring-emerald-500"
                    : "border-white/10 focus:ring-indigo-500"
              }`}
            />
            {isRegister && emailCheck === "checking" && (
              <p className="text-slate-500 text-xs mt-1">Checking availability…</p>
            )}
            {isRegister && emailCheck === "available" && (
              <p className="text-emerald-400 text-xs mt-1">✓ Email available</p>
            )}
            {isRegister && emailCheck === "taken" && (
              <p className="text-red-400 text-xs mt-1">
                This email is already registered.{" "}
                <button
                  type="button"
                  onClick={() => setIsRegister(false)}
                  className="underline hover:text-red-300"
                >
                  Sign in instead?
                </button>
              </p>
            )}
          </div>
          <input
            type="password"
            name="password"
            placeholder="Password"
            value={form.password}
            onChange={handleChange}
            autoComplete={isRegister ? "new-password" : "current-password"}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
          />

          {!isRegister && (
            <div className="text-right">
              <Link href="/forgot-password" className="text-xs text-slate-400 hover:text-indigo-300 transition">
                Forgot password?
              </Link>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || (isRegister && emailCheck === "taken")}
            className="w-full py-3 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Loading..."
              : isRegister
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <p className="text-center text-slate-500 text-sm mt-6">
          {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError("");
            }}
            className="text-indigo-400 font-semibold hover:underline"
          >
            {isRegister ? "Sign in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
