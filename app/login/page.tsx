"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const hadAuthError = searchParams.get("error") === "auth";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"" | "magic" | "google">("");

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading("magic");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setLoading("");
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  async function signInWithGoogle() {
    setError(null);
    setLoading("google");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setLoading("");
      setError(error.message);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-ink">Wezesha Restock OS</h1>
          <p className="text-sm text-mute mt-1">Sign in to your shop dashboard.</p>
        </div>

        {(error || hadAuthError) && (
          <div className="mb-4 rounded-xl border border-line bg-canvas-tint px-3 py-2 text-sm text-status-bad">
            {error ?? "Sign-in failed. Please try again."}
          </div>
        )}

        {sent ? (
          <div className="rounded-xl border border-line bg-accent-50 px-4 py-3 text-sm text-ink">
            Check your email — we sent a magic link to <strong>{email}</strong>. Click it to
            finish signing in.
          </div>
        ) : (
          <>
            <form onSubmit={sendMagicLink} className="space-y-3">
              <label className="block text-sm font-medium text-ink-soft" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@shop.co.ke"
                className="input w-full"
                autoComplete="email"
              />
              <button type="submit" disabled={loading !== ""} className="btn-primary w-full disabled:opacity-60">
                {loading === "magic" ? "Sending…" : "Send magic link"}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-2xs text-mute">
              <span className="h-px flex-1 bg-line" />
              OR
              <span className="h-px flex-1 bg-line" />
            </div>

            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={loading !== ""}
              className="btn-ghost w-full disabled:opacity-60"
            >
              {loading === "google" ? "Redirecting…" : "Continue with Google"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
