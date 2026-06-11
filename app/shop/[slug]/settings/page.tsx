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
  // Start empty — multi-tenant: never seed one shop's identity as the default.
  // load() fills these from GET /api/shop for the resolved tenant.
  const [form, setForm] = useState({
    name: "",
    shopifyDomain: "",
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

        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm text-mute">
            New here? See{" "}
            <Link href={`/shop/${slug}/getting-started`} className="text-accent-700 hover:underline">
              how Wezesha works
            </Link>
            .
          </p>
        </div>

        <StatusGrid slug={slug} />


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

type ShopStatus = {
  products: { total: number; withCost: number; mapped: number; withPrediction: number };
  suppliers: { count: number; withMoq: number };
  members: { count: number };
  shopify: { connected: boolean; lastSyncAt: string | null };
  quickbooks: { connected: boolean };
  forecast: { lastRunAt: string | null };
};

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * Live setup-readiness boxes. Everything is derived per-tenant from GET
 * /api/shop/status — a fresh shop shows empty/grey boxes, a configured one shows
 * its real coverage. No shop is special-cased.
 */
function StatusGrid({ slug }: { slug: string }) {
  const [s, setS] = useState<ShopStatus | null>(null);

  useEffect(() => {
    apiFetch(slug, "/api/shop/status")
      .then(r => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => setS(null));
  }, [slug]);

  const total = s?.products.total ?? 0;
  const missingCost = total - (s?.products.withCost ?? 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
      <StatusBox
        label="Shopify"
        state={!s ? "loading" : s.shopify.connected ? "ok" : "empty"}
        value={!s ? "…" : s.shopify.connected ? "Connected" : "Not connected"}
        detail={
          !s
            ? ""
            : s.shopify.connected
              ? `synced ${relativeTime(s.shopify.lastSyncAt)}`
              : "connect below to sync sales & stock"
        }
      />

      <StatusBox
        label="QuickBooks"
        state={!s ? "loading" : s.quickbooks.connected ? "ok" : "empty"}
        value={!s ? "…" : s.quickbooks.connected ? "Connected" : "Not connected"}
        detail={!s ? "" : s.quickbooks.connected ? "cost & orders syncing" : "pulls cost prices & past orders"}
      />

      <StatusBox
        label="Cost coverage"
        href={`/shop/${slug}/products`}
        action="Review"
        state={!s ? "loading" : total === 0 ? "empty" : missingCost === 0 ? "ok" : "warn"}
        value={!s ? "…" : total === 0 ? "—" : `${s.products.withCost} / ${total}`}
        detail={
          !s
            ? ""
            : total === 0
              ? "no products yet"
              : missingCost === 0
                ? "every product has a cost"
                : `${missingCost} missing a cost — excluded from recommendations`
        }
      />

      <StatusBox
        label="Suppliers & mapping"
        href={`/shop/${slug}/suppliers`}
        action="Manage"
        state={!s ? "loading" : s.suppliers.count === 0 ? "empty" : s.products.mapped < total ? "warn" : "ok"}
        value={!s ? "…" : `${s.suppliers.count} supplier${s.suppliers.count === 1 ? "" : "s"}`}
        detail={
          !s
            ? ""
            : s.suppliers.count === 0
              ? "add suppliers + lead times"
              : `${s.products.mapped} / ${total} products mapped`
        }
      />

      <StatusBox
        label="Pack size / MOQ"
        href={`/shop/${slug}/suppliers`}
        action="Add"
        state={!s ? "loading" : s.suppliers.count === 0 ? "empty" : s.suppliers.withMoq === 0 ? "warn" : "ok"}
        value={!s ? "…" : s.suppliers.count === 0 ? "—" : `${s.suppliers.withMoq} / ${s.suppliers.count}`}
        detail={!s ? "" : s.suppliers.count === 0 ? "set per supplier" : "suppliers with an MOQ set"}
      />

      <StatusBox
        label="Recommendations"
        href={`/shop/${slug}/dashboard`}
        action="View"
        state={!s ? "loading" : s.products.withPrediction === 0 ? "empty" : "ok"}
        value={!s ? "…" : s.products.withPrediction === 0 ? "Not yet" : `${s.products.withPrediction} products`}
        detail={
          !s
            ? ""
            : s.forecast.lastRunAt
              ? `last run ${relativeTime(s.forecast.lastRunAt)}`
              : "run a forecast below"
        }
      />
    </div>
  );
}

type BoxState = "ok" | "warn" | "empty" | "loading";

function StatusBox({
  label,
  value,
  detail,
  state,
  href,
  action,
}: {
  label: string;
  value: string;
  detail: string;
  state: BoxState;
  href?: string;
  action?: string;
}) {
  const dot =
    state === "ok" ? "bg-status-ok" : state === "warn" ? "bg-status-warn" : "bg-mute/40";
  const muted = state === "empty" || state === "loading";
  return (
    <div className={`card p-4 ${muted ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-2xs uppercase tracking-wider text-mute">{label}</span>
      </div>
      <div className="mt-2 text-base font-semibold tracking-tight num">{value}</div>
      {detail && <div className={`text-xs mt-1 leading-snug ${state === "warn" ? "text-status-warn" : "text-mute"}`}>{detail}</div>}
      {href && action && state !== "loading" && (
        <Link href={href} className="inline-block mt-2.5 text-2xs font-medium text-accent-700 hover:underline">
          {action} →
        </Link>
      )}
    </div>
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
