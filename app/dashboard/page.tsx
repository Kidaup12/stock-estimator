"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Signal = { label: string; deltaPct: number; emoji: string };

type Prediction = {
  id: string;
  productId: string;
  product: {
    id: string;
    sku: string;
    title: string;
    vendor: string | null;
    productType: string | null;
    priceKes: number;
    imageUrl: string | null;
    currentStock: number;
    abcCategory: string | null;
  };
  finalForecast30d: number;
  layer1Forecast30d: number;
  layer2Adjustment: number;
  daysUntilStockout: number;
  recommendedQty: number;
  safetyStock: number;
  reorderPoint: number;
  confidence: number;
  urgency: "critical" | "high" | "medium" | "low";
  signals: Signal[];
  sales30Qty: number;
  sales30Revenue: number;
  sales90Qty: number;
  sales90Revenue: number;
  stockValueKes: number;
};

type Summary = {
  productCount: number;
  revenue30: number;
  revenue90: number;
  deadStockKes: number;
  activeStockKes: number;
} | null;

type MonthlyRow = { month: string; quantity: number; revenueKes: number };

const KES = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
const KESshort = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
};

type Tab = "reorder" | "stockout" | "dead" | "all";

export default function Dashboard() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [summary, setSummary] = useState<Summary>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("reorder");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/forecast");
    const data = await res.json();
    setPredictions(data.predictions || []);
    setSummary(data.summary || null);
    setMonthly(data.monthlyRevenue || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function rerun() {
    setBusy(true);
    await fetch("/api/forecast/run", { method: "POST" });
    await load();
    setBusy(false);
  }

  const filtered = predictions.filter(p =>
    p.product.title.toLowerCase().includes(search.toLowerCase()) ||
    p.product.sku.toLowerCase().includes(search.toLowerCase()) ||
    (p.product.vendor ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // tab buckets
  const stockout = filtered
    .filter(p => p.product.currentStock <= 0 || p.daysUntilStockout < 3)
    .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);

  const reorder = filtered
    .filter(p =>
      p.recommendedQty > 0 &&
      p.product.currentStock > 0 &&
      p.daysUntilStockout >= 3 &&
      p.daysUntilStockout < 30
    )
    .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);

  const dead = filtered
    .filter(p => p.sales90Qty === 0 && p.product.currentStock > 0)
    .sort((a, b) => b.stockValueKes - a.stockValueKes);

  const all = [...filtered].sort((a, b) => b.sales30Revenue - a.sales30Revenue);

  const visible = tab === "reorder" ? reorder : tab === "stockout" ? stockout : tab === "dead" ? dead : all;

  const reorderValueKes = reorder.reduce((s, p) => s + p.recommendedQty * p.product.priceKes, 0);
  const stockoutValueKes = stockout.reduce((s, p) => s + p.recommendedQty * p.product.priceKes, 0);
  const deadValueKes = summary?.deadStockKes ?? 0;
  const revenue30 = summary?.revenue30 ?? 0;

  // Chart max for monthly bars
  const maxMonthlyRev = Math.max(1, ...monthly.map(m => m.revenueKes));

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-base font-semibold tracking-tight">Beauty Stock OS</span>
            <span className="hidden sm:inline text-2xs text-mute uppercase tracking-[0.18em]">Live</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/reports" className="btn-ghost">Reports</Link>
            <Link href="/promos" className="btn-ghost">Promos</Link>
            <Link href="/suppliers" className="btn-ghost">Suppliers</Link>
            <Link href="/pricing" className="btn-ghost">Pricing</Link>
            <Link href="/settings" className="btn-ghost">Settings</Link>
            <button onClick={rerun} disabled={busy} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
              {busy ? "Running…" : "Re-run forecasts"}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-7">
        <div className="mb-7">
          <div className="text-2xs uppercase tracking-wider text-mute">Beauty Square KE</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Today&apos;s replenishment view</h1>
        </div>

        {/* KPI bar */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-line border border-line rounded-2xl overflow-hidden shadow-soft mb-6">
          <Kpi label="Products tracked" value={predictions.length.toString()} hint="Active catalogue" />
          <Kpi label="30-day revenue" value={`KES ${KESshort(revenue30)}`} hint="Trailing 30 days" />
          <Kpi label="Stockouts" value={stockout.length.toString()} hint="At or near zero" tone={stockout.length > 0 ? "alarm" : "default"} />
          <Kpi label="Reorders needed" value={reorder.length.toString()} hint={`KES ${KESshort(reorderValueKes)} to order`} tone={reorder.length > 0 ? "warn" : "default"} />
          <Kpi label="Dead stock value" value={`KES ${KESshort(deadValueKes)}`} hint={`${dead.length} SKUs not sold in 90d`} tone={deadValueKes > 200000 ? "warn" : "default"} />
        </div>

        {/* Monthly revenue chart */}
        {monthly.length > 0 && (
          <section className="card p-5 mb-6">
            <div className="flex items-end justify-between mb-4">
              <div>
                <div className="text-2xs uppercase tracking-wider text-mute">Last 12 months</div>
                <h2 className="text-base font-semibold tracking-tight mt-0.5">Revenue trend</h2>
              </div>
              <div className="text-2xs text-mute">KES</div>
            </div>
            <div className="flex items-end gap-1.5 h-32">
              {monthly.slice(-12).map(m => {
                const h = (m.revenueKes / maxMonthlyRev) * 100;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 group" title={`${m.month}: KES ${KES(m.revenueKes)}`}>
                    <div className="flex-1 w-full flex items-end">
                      <div
                        className="w-full rounded-t bg-accent-500 group-hover:bg-accent-600 transition"
                        style={{ height: `${h}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-mute num">{m.month.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Tabs */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="inline-flex rounded-xl border border-line bg-canvas-raised p-0.5 shadow-soft">
            <TabBtn active={tab === "reorder"} onClick={() => setTab("reorder")} label="Reorder" count={reorder.length} />
            <TabBtn active={tab === "stockout"} onClick={() => setTab("stockout")} label="Stockout" count={stockout.length} />
            <TabBtn active={tab === "dead"} onClick={() => setTab("dead")} label="Dead stock" count={dead.length} />
            <TabBtn active={tab === "all"} onClick={() => setTab("all")} label="All" count={all.length} />
          </div>
          <input
            type="search"
            placeholder="Search products, SKU, brand…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input max-w-sm"
          />
        </div>

        {loading ? (
          <div className="text-center py-16 text-mute text-sm">Loading…</div>
        ) : visible.length === 0 ? (
          predictions.length === 0 ? (
            <div className="card text-center py-14 px-6">
              <div className="text-2xs uppercase tracking-wider text-mute">No forecasts yet</div>
              <p className="text-ink-soft mt-3 mb-6 max-w-md mx-auto text-sm leading-relaxed">
                Connect a shop and seed your catalogue from Settings.
              </p>
              <Link href="/settings" className="btn-accent inline-flex">Go to Settings</Link>
            </div>
          ) : (
            <div className="text-center py-14 text-mute text-sm">Nothing in this tab.</div>
          )
        ) : tab === "reorder" || tab === "stockout" ? (
          <div className="grid gap-3">
            {visible.map(p => <ReorderCard key={p.id} p={p} variant={tab === "stockout" ? "stockout" : "reorder"} />)}
          </div>
        ) : tab === "dead" ? (
          <DeadStockTable predictions={visible} totalKes={deadValueKes} />
        ) : (
          <AllTable predictions={visible} />
        )}

        {tab === "stockout" && stockout.length > 0 && (
          <div className="mt-4 text-2xs text-mute">
            Stockout column shows products at or within 3 days of zero stock. KES {KESshort(stockoutValueKes)} of urgent order value.
          </div>
        )}
      </div>
    </main>
  );
}

function Kpi({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "warn" | "alarm" }) {
  const valueColor =
    tone === "alarm" ? "text-status-bad" :
    tone === "warn"  ? "text-status-warn" : "";
  return (
    <div className="bg-canvas-raised p-4 sm:p-5">
      <div className="text-2xs uppercase tracking-wider text-mute">{label}</div>
      <div className={`text-2xl font-semibold mt-2 num tracking-tight ${valueColor}`}>{value}</div>
      {hint && <div className="text-2xs text-mute mt-1">{hint}</div>}
    </div>
  );
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 text-sm rounded-lg transition flex items-center gap-2 ${
        active ? "bg-ink text-white" : "text-mute hover:text-ink"
      }`}
    >
      <span>{label}</span>
      <span className={`text-2xs num px-1.5 py-0.5 rounded ${active ? "bg-white/20" : "bg-canvas-tint text-mute"}`}>{count}</span>
    </button>
  );
}

function ReorderCard({ p, variant }: { p: Prediction; variant: "reorder" | "stockout" }) {
  const isOut = variant === "stockout";
  const borderTone = isOut ? "border-status-bad/40 bg-red-50/40" : "border-status-warn/40 bg-amber-50/40";
  return (
    <Link
      href={`/dashboard/product/${p.product.id}`}
      className={`card hover:shadow-lift transition border ${borderTone} block`}
    >
      <div className="p-4 sm:p-5 flex gap-4">
        {p.product.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={p.product.imageUrl} alt={p.product.title} className="w-16 h-16 rounded-xl object-cover border border-line flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">{p.product.title}</div>
              <div className="text-2xs text-mute mt-0.5 num">{p.product.sku} · {p.product.vendor || "—"} · {p.product.productType || "—"}</div>
            </div>
            <span className={`text-2xs uppercase font-semibold tracking-wider px-2 py-1 rounded-md ${
              isOut ? "bg-status-bad text-white" : "bg-status-warn text-white"
            }`}>
              {isOut ? "Stockout" : p.urgency}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-3 mt-3 text-sm">
            <Mini label="Stock" value={p.product.currentStock.toFixed(0)} tone={p.product.currentStock <= 0 ? "bad" : undefined} />
            <Mini label="Days left" value={`${p.daysUntilStockout}d`} tone={p.daysUntilStockout < 7 ? "bad" : "default"} />
            <Mini label="30d forecast" value={p.finalForecast30d.toFixed(0)} />
            <Mini label="Reorder qty" value={`${p.recommendedQty.toFixed(0)} · KES ${KESshort(p.recommendedQty * p.product.priceKes)}`} tone="accent" />
          </div>

          {p.signals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.signals.map((s, i) => (
                <span key={i} className="text-2xs px-2 py-1 rounded-md bg-canvas-tint border border-line text-ink-soft">
                  {s.emoji} {s.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function Mini({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "bad" | "accent" }) {
  const v = tone === "bad" ? "text-status-bad" : tone === "accent" ? "text-accent-700" : "";
  return (
    <div>
      <div className="text-2xs text-mute uppercase tracking-wider">{label}</div>
      <div className={`font-semibold num mt-0.5 ${v}`}>{value}</div>
    </div>
  );
}

function DeadStockTable({ predictions, totalKes }: { predictions: Prediction[]; totalKes: number }) {
  return (
    <>
      <div className="card p-5 mb-4 flex items-center justify-between">
        <div>
          <div className="text-2xs uppercase tracking-wider text-mute">Capital tied up</div>
          <div className="text-2xl font-semibold mt-1 num text-status-warn">KES {KES(totalKes)}</div>
          <p className="text-2xs text-mute mt-1">{predictions.length} SKUs with zero sales in last 90 days. Consider clearance, bundling, or returning to supplier.</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
              <tr>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">Brand</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium text-right">Stock</th>
                <th className="px-5 py-3 font-medium text-right">Price</th>
                <th className="px-5 py-3 font-medium text-right">Tied up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {predictions.map(p => (
                <tr key={p.id} className="hover:bg-canvas">
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/product/${p.product.id}`} className="font-medium hover:underline">{p.product.title}</Link>
                    <div className="text-2xs text-mute num">{p.product.sku}</div>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{p.product.vendor || "—"}</td>
                  <td className="px-5 py-3 text-ink-soft text-2xs">{p.product.productType || "—"}</td>
                  <td className="px-5 py-3 text-right num">{p.product.currentStock.toFixed(0)}</td>
                  <td className="px-5 py-3 text-right num">KES {KES(p.product.priceKes)}</td>
                  <td className="px-5 py-3 text-right num font-semibold text-status-warn">KES {KES(p.stockValueKes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function AllTable({ predictions }: { predictions: Prediction[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
            <tr>
              <th className="px-5 py-3 font-medium">Product</th>
              <th className="px-5 py-3 font-medium">Brand</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium text-center">ABC</th>
              <th className="px-5 py-3 font-medium text-right">Stock</th>
              <th className="px-5 py-3 font-medium text-right">Days</th>
              <th className="px-5 py-3 font-medium text-right">30d rev</th>
              <th className="px-5 py-3 font-medium text-right">Reorder</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {predictions.map(p => (
              <tr key={p.id} className="hover:bg-canvas">
                <td className="px-5 py-3">
                  <Link href={`/dashboard/product/${p.product.id}`} className="font-medium hover:underline">{p.product.title}</Link>
                  <div className="text-2xs text-mute num">{p.product.sku}</div>
                </td>
                <td className="px-5 py-3 text-ink-soft">{p.product.vendor || "—"}</td>
                <td className="px-5 py-3 text-ink-soft text-2xs">{p.product.productType || "—"}</td>
                <td className="px-5 py-3 text-center">
                  <span className={`text-2xs font-semibold px-2 py-0.5 rounded-md border ${
                    p.product.abcCategory === "A" ? "bg-green-50 text-green-700 border-green-200" :
                    p.product.abcCategory === "B" ? "bg-blue-50 text-blue-700 border-blue-200" :
                    "bg-canvas-tint text-ink-soft border-line"
                  }`}>{p.product.abcCategory || "C"}</span>
                </td>
                <td className={`px-5 py-3 text-right num ${p.product.currentStock < 5 ? "text-status-bad font-semibold" : ""}`}>{p.product.currentStock.toFixed(0)}</td>
                <td className={`px-5 py-3 text-right num ${p.daysUntilStockout < 14 ? "text-status-bad font-semibold" : ""}`}>{p.daysUntilStockout}</td>
                <td className="px-5 py-3 text-right num">KES {KESshort(p.sales30Revenue)}</td>
                <td className="px-5 py-3 text-right num font-semibold text-accent-700">{p.recommendedQty > 0 ? p.recommendedQty.toFixed(0) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
