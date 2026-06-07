"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { downloadFile } from "@/lib/download";

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
    costKes: number;
    imageUrl: string | null;
    currentStock: number;
    abcCategory: string | null;
    onOrder: number;
    expectedArrivalAt: string | null;
    leadTimeDays: number | null;
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
  runRate: number;
  onOrder: number;
  expectedArrivalAt: string | null;
  leadTimeDays: number | null;
  sales30Qty: number;
  sales30Revenue: number;
  sales90Qty: number;
  sales90Revenue: number;
  stockValueKes: number; // at cost
  stockRetailKes: number;
  reorderCostKes: number;
  reorderRevenueKes: number;
};

type Summary = {
  productCount: number;
  revenue30: number;
  cogs30: number;
  grossProfit30: number;
  grossMarginPct: number;
  revenue90: number;
  deadStockKes: number; // at cost
  deadStockRetailKes: number;
  activeStockKes: number;
  activeStockRetailKes: number;
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
  const { slug } = useParams<{ slug: string }>();
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [summary, setSummary] = useState<Summary>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("reorder");

  async function load() {
    setLoading(true);
    const res = await apiFetch(slug, "/api/forecast");
    const data = await res.json();
    setPredictions(data.predictions || []);
    setSummary(data.summary || null);
    setMonthly(data.monthlyRevenue || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function rerun() {
    setBusy(true);
    await apiFetch(slug, "/api/forecast/run", { method: "POST" });
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

  const reorderCostKes = reorder.reduce((s, p) => s + p.reorderCostKes, 0);
  const reorderRevenueKes = reorder.reduce((s, p) => s + p.reorderRevenueKes, 0);
  const stockoutCostKes = stockout.reduce((s, p) => s + p.reorderCostKes, 0);
  const deadCostKes = summary?.deadStockKes ?? 0;
  const deadRetailKes = summary?.deadStockRetailKes ?? 0;
  const revenue30 = summary?.revenue30 ?? 0;
  const grossMarginPct = summary?.grossMarginPct ?? 0;

  // Chart max for monthly bars
  const maxMonthlyRev = Math.max(1, ...monthly.map(m => m.revenueKes));

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-base font-semibold tracking-tight">Wezesha Restock OS</span>
            <span className="hidden sm:inline text-2xs text-mute uppercase tracking-[0.18em]">Live</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/shop/${slug}/simulate`} className="btn-ghost">Simulate</Link>
            <Link href={`/shop/${slug}/reports`} className="btn-ghost">Reports</Link>
            <Link href={`/shop/${slug}/purchase-orders`} className="btn-ghost">Purchase Orders</Link>
            <Link href={`/shop/${slug}/promos`} className="btn-ghost">Promos</Link>
            <Link href={`/shop/${slug}/suppliers`} className="btn-ghost">Suppliers</Link>
            <Link href="/pricing" className="btn-ghost">Pricing</Link>
            <Link href="/contact" className="btn-ghost">Contact</Link>
            <Link href={`/shop/${slug}/settings`} className="btn-ghost">Settings</Link>
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
          <Kpi label="30-day revenue" value={`KES ${KESshort(revenue30)}`} hint={`${(grossMarginPct * 100).toFixed(0)}% gross margin`} />
          <Kpi label="Stockouts" value={stockout.length.toString()} hint="At or near zero" tone={stockout.length > 0 ? "alarm" : "default"} />
          <Kpi label="Reorders needed" value={reorder.length.toString()} hint={`KES ${KESshort(reorderCostKes)} to pay suppliers`} tone={reorder.length > 0 ? "warn" : "default"} />
          <Kpi label="Capital tied up in dead stock" value={`KES ${KESshort(deadCostKes)}`} hint={`${dead.length} SKUs · ${KESshort(deadRetailKes)} at retail`} tone={deadCostKes > 200000 ? "warn" : "default"} />
          <Kpi label="Products tracked" value={predictions.length.toString()} hint="Active catalogue" />
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
          <div className="flex items-center gap-2">
            {(tab === "reorder" || tab === "all") && (
              <button
                type="button"
                onClick={() => downloadFile(slug, `/api/forecast/export?tab=${tab}`, `${tab}-${new Date().toISOString().slice(0, 10)}.csv`)}
                className="btn-ghost text-sm whitespace-nowrap"
              >
                Download CSV
              </button>
            )}
            <input
              type="search"
              placeholder="Search products, SKU, brand…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input max-w-sm"
            />
          </div>
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
              <Link href={`/shop/${slug}/settings`} className="btn-accent inline-flex">Go to Settings</Link>
            </div>
          ) : (
            <div className="text-center py-14 text-mute text-sm">Nothing in this tab.</div>
          )
        ) : tab === "reorder" || tab === "stockout" ? (
          <div className="grid gap-3">
            {visible.map(p => <ReorderCard key={p.id} p={p} variant={tab === "stockout" ? "stockout" : "reorder"} />)}
          </div>
        ) : tab === "dead" ? (
          <DeadStockTable predictions={visible} totalCostKes={deadCostKes} totalRetailKes={deadRetailKes} />
        ) : (
          <AllTable predictions={visible} />
        )}

        {tab === "stockout" && stockout.length > 0 && (
          <div className="mt-4 text-2xs text-mute">
            Stockout = at zero or within 3 days. Reorder cost to suppliers: KES {KESshort(stockoutCostKes)}.
          </div>
        )}
        {tab === "reorder" && reorder.length > 0 && (
          <div className="mt-4 text-2xs text-mute">
            Reorder zone = 3–30 days of stock left. Pay suppliers KES {KESshort(reorderCostKes)}, expected sell-through revenue KES {KESshort(reorderRevenueKes)}.
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
  const { slug } = useParams<{ slug: string }>();
  const isOut = variant === "stockout";
  const borderTone = isOut ? "border-status-bad/40 bg-red-50/40" : "border-status-warn/40 bg-amber-50/40";
  return (
    <Link
      href={`/shop/${slug}/dashboard/product/${p.product.id}`}
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

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-3 text-sm">
            <Mini label="Stock" value={p.product.currentStock.toFixed(0)} tone={p.product.currentStock <= 0 ? "bad" : undefined} />
            <Mini label="Run/day" value={p.runRate.toFixed(2)} sub="sales/day" />
            <Mini label="Days left" value={`${p.daysUntilStockout}d`} tone={p.daysUntilStockout < 7 ? "bad" : "default"} />
            <Mini
              label="En route"
              value={p.onOrder.toFixed(0)}
              sub={p.product.expectedArrivalAt ? `ETA ${new Date(p.product.expectedArrivalAt).toLocaleDateString("en-KE")}` : undefined}
            />
            <Mini label="30d forecast" value={p.finalForecast30d.toFixed(0)} />
            <Mini
              label="Reorder qty"
              value={`${p.recommendedQty.toFixed(0)}`}
              sub={`net of en-route · cost KES ${KESshort(p.reorderCostKes)}`}
              tone="accent"
            />
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

function Mini({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "bad" | "accent" }) {
  const v = tone === "bad" ? "text-status-bad" : tone === "accent" ? "text-accent-700" : "";
  return (
    <div>
      <div className="text-2xs text-mute uppercase tracking-wider">{label}</div>
      <div className={`font-semibold num mt-0.5 ${v}`}>{value}</div>
      {sub && <div className="text-2xs text-mute num mt-0.5">{sub}</div>}
    </div>
  );
}

function DeadStockTable({ predictions, totalCostKes, totalRetailKes }: { predictions: Prediction[]; totalCostKes: number; totalRetailKes: number }) {
  const { slug } = useParams<{ slug: string }>();
  return (
    <>
      <div className="card p-5 mb-4 grid grid-cols-2 gap-6">
        <div>
          <div className="text-2xs uppercase tracking-wider text-mute">Capital tied up (cost)</div>
          <div className="text-2xl font-semibold mt-1 num text-status-warn">KES {KES(totalCostKes)}</div>
          <p className="text-2xs text-mute mt-1">{predictions.length} SKUs · zero sales in 90d. This is what you actually paid suppliers — the money that&apos;s not earning a return.</p>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wider text-mute">At retail (if sold full price)</div>
          <div className="text-2xl font-semibold mt-1 num text-ink-soft">KES {KES(totalRetailKes)}</div>
          <p className="text-2xs text-mute mt-1">Realistic recovery is lower — clearance discounts typically 30–50% off retail.</p>
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
                <th className="px-5 py-3 font-medium text-right">Cost / unit</th>
                <th className="px-5 py-3 font-medium text-right">Capital tied up</th>
                <th className="px-5 py-3 font-medium text-right">At retail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {predictions.map(p => (
                <tr key={p.id} className="hover:bg-canvas">
                  <td className="px-5 py-3">
                    <Link href={`/shop/${slug}/dashboard/product/${p.product.id}`} className="font-medium hover:underline">{p.product.title}</Link>
                    <div className="text-2xs text-mute num">{p.product.sku}</div>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{p.product.vendor || "—"}</td>
                  <td className="px-5 py-3 text-ink-soft text-2xs">{p.product.productType || "—"}</td>
                  <td className="px-5 py-3 text-right num">{p.product.currentStock.toFixed(0)}</td>
                  <td className="px-5 py-3 text-right num text-ink-soft">KES {KES(p.product.costKes)}</td>
                  <td className="px-5 py-3 text-right num font-semibold text-status-warn">KES {KES(p.stockValueKes)}</td>
                  <td className="px-5 py-3 text-right num text-ink-soft">KES {KES(p.stockRetailKes)}</td>
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
  const { slug } = useParams<{ slug: string }>();
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
              <th className="px-5 py-3 font-medium text-right">Run/day</th>
              <th className="px-5 py-3 font-medium text-right">En route</th>
              <th className="px-5 py-3 font-medium text-right">Days</th>
              <th className="px-5 py-3 font-medium text-right">30d rev</th>
              <th className="px-5 py-3 font-medium text-right">Reorder</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {predictions.map(p => (
              <tr key={p.id} className="hover:bg-canvas">
                <td className="px-5 py-3">
                  <Link href={`/shop/${slug}/dashboard/product/${p.product.id}`} className="font-medium hover:underline">{p.product.title}</Link>
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
                <td className="px-5 py-3 text-right num">{p.runRate.toFixed(2)}</td>
                <td className="px-5 py-3 text-right num">{p.onOrder > 0 ? p.onOrder.toFixed(0) : "—"}</td>
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
