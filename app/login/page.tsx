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
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1 — email a 6-digit one-time code (NOT a link: immune to inbox/scanner
  // link-prefetch consuming a one-time magic link, and to the PKCE code-verifier
  // cookie being absent when a link is opened in another browser).
  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("code");
  }

  // Step 2 — verify the code; on success the browser client persists the session
  // and a hard navigation lets the server middleware pick it up.
  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    window.location.href = "/";
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

        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-3">
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
            <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
              {loading ? "Sending…" : "Email me a code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-3">
            <p className="text-sm text-mute">
              We emailed a 6-digit code to <strong>{email}</strong>. Enter it below.
            </p>
            <label className="block text-sm font-medium text-ink-soft" htmlFor="code">
              6-digit code
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="input w-full tracking-widest"
            />
            <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
              {loading ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("email"); setCode(""); setError(null); }}
              className="btn-ghost w-full"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
