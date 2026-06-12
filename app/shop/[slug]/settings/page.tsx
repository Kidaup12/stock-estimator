"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useIsOwner } from "@/lib/auth/role-context";
import { apiFetch } from "@/lib/api-fetch";

type ShopInfo = {
  id: string;
  name: string;
  shopifyDomain: string | null;
  currency: string;
  hasToken: boolean;
  source: "shopify" | "odoo";
} | null;

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const owner = useIsOwner(); // Settings are OWNER-only (Dave §7)
  const [shop, setShop] = useState<ShopInfo>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const shopRes = await apiFetch(slug, "/api/shop").then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (shopRes) setShop(shopRes);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (!owner) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Owners only</h1>
          <p className="text-sm text-mute mt-2">Settings are visible to shop owners. Ask an owner for access.</p>
        </div>
      </main>
    );
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
          {/* A shop is EITHER Shopify OR Odoo — show only the one it uses. */}
          {shop?.source === "odoo"
            ? <OdooConnectionCard slug={slug} onChanged={load} />
            : <ShopifyConnectionCard slug={slug} onChanged={load} />}

          <CostUploadCard slug={slug} />

          <UsersSection slug={slug} />

          <Section title="Other settings">
            <Link href={`/shop/${slug}/promos`} className="btn-ghost justify-center">Promo calendar</Link>
          </Section>
        </div>

        {loading && <div className="text-center text-mute text-sm mt-6">Loading…</div>}
      </div>
    </main>
  );
}

/**
 * Shopify store connection. Locked read-only summary once connected (Edit unlocks
 * the fields, Disconnect clears the live token → mock mode). The shop's data source.
 */
function ShopifyConnectionCard({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const [shop, setShop] = useState<ShopInfo>(null);
  const [form, setForm] = useState({ name: "", shopifyDomain: "", shopifyAccessToken: "" });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok?: boolean; message: string } | null>(null);

  async function load() {
    const r = await apiFetch(slug, "/api/shop").then(x => (x.ok ? x.json() : null)).catch(() => null);
    if (r) { setShop(r); setForm(f => ({ ...f, name: r.name ?? "", shopifyDomain: r.shopifyDomain ?? "" })); }
  }
  useEffect(() => { load(); }, []);

  const connected = !!shop?.shopifyDomain;

  function update<K extends keyof typeof form>(k: K, v: string) { setForm({ ...form, [k]: v }); }

  async function testConnection() {
    setTesting(true); setTestResult(null);
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
    } finally { setTesting(false); }
  }

  async function saveShop() {
    setSaving(true);
    try {
      const res = await apiFetch(slug, "/api/shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setForm(f => ({ ...f, shopifyAccessToken: "" })); setEditing(false); await load(); onChanged(); }
    } finally { setSaving(false); }
  }

  async function disconnect() {
    if (!confirm("Disconnect the live Shopify token? The shop falls back to mock mode until you reconnect.")) return;
    await apiFetch(slug, "/api/shop", { method: "DELETE" });
    await load(); onChanged();
  }

  // Locked summary when connected and not editing.
  if (connected && !editing) {
    return (
      <Section title="Shopify connection" description="Your shop's data source — sales, stock and prices sync from here.">
        <div className="text-sm text-ink-soft">
          Connected as <span className="num text-ink">{shop!.shopifyDomain}</span> · {shop!.currency} · {shop!.hasToken ? "live token" : "mock mode"}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setEditing(true)} className="btn-ghost">Edit</button>
          <button onClick={disconnect} className="btn-ghost text-status-bad hover:text-status-bad">Disconnect</button>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Shopify connection"
      description="Leave the access token blank to use mock mode (scrapes the public storefront)."
    >
      <div className="grid gap-4">
        <Field label="Shop name" value={form.name} onChange={v => update("name", v)} />
        <Field label="Shopify domain" value={form.shopifyDomain} onChange={v => update("shopifyDomain", v)} placeholder="yourshop.co or yourshop.myshopify.com" />
        <Field label="Admin API access token (optional)" value={form.shopifyAccessToken} onChange={v => update("shopifyAccessToken", v)} placeholder="shpat_…" type="password" />
      </div>
      {testResult && <ResultBanner ok={!!testResult.ok} message={testResult.message} />}
      <div className="mt-5 flex gap-2 flex-wrap">
        <button onClick={testConnection} disabled={testing || !form.shopifyDomain} className="btn-ghost disabled:opacity-50">
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button onClick={saveShop} disabled={saving || !form.shopifyDomain || !form.name} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
          {saving ? "Saving…" : connected ? "Update" : "Save"}
        </button>
        {connected && <button onClick={() => { setEditing(false); setTestResult(null); }} className="btn-ghost">Cancel</button>}
      </div>
    </Section>
  );
}

/** Connect an Odoo Online store. Locked summary once connected (Edit / Disconnect). */
function OdooConnectionCard({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const [f, setF] = useState({ baseUrl: "", database: "", username: "", apiKey: "" });
  const [connected, setConnected] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    const r = await apiFetch(slug, "/api/odoo").then(x => (x.ok ? x.json() : null)).catch(() => null);
    if (r) {
      setConnected(r.connected);
      setHasKey(r.hasApiKey);
      setLastSyncedAt(r.lastSyncedAt);
      setF(s => ({ ...s, baseUrl: r.baseUrl, database: r.database, username: r.username }));
    }
  }
  useEffect(() => { load(); }, []);

  async function test() {
    setTesting(true); setResult(null);
    try {
      const res = await apiFetch(slug, "/api/odoo/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const d = await res.json();
      setResult(d.ok ? { ok: true, message: `Connected to Odoo (uid ${d.uid}).` } : { ok: false, message: d.error || "Failed" });
    } catch (e) { setResult({ ok: false, message: e instanceof Error ? e.message : "Network error" }); } finally { setTesting(false); }
  }
  async function save() {
    setSaving(true); setResult(null);
    try {
      const res = await apiFetch(slug, "/api/odoo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const d = await res.json();
      if (!res.ok) { setResult({ ok: false, message: d.error || "Failed" }); return; }
      setResult({ ok: true, message: "Saved." });
      setF(s => ({ ...s, apiKey: "" }));
      setEditing(false);
      await load(); onChanged();
    } catch (e) { setResult({ ok: false, message: e instanceof Error ? e.message : "Network error" }); } finally { setSaving(false); }
  }
  async function sync() {
    setSyncing(true); setResult(null);
    try {
      const res = await apiFetch(slug, "/api/odoo/sync", { method: "POST" });
      const d = await res.json();
      setResult(d.ok
        ? { ok: true, message: `Synced ${d.ingest?.products ?? 0} products, ${d.forecastsCreated ?? 0} forecasts (sales source: ${d.ingest?.salesSource ?? "?"}).` }
        : { ok: false, message: d.error || "Sync failed" });
      await load();
    } catch (e) { setResult({ ok: false, message: e instanceof Error ? e.message : "Network error" }); } finally { setSyncing(false); }
  }
  async function disconnect() {
    if (!confirm("Disconnect Odoo? Syncing stops until you reconnect. Your credentials are kept.")) return;
    await apiFetch(slug, "/api/odoo", { method: "DELETE" });
    await load(); onChanged();
  }

  const ready = !!f.baseUrl && !!f.database && !!f.username;

  // Locked summary when connected and not editing.
  if (connected && !editing) {
    return (
      <Section title="Odoo connection" description="Your shop's data source — products, stock, cost, sales and suppliers sync from here (read-only).">
        <div className="text-sm text-ink-soft">
          Connected · <span className="num text-ink">{f.database}</span> · last synced {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "never"}
        </div>
        {result && <ResultBanner ok={result.ok} message={result.message} />}
        <div className="mt-4 flex gap-2 flex-wrap">
          <button onClick={sync} disabled={syncing} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">{syncing ? "Syncing…" : "Sync now"}</button>
          <button onClick={() => setEditing(true)} className="btn-ghost">Edit</button>
          <button onClick={disconnect} className="btn-ghost text-status-bad hover:text-status-bad">Disconnect</button>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Odoo connection" description="Connect an Odoo Online store. Wezesha pulls products, stock, cost, sales and suppliers via Odoo's API (read-only).">
      <div className="grid gap-4">
        <Field label="Instance URL" value={f.baseUrl} onChange={v => setF({ ...f, baseUrl: v })} placeholder="https://yourstore.odoo.com" />
        <Field label="Database name" value={f.database} onChange={v => setF({ ...f, database: v })} placeholder="yourstore" />
        <Field label="Username (login email)" value={f.username} onChange={v => setF({ ...f, username: v })} placeholder="owner@yourstore.com" />
        <Field label={hasKey ? "API key (leave blank to keep saved)" : "API key"} value={f.apiKey} onChange={v => setF({ ...f, apiKey: v })} placeholder="Odoo → My Profile → Account Security → New API Key" type="password" />
      </div>
      {result && <ResultBanner ok={result.ok} message={result.message} />}
      <div className="mt-5 flex gap-2 flex-wrap">
        <button onClick={test} disabled={testing || !ready} className="btn-ghost disabled:opacity-50">{testing ? "Testing…" : "Test connection"}</button>
        <button onClick={save} disabled={saving || !ready} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">{saving ? "Saving…" : connected ? "Update" : "Save"}</button>
        {connected && <button onClick={() => { setEditing(false); setResult(null); }} className="btn-ghost">Cancel</button>}
      </div>
    </Section>
  );
}

type CostResult = { ok?: boolean; updated?: number; matched?: number; unmatched?: number; totalRows?: number; sampleUnmatched?: string[]; error?: string };

/**
 * Cost-of-goods upload. The owner exports product costs from QuickBooks (via the
 * n8n COGS workflow → name,sku,cost CSV) and uploads it here. Matches each row to
 * a product by SKU when present, else by normalized name; writes Product.costKes.
 */
function CostUploadCard({ slug }: { slug: string }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CostResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setRes(null);
  }

  async function upload() {
    if (!csv.trim()) return;
    setBusy(true); setRes(null);
    try {
      const r = await apiFetch(slug, "/api/costs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const d: CostResult = await r.json();
      setRes(d);
      if (r.ok && d.unmatched === 0) { setCsv(""); setFileName(""); if (fileRef.current) fileRef.current.value = ""; }
    } finally { setBusy(false); }
  }

  return (
    <Section
      title="Cost of goods"
      description="Upload a CSV of product costs (columns: name, sku, cost) — e.g. the export from your QuickBooks → COGS workflow. We match by SKU, then by name, and update each product's cost."
    >
      <div className="flex items-center gap-3 flex-wrap">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm file:btn-ghost file:mr-3" />
        <button onClick={upload} disabled={busy || !csv.trim()} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
          {busy ? "Uploading…" : "Upload costs"}
        </button>
        {fileName && <span className="text-2xs text-mute num">{fileName}</span>}
      </div>
      {res && (
        res.error
          ? <ResultBanner ok={false} message={res.error} />
          : <ResultBanner ok={(res.unmatched ?? 0) === 0} message={
              `Updated ${res.updated ?? 0} of ${res.totalRows ?? 0} rows · ${res.unmatched ?? 0} unmatched`
              + (res.sampleUnmatched && res.sampleUnmatched.length ? ` (e.g. ${res.sampleUnmatched.slice(0, 3).join(", ")})` : "")
            } />
      )}
    </Section>
  );
}

type ShopStatus = {
  products: { total: number; withCost: number; withPrediction: number };
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
 * Live setup-readiness boxes — derived per-tenant from GET /api/shop/status. Trimmed
 * to what feeds the buy list across both Shopify and Odoo shops: cost coverage and
 * whether recommendations have been generated. Connection status lives on the card
 * above + the sidebar sync badge.
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
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
              : "syncs generate these automatically"
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

/** Users — collapsed read-only list by default; Manage unlocks add/remove (owners only). */
function UsersSection({ slug }: { slug: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"OWNER" | "MEMBER">("MEMBER");
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);
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
            {managing && youAreOwner && !m.isYou && (
              <button onClick={() => remove(m)} className="text-2xs text-mute hover:text-status-bad transition">Remove</button>
            )}
          </div>
        ))}
      </div>

      {youAreOwner && !managing && (
        <button onClick={() => setManaging(true)} className="btn-ghost">Manage users</button>
      )}

      {youAreOwner && managing && (
        <>
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
            <button onClick={() => { setManaging(false); setMsg(null); }} className="btn-ghost">Done</button>
          </div>
        </>
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
