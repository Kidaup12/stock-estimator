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

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();
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
  const [forecasting, setForecasting] = useState(false);
  const [forecastResult, setForecastResult] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const shopRes = await apiFetch(slug, "/api/shop").then(r => r.json());
    if (shopRes) {
      setShop(shopRes);
      setForm(f => ({ ...f, name: shopRes.name, shopifyDomain: shopRes.shopifyDomain }));
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

  async function runForecast() {
    setForecasting(true);
    setForecastResult(null);
    try {
      const res = await apiFetch(slug, "/api/forecast/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setForecastResult(`Error: ${data.error}`); return; }
      setForecastResult(`Generated ${data.forecastsCreated} forecasts (run-rate engine with category cover windows + safety cap).`);
    } catch (e) {
      setForecastResult(`Error: ${e instanceof Error ? e.message : "Forecast failed"}`);
    } finally {
      setForecasting(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-7">
        <div className="mb-7">
          <div className="text-2xs uppercase tracking-wider text-mute">Configuration</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Settings</h1>
        </div>

        <div className="card p-5 mb-4 bg-accent-50 border-accent-100">
          <div className="text-2xs uppercase tracking-wider text-accent-700 font-semibold">What you input vs. what&apos;s automatic</div>
          <ul className="text-sm text-ink-soft mt-3 space-y-1.5 leading-relaxed">
            <li>· <strong>Automatic:</strong> daily catalogue + sales sync from Shopify, nightly forecast refresh.</li>
            <li>· <strong>You input occasionally:</strong> <Link href={`/shop/${slug}/suppliers`} className="text-accent-700 hover:underline">suppliers</Link> (lead time + MOQ), <Link href={`/shop/${slug}/promos`} className="text-accent-700 hover:underline">promo calendar</Link>, product lead times + import category on the Products page.</li>
            <li>· <strong>One-time:</strong> Shopify connection + initial catalogue seed below.</li>
          </ul>
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

          <UsersSection slug={slug} />

          <Section
            title="Forecasts"
            description="Re-runs the demand forecast for every product (recency-weighted run rate, category cover windows, 3× best-month safety cap). Recomputes safety stock and reorder points."
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

type Member = { id: string; email: string; role: "OWNER" | "MEMBER"; isYou: boolean };

/** Users — owners add teammates by email (they sign in with the same 6-digit code). */
function UsersSection({ slug }: { slug: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"OWNER" | "MEMBER">("MEMBER");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await apiFetch(slug, "/api/members");
    if (res.ok) {
      const d = await res.json();
      setMembers(d.members ?? []);
    }
  }
  useEffect(() => { load(); }, []);

  const youAreOwner = members.some(m => m.isYou && m.role === "OWNER");

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch(slug, "/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(`Error: ${d.error ?? "could not add"}`); return; }
      setMsg(`${email.trim()} added — they sign in at this URL with their email + code.`);
      setEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.email} from this shop?`)) return;
    const res = await apiFetch(slug, "/api/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId: m.id }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(`Error: ${d.error ?? "could not remove"}`); return; }
    await load();
  }

  return (
    <Section
      title="Users"
      description="Who can sign in to this shop. Owners manage users; members see everything else."
    >
      <div className="divide-y divide-line border border-line rounded-xl overflow-hidden mb-4">
        {members.length === 0 ? (
          <div className="px-4 py-4 text-sm text-mute">Loading team…</div>
        ) : members.map(m => (
          <div key={m.id} className="px-4 py-3 flex items-center gap-3 bg-canvas-raised">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{m.email}{m.isYou && <span className="text-2xs text-mute font-normal"> · you</span>}</div>
            </div>
            <span className={m.role === "OWNER" ? "badge-info" : "badge-mute"}>{m.role === "OWNER" ? "Owner" : "Member"}</span>
            {youAreOwner && !m.isYou && (
              <button onClick={() => remove(m)} className="text-2xs text-mute hover:text-status-bad transition">Remove</button>
            )}
          </div>
        ))}
      </div>

      {youAreOwner && (
        <div className="flex items-end gap-2 flex-wrap">
          <label className="block flex-1 min-w-[220px]">
            <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@shop.co.ke" className="input" />
          </label>
          <label className="block">
            <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">Role</span>
            <select value={role} onChange={e => setRole(e.target.value as "OWNER" | "MEMBER")} className="input w-32">
              <option value="MEMBER">Member</option>
              <option value="OWNER">Owner</option>
            </select>
          </label>
          <button onClick={add} disabled={busy || !email.includes("@")} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
            {busy ? "Adding…" : "Add user"}
          </button>
        </div>
      )}
      {msg && <ResultBanner ok={!msg.startsWith("Error")} message={msg} />}
    </Section>
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
