"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type ShopInfo = {
  id: string;
  name: string;
  shopifyDomain: string;
  currency: string;
  hasToken: boolean;
} | null;

type MonthlyContext = {
  id?: string;
  month: string;
  marketingBudget: number | null;
  promotions: string | null;
  seasonalExpectation: string | null;
  cashFlow: string | null;
  notes: string | null;
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const emptyContext: MonthlyContext = {
  month: currentMonth(),
  marketingBudget: null,
  promotions: "",
  seasonalExpectation: "",
  cashFlow: "",
  notes: "",
};

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [shop, setShop] = useState<ShopInfo>(null);
  const [form, setForm] = useState({
    name: "Beauty Square KE",
    shopifyDomain: "beautysquareke.co",
    shopifyAccessToken: "",
  });
  const [context, setContext] = useState<MonthlyContext>(emptyContext);
  const [savingContext, setSavingContext] = useState(false);
  const [contextSaved, setContextSaved] = useState<string | null>(null);
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
    const [shopRes, ctxRes] = await Promise.all([
      apiFetch(slug, "/api/shop").then(r => r.json()),
      apiFetch(slug, "/api/monthly-context").then(r => r.json()),
    ]);
    if (shopRes) {
      setShop(shopRes);
      setForm(f => ({ ...f, name: shopRes.name, shopifyDomain: shopRes.shopifyDomain }));
    }
    const cm = currentMonth();
    const existing = ctxRes.contexts?.find((c: MonthlyContext) => c.month === cm);
    setContext(existing || { ...emptyContext, month: cm });
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveContext() {
    setSavingContext(true);
    setContextSaved(null);
    try {
      const res = await apiFetch(slug, "/api/monthly-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...context,
          marketingBudget: context.marketingBudget,
          promotions: context.promotions || null,
          seasonalExpectation: context.seasonalExpectation || null,
          cashFlow: context.cashFlow || null,
          notes: context.notes || null,
        }),
      });
      if (res.ok) {
        setContextSaved("Saved. Re-run forecasts to apply this month's context.");
      } else {
        const err = await res.json();
        setContextSaved(`Error: ${err.error || "save failed"}`);
      }
    } finally {
      setSavingContext(false);
    }
  }

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm({ ...form, [k]: v });
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch(slug, "/api/shop/test", {
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
      const res = await apiFetch(slug, "/api/shop", {
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
      const res = await apiFetch(slug, "/api/seed", { method: "POST" });
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
      const res = await apiFetch(slug, "/api/forecast/run", { method: "POST" });
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
          <Link href={`/shop/${slug}/dashboard`} className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">
            ← Dashboard
          </Link>
          <div className="flex items-baseline gap-2.5">
            <div className="h-5 w-5 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-sm font-semibold tracking-tight">Wezesha Restock OS</span>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-7">
        <div className="mb-7">
          <div className="text-2xs uppercase tracking-wider text-mute">Configuration</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Settings</h1>
        </div>

        <div className="card p-5 mb-4 bg-accent-50 border-accent-100">
          <div className="text-2xs uppercase tracking-wider text-accent-700 font-semibold">What you input vs. what&apos;s automatic</div>
          <ul className="text-sm text-ink-soft mt-3 space-y-1.5 leading-relaxed">
            <li>· <strong>Automatic:</strong> daily catalogue + sales sync from Shopify, weekly forecast refresh (Mon 6am).</li>
            <li>· <strong>You input monthly:</strong> the context form below (marketing spend, promos, cash flow, big events).</li>
            <li>· <strong>You input occasionally:</strong> <Link href={`/shop/${slug}/suppliers`} className="text-accent-700 hover:underline">suppliers</Link> (lead time + MOQ), <Link href={`/shop/${slug}/promos`} className="text-accent-700 hover:underline">promo calendar</Link>, supplier-per-product on each product page.</li>
            <li>· <strong>One-time:</strong> Shopify connection + initial catalogue seed below.</li>
          </ul>
        </div>

        <div className="space-y-4">
          <Section
            title={`Monthly context — ${context.month}`}
            description="5-minute monthly form. Feeds Layer 2 of the forecast. Lock it in on the 1st of each month."
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <Field
                label="Marketing budget (KES)"
                value={context.marketingBudget?.toString() ?? ""}
                onChange={v => setContext({ ...context, marketingBudget: v ? parseFloat(v) : null })}
                placeholder="e.g. 150000"
                type="number"
              />
              <SelectField
                label="Cash flow expectation"
                value={context.cashFlow || ""}
                onChange={v => setContext({ ...context, cashFlow: v })}
                options={["", "tight", "normal", "flush"]}
              />
              <div className="sm:col-span-2">
                <TextAreaField
                  label="Promotions planned this month"
                  value={context.promotions || ""}
                  onChange={v => setContext({ ...context, promotions: v })}
                  placeholder="e.g. Mid-month WhatsApp drop 15% off fragrance; Madaraka sitewide 20%"
                />
              </div>
              <div className="sm:col-span-2">
                <TextAreaField
                  label="Seasonal expectation"
                  value={context.seasonalExpectation || ""}
                  onChange={v => setContext({ ...context, seasonalExpectation: v })}
                  placeholder="e.g. School holidays starting mid-month, expect lower foot traffic; Mother's Day boost on skincare"
                />
              </div>
              <div className="sm:col-span-2">
                <TextAreaField
                  label="Notes & big events"
                  value={context.notes || ""}
                  onChange={v => setContext({ ...context, notes: v })}
                  placeholder="e.g. New influencer partnership launch; competitor 20% off going on"
                />
              </div>
            </div>
            {contextSaved && (
              <ResultBanner ok={!contextSaved.startsWith("Error")} message={contextSaved} />
            )}
            <div className="mt-5">
              <button onClick={saveContext} disabled={savingContext} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
                {savingContext ? "Saving…" : "Save monthly context"}
              </button>
            </div>
          </Section>

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
              <Link href={`/shop/${slug}/suppliers`} className="btn-ghost justify-center">Suppliers</Link>
              <Link href={`/shop/${slug}/promos`} className="btn-ghost justify-center">Promo calendar</Link>
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

function TextAreaField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">{label}</span>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="input resize-y min-h-[64px]"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input"
      >
        {options.map(o => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
    </label>
  );
}
