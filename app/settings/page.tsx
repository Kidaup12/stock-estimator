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
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">← Dashboard</Link>
        <h1 className="text-3xl font-bold mt-2 mb-8">Settings</h1>

        <Section title="Shopify connection" description="Leave the access token blank to use mock mode (scrapes the public storefront).">
          <div className="grid gap-4">
            <Field label="Shop name" value={form.name} onChange={v => update("name", v)} />
            <Field label="Shopify domain" value={form.shopifyDomain} onChange={v => update("shopifyDomain", v)} placeholder="yourshop.co or yourshop.myshopify.com" />
            <Field label="Admin API access token (optional)" value={form.shopifyAccessToken} onChange={v => update("shopifyAccessToken", v)} placeholder="shpat_…" type="password" />
          </div>
          {testResult && (
            <div className={`mt-4 p-3 rounded text-sm ${testResult.ok ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"}`}>
              {testResult.message}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={testConnection} disabled={testing || !form.shopifyDomain} className="border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
              {testing ? "Testing…" : "Test connection"}
            </button>
            <button onClick={saveShop} disabled={saving || !form.shopifyDomain || !form.name} className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white px-4 py-2 rounded text-sm font-medium">
              {saving ? "Saving…" : shop ? "Update" : "Save"}
            </button>
          </div>
          {shop && (
            <div className="mt-3 text-xs text-zinc-500">
              Connected as <span className="font-mono">{shop.shopifyDomain}</span> · {shop.currency} · {shop.hasToken ? "with token" : "mock mode"}
            </div>
          )}
        </Section>

        <Section title="Catalog & sales data" description="Pulls products and generates synthetic sales history calibrated to Kenya patterns (payday weeks, V-Day, Jamhuri, Christmas, Eid).">
          <div className="grid gap-3">
            <button onClick={runSeed} disabled={seeding || !shop} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white font-semibold py-3 rounded transition">
              {seeding ? "Seeding catalog (30–60s)…" : "Seed / Resync catalog"}
            </button>
            {seedResult && (
              <div className={`p-3 rounded text-sm ${seedResult.startsWith("Error") ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200"}`}>
                {seedResult}
              </div>
            )}
          </div>
        </Section>

        <Section title="Forecasts" description="Runs Layer 1 (SARIMA mock) + Layer 2 (XGBoost mock) on every product. Recomputes safety stock and reorder points.">
          <div className="grid gap-3">
            <button onClick={runForecast} disabled={forecasting || !shop} className="w-full bg-pink-600 hover:bg-pink-700 disabled:bg-zinc-400 text-white font-semibold py-3 rounded transition">
              {forecasting ? "Running forecasts…" : "Generate / Re-run forecasts"}
            </button>
            {forecastResult && (
              <div className={`p-3 rounded text-sm ${forecastResult.startsWith("Error") ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200"}`}>
                {forecastResult}
              </div>
            )}
          </div>
        </Section>

        <Section title="Other settings">
          <div className="grid grid-cols-2 gap-3">
            <Link href="/suppliers" className="border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 p-4 rounded text-center text-sm font-medium">
              Suppliers
            </Link>
            <Link href="/promos" className="border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 p-4 rounded text-center text-sm font-medium">
              Promo calendar
            </Link>
          </div>
        </Section>

        {loading && <div className="text-center text-zinc-500">Loading…</div>}
      </div>
    </main>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {description && <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 mb-4">{description}</p>}
      {children}
    </section>
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
