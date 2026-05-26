"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState({
    name: "Beauty Square KE",
    shopifyDomain: "beautysquareke.co",
    shopifyAccessToken: "",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok?: boolean; message: string } | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [forecasting, setForecasting] = useState(false);
  const [forecastResult, setForecastResult] = useState<string | null>(null);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm({ ...form, [k]: v });
  }

  async function testAndSave() {
    setTesting(true);
    setTestResult(null);
    try {
      const test = await fetch("/api/shop/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyDomain: form.shopifyDomain,
          shopifyAccessToken: form.shopifyAccessToken,
        }),
      });
      const td = await test.json();
      if (!test.ok) {
        setTestResult({ ok: false, message: td.error || "Failed" });
        return;
      }
      setTestResult({ ok: true, message: `Connected to ${td.shopName}${td.mock ? " (mock mode — no token)" : ""}` });

      const save = await fetch("/api/shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!save.ok) {
        const err = await save.json();
        setTestResult({ ok: false, message: err.error || "Save failed" });
        return;
      }
      setStep(2);
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Network error" });
    } finally {
      setTesting(false);
    }
  }

  async function runSeed() {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setSeedResult(`Error: ${data.error}`); return; }
      setSeedResult(`Seeded ${data.productsSeeded} products and generated 12 months of synthetic sales history.`);
    } catch (e) {
      setSeedResult(`Error: ${e instanceof Error ? e.message : "Seed failed"}`);
    } finally {
      setSeeding(false);
    }
  }

  async function runForecast() {
    setForecasting(true);
    setForecastResult(null);
    try {
      const res = await fetch("/api/forecast/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setForecastResult(`Error: ${data.error}`); return; }
      setForecastResult(`Generated ${data.forecastsCreated} forecasts (Layer 1 SARIMA mock + Layer 2 XGBoost mock).`);
      setStep(3);
    } catch (e) {
      setForecastResult(`Error: ${e instanceof Error ? e.message : "Forecast failed"}`);
    } finally {
      setForecasting(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 flex items-center gap-2">
          {[1, 2, 3].map(n => (
            <div key={n} className={`flex-1 h-2 rounded-full ${step >= n ? "bg-blue-600" : "bg-zinc-200 dark:bg-zinc-800"}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            <h2 className="text-2xl font-bold">Step 1 — Connect Shopify</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Enter your Shopify shop domain. You can leave the access token blank to run in <strong>mock mode</strong> —
              data will be scraped from the public storefront and synthetic sales will be generated for testing.
            </p>

            <div className="mt-6 grid gap-4">
              <Field label="Shop name" value={form.name} onChange={v => update("name", v)} placeholder="Beauty Square KE" />
              <Field label="Shopify domain" value={form.shopifyDomain} onChange={v => update("shopifyDomain", v)} placeholder="yourshop.myshopify.com or yourshop.co" />
              <Field label="Admin API access token (optional in mock mode)" value={form.shopifyAccessToken} onChange={v => update("shopifyAccessToken", v)} placeholder="shpat_…" type="password" />
            </div>

            {testResult && (
              <div className={`mt-4 p-3 rounded text-sm ${testResult.ok ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"}`}>
                {testResult.message}
              </div>
            )}

            <button
              onClick={testAndSave}
              disabled={testing || !form.name || !form.shopifyDomain}
              className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-semibold py-3 rounded transition"
            >
              {testing ? "Testing connection…" : "Test & Continue"}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            <h2 className="text-2xl font-bold">Step 2 — Seed catalog & generate forecasts</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              First we&apos;ll pull your product catalog (mock: scrapes beautysquareke.co) and generate 365 days of synthetic
              sales with Kenya-specific patterns (payday weeks, V-Day, Jamhuri, Christmas). Then we generate forecasts.
            </p>

            <div className="mt-6 grid gap-3">
              <button onClick={runSeed} disabled={seeding} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-semibold py-3 rounded transition">
                {seeding ? "Seeding catalog (30–60s)…" : "1. Seed catalog"}
              </button>
              {seedResult && (
                <div className={`p-3 rounded text-sm ${seedResult.startsWith("Error") ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200"}`}>
                  {seedResult}
                </div>
              )}

              <button onClick={runForecast} disabled={forecasting || !seedResult || seedResult.startsWith("Error")} className="w-full bg-pink-600 hover:bg-pink-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-semibold py-3 rounded transition">
                {forecasting ? "Running forecasts…" : "2. Generate forecasts"}
              </button>
              {forecastResult && (
                <div className={`p-3 rounded text-sm ${forecastResult.startsWith("Error") ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200"}`}>
                  {forecastResult}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            <h2 className="text-2xl font-bold">All set</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {forecastResult}
            </p>
            <button onClick={() => router.push("/dashboard")} className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded transition">
              Open Dashboard
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>
  );
}
