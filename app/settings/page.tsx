"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ShopInfo = {
  id: string;
  name: string;
  shopifyDomain: string;
  currency: string;
  hasToken: boolean;
} | null;

export default function SettingsPage() {
  const [shop, setShop] = useState<ShopInfo>(null);
  const [form, setForm] = useState({
    name: "Beauty Square KE",
    shopifyDomain: "beautysquareke.co",
    shopifyAccessToken: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok?: boolean; message: string } | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [forecasting, setForecasting] = useState(false);
  const [forecastResult, setForecastResult] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/shop");
    const data = await res.json();
    if (data) {
      setShop(data);
      setForm(f => ({ ...f, name: data.name, shopifyDomain: data.shopifyDomain }));
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm({ ...form, [k]: v });
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/shop/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopifyDomain: form.shopifyDomain, shopifyAccessToken: form.shopifyAccessToken }),
      });
      const data = await res.json();
      if (!res.ok) { setTestResult({ ok: false, message: data.error || "Failed" }); return; }
      setTestResult({ ok: true, message: `Connected to ${data.shopName}${data.mock ? " (mock mode)" : ""}` });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Network error" });
    } finally {
      setTesting(false);
    }
  }

  async function saveShop() {
    setSaving(true);
    try {
      const res = await fetch("/api/shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) await load();
    } finally {
      setSaving(false);
    }
  }

  async function runSeed() {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setSeedResult(`Error: ${data.error}`); return; }
      setSeedResult(`Seeded ${data.productsSeeded} products with 12 months of synthetic sales.`);
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
      setForecastResult(`Generated ${data.forecastsCreated} forecasts (Layer 1 SARIMA + Layer 2 XGBoost — both mock).`);
    } catch (e) {
      setForecastResult(`Error: ${e instanceof Error ? e.message : "Forecast failed"}`);
    } finally {
      setForecasting(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">
            ← Dashboard
          </Link>
          <div className="flex items-baseline gap-2.5">
            <div className="h-5 w-5 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-sm font-semibold tracking-tight">Beauty Stock OS</span>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-7">
        <div className="mb-7">
          <div className="text-2xs uppercase tracking-wider text-mute">Configuration</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Settings</h1>
        </div>

        <div className="space-y-4">
          <Section
            title="Shopify connection"
            description="Leave the access token blank to use mock mode (scrapes the public storefront)."
          >
            <div className="grid gap-4">
              <Field label="Shop name" value={form.name} onChange={v => update("name", v)} />
              <Field label="Shopify domain" value={form.shopifyDomain} onChange={v => update("shopifyDomain", v)} placeholder="yourshop.co or yourshop.myshopify.com" />
              <Field label="Admin API access token (optional)" value={form.shopifyAccessToken} onChange={v => update("shopifyAccessToken", v)} placeholder="shpat_…" type="password" />
            </div>
            {testResult && (
              <ResultBanner ok={!!testResult.ok} message={testResult.message} />
            )}
            <div className="mt-5 flex gap-2 flex-wrap">
              <button onClick={testConnection} disabled={testing || !form.shopifyDomain} className="btn-ghost disabled:opacity-50">
                {testing ? "Testing…" : "Test connection"}
              </button>
              <button onClick={saveShop} disabled={saving || !form.shopifyDomain || !form.name} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
                {saving ? "Saving…" : shop ? "Update" : "Save"}
              </button>
            </div>
            {shop && (
              <div className="mt-4 text-2xs text-mute">
                Connected as <span className="num text-ink-soft">{shop.shopifyDomain}</span> · {shop.currency} · {shop.hasToken ? "with token" : "mock mode"}
              </div>
            )}
          </Section>

          <Section
            title="Catalogue & sales data"
            description="Pulls products and generates synthetic sales history calibrated to Kenya patterns (payday weeks, V-Day, Jamhuri, Christmas, Eid)."
          >
            <button onClick={runSeed} disabled={seeding || !shop} className="btn-primary w-full disabled:bg-mute disabled:hover:bg-mute">
              {seeding ? "Seeding catalogue (30–60s)…" : "Seed / Resync catalogue"}
            </button>
            {seedResult && (
              <ResultBanner ok={!seedResult.startsWith("Error")} message={seedResult} />
            )}
          </Section>

          <Section
            title="Forecasts"
            description="Runs Layer 1 (SARIMA mock) + Layer 2 (XGBoost mock) on every product. Recomputes safety stock and reorder points."
          >
            <button onClick={runForecast} disabled={forecasting || !shop} className="btn-accent w-full disabled:bg-mute disabled:hover:bg-mute">
              {forecasting ? "Running forecasts…" : "Generate / Re-run forecasts"}
            </button>
            {forecastResult && (
              <ResultBanner ok={!forecastResult.startsWith("Error")} message={forecastResult} />
            )}
          </Section>

          <Section title="Other settings">
            <div className="grid grid-cols-2 gap-3">
              <Link href="/suppliers" className="btn-ghost justify-center">Suppliers</Link>
              <Link href="/promos" className="btn-ghost justify-center">Promo calendar</Link>
            </div>
          </Section>
        </div>

        {loading && <div className="text-center text-mute text-sm mt-6">Loading…</div>}
      </div>
    </main>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {description && <p className="text-sm text-ink-soft mt-1.5 mb-5 leading-relaxed">{description}</p>}
      {!description && <div className="mt-4" />}
      {children}
    </section>
  );
}

function ResultBanner({ ok, message }: { ok: boolean; message: string }) {
  const c = ok
    ? "border-status-ok/30 bg-status-ok/5 text-status-ok"
    : "border-status-bad/30 bg-status-bad/5 text-status-bad";
  return (
    <div className={`mt-4 p-3 rounded-xl text-sm border ${c}`}>{message}</div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input"
      />
    </label>
  );
}
