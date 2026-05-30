"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [shopifyDomain, setShopifyDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createShop(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, shopifyDomain: shopifyDomain || null }),
    });
    if (!res.ok) {
      setLoading(false);
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not create your shop. Please try again.");
      return;
    }
    const { slug } = await res.json();
    router.push(`/shop/${slug}/dashboard`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-ink">Create your shop</h1>
          <p className="text-sm text-mute mt-1">Set up your Wezesha workspace to get started.</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-line bg-canvas-tint px-3 py-2 text-sm text-status-bad">
            {error}
          </div>
        )}

        <form onSubmit={createShop} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1" htmlFor="name">
              Shop name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Beauty Square KE"
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1" htmlFor="domain">
              Shopify domain <span className="text-mute font-normal">(optional)</span>
            </label>
            <input
              id="domain"
              type="text"
              value={shopifyDomain}
              onChange={(e) => setShopifyDomain(e.target.value)}
              placeholder="yourshop.co.ke"
              className="input w-full"
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
            {loading ? "Creating…" : "Create shop"}
          </button>
        </form>
      </div>
    </main>
  );
}
