"use client";

import { useEffect, useState, type MouseEvent } from "react";
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
  activeOrder: { id: string; orderedQty: number | null; orderedAt: string | null; expectedArrivalAt: string | null } | null;
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

/** Human "N min ago" from an ISO timestamp — for the buy-list freshness stamp. */
function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type Tab = "reorder" | "stockout" | "dead" | "all" | "onway";

export default function Dashboard() {
  const { slug } = useParams<{ slug: string }>();
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [summary, setSummary] = useState<Summary>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [shopName, setShopName] = useState("");
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("reorder");
  // Multi-select for bulk "Mark as ordered" on the reorder/stockout tables.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    setLoading(true);
    const [res, shop, status] = await Promise.all([
      apiFetch(slug, "/api/forecast"),
      apiFetch(slug, "/api/shop").then(r => (r.ok ? r.json() : null)).catch(() => null),
      apiFetch(slug, "/api/shop/status").then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const data = await res.json();
    setPredictions(data.predictions || []);
    setSummary(data.summary || null);
    setMonthly(data.monthlyRevenue || []);
    setShopName(shop?.name ?? "");
    setLastRunAt(status?.forecast?.lastRunAt ?? null);
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

  // tab buckets — items already marked "ordered" drop out of reorder/stockout (they're on
  // the way), and a product with NO run rate is never an emergency: zero sales + zero
  // stock is a dead listing, not a stockout (Dave, 2026-06-11).
  const stockout = filtered
    .filter(p => !p.activeOrder && p.runRate > 0 && (p.product.currentStock <= 0 || p.daysUntilStockout < 3))
    .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);

  const reorder = filtered
    .filter(p =>
      !p.activeOrder &&
      p.runRate > 0 &&
      p.recommendedQty > 0 &&
      p.product.currentStock > 0 &&
      p.daysUntilStockout >= 3 &&
      p.daysUntilStockout < 30
    )
    .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);

  const dead = filtered
    .filter(p => p.sales90Qty === 0 && p.product.currentStock > 0)
    .sort((a, b) => b.stockValueKes - a.stockValueKes);

  const onway = filtered
    .filter(p => p.activeOrder)
    .sort((a, b) => {
      const ea = a.activeOrder?.expectedArrivalAt ? new Date(a.activeOrder.expectedArrivalAt).getTime() : Infinity;
      const eb = b.activeOrder?.expectedArrivalAt ? new Date(b.activeOrder.expectedArrivalAt).getTime() : Infinity;
      return ea - eb;
    });

  const all = [...filtered].sort((a, b) => b.sales30Revenue - a.sales30Revenue);

  const visible = tab === "reorder" ? reorder : tab === "stockout" ? stockout : tab === "dead" ? dead : tab === "onway" ? onway : all;

  const reorderCostKes = reorder.reduce((s, p) => s + p.reorderCostKes, 0);
  const reorderRevenueKes = reorder.reduce((s, p) => s + p.reorderRevenueKes, 0);
  const stockoutCostKes = stockout.reduce((s, p) => s + p.reorderCostKes, 0);
  const deadCostKes = summary?.deadStockKes ?? 0;
  const deadRetailKes = summary?.deadStockRetailKes ?? 0;
  const revenue30 = summary?.revenue30 ?? 0;

  // Chart max for monthly bars
  const maxMonthlyRev = Math.max(1, ...monthly.map(m => m.revenueKes));

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-7">
        <div className="mb-7 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="page-eyebrow">{shopName || " "}</div>
            <h1 className="page-title">Today&apos;s replenishment view</h1>
            <p className="text-2xs text-mute mt-1">
              {lastRunAt ? (
                <>Buy list updated <span className="num">{relativeTime(lastRunAt)}</span> · refreshes automatically after each sync</>
              ) : (
                <>Buy list refreshes automatically after each sync</>
              )}
            </p>
          </div>
          <button
            onClick={rerun}
            disabled={busy}
            title="Refresh now — recompute from the latest sales & stock"
            aria-label="Refresh buy list now"
            className="btn-ghost h-9 w-9 p-0 grid place-items-center disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={busy ? "animate-spin" : ""} aria-hidden="true">
              <path d="M13.6 8a5.6 5.6 0 1 1-1.64-3.96" />
              <path d="M13.8 2.4V5h-2.6" />
            </svg>
          </button>
        </div>

        {/* Needs-you-today vs context — the two action metrics lead, the rest stay quiet */}
        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-4 mb-6">
          <div className="card p-5 flex items-stretch divide-x divide-line">
            <button onClick={() => setTab("stockout")} className="flex-1 pr-5 text-left group">
              <div className="text-2xs uppercase tracking-wider text-mute">Stockouts</div>
              <div className={`text-3xl font-semibold mt-1.5 num tracking-tight ${stockout.length > 0 ? "text-status-bad" : "text-status-ok"}`}>
                {stockout.length}
              </div>
              <div className="text-2xs text-mute mt-1 group-hover:text-ink transition-colors">at or near zero stock →</div>
            </button>
            <button onClick={() => setTab("reorder")} className="flex-1 pl-5 text-left group">
              <div className="text-2xs uppercase tracking-wider text-mute">Reorders needed</div>
              <div className={`text-3xl font-semibold mt-1.5 num tracking-tight ${reorder.length > 0 ? "text-status-warn" : "text-status-ok"}`}>
                {reorder.length}
              </div>
              <div className="text-2xs text-mute mt-1 group-hover:text-ink transition-colors">KES {KESshort(reorderCostKes)} to suppliers →</div>
            </button>
          </div>
          <div className="card p-5 grid grid-cols-3 divide-x divide-line">
            <div className="pr-4">
              <div className="text-2xs uppercase tracking-wider text-mute">30-day revenue</div>
              <div className="text-lg font-semibold mt-1.5 num">KES {KESshort(revenue30)}</div>
            </div>
            <div className="px-4">
              <div className="text-2xs uppercase tracking-wider text-mute">Dead stock</div>
              <div className="text-lg font-semibold mt-1.5 num text-ink-soft">KES {KESshort(deadCostKes)}</div>
              <div className="text-2xs text-mute mt-0.5">{dead.length} SKUs at cost</div>
            </div>
            <div className="pl-4">
              <div className="text-2xs uppercase tracking-wider text-mute">Tracked</div>
              <div className="text-lg font-semibold mt-1.5 num text-ink-soft">{predictions.length}</div>
              <div className="text-2xs text-mute mt-0.5">forecasted SKUs</div>
            </div>
          </div>
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
              {monthly.slice(-12).map((m, i, arr) => {
                const h = (m.revenueKes / maxMonthlyRev) * 100;
                const isCurrent = i === arr.length - 1;
                const monthIdx = Number.parseInt(m.month.slice(5), 10) - 1;
                const label = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][monthIdx] ?? m.month.slice(5);
                return (
                  <div key={m.month} className="flex-1 h-full flex flex-col items-center group" title={`${label}: KES ${KES(m.revenueKes)}`}>
                    <div className="flex-1 w-full flex items-end border-b border-line">
                      <div
                        className={`w-full rounded-t-md transition-colors ${isCurrent ? "bg-accent-600" : "bg-accent-200 group-hover:bg-accent-400"}`}
                        style={{ height: `${Math.max(2, h)}%` }}
                      />
                    </div>
                    <div className={`text-[10px] mt-1.5 ${isCurrent ? "text-ink font-medium" : "text-mute"}`}>{label}</div>
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
            <TabBtn active={tab === "onway"} onClick={() => setTab("onway")} label="On the way" count={onway.length} />
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
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input max-w-sm"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 py-4">
            <div className="skeleton h-24" />
            <div className="skeleton h-40" />
            <div className="skeleton h-40" />
          </div>
        ) : visible.length === 0 ? (
          predictions.length === 0 ? (
            <SetupChecklist slug={slug} onRun={rerun} busy={busy} />
          ) : (
            <div className="text-center py-14 text-mute text-sm">Nothing in this tab.</div>
          )
        ) : tab === "reorder" || tab === "stockout" ? (
          <ReorderTable
            rows={visible}
            variant={tab === "stockout" ? "stockout" : "reorder"}
            slug={slug}
            sel={sel}
            setSel={setSel}
            bulkBusy={bulkBusy}
            onBulkOrder={async (items) => {
              setBulkBusy(true);
              try {
                const res = await apiFetch(slug, "/api/orders/bulk", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    items: items.map(p => ({ productId: p.productId, qty: Math.max(1, Math.ceil(p.recommendedQty)) })),
                  }),
                });
                if (res.ok) { setSel(new Set()); await load(); }
              } finally {
                setBulkBusy(false);
              }
            }}
          />
        ) : tab === "onway" ? (
          <div className="grid gap-3">
            {visible.map(p => <OnTheWayCard key={p.id} p={p} onChanged={load} />)}
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
        {tab === "onway" && onway.length > 0 && (
          <div className="mt-4 text-2xs text-mute">
            Items you marked as ordered. Hidden from Reorder until Shopify shows them received — or mark received here.
          </div>
        )}
      </div>
    </main>
  );
}

type ShopStatusLite = {
  products: { total: number; withCost: number };
  suppliers: { count: number };
  shopify: { connected: boolean };
};

/**
 * Empty-state guide shown when a tenant has no forecasts yet. Reads live per-shop
 * status and walks the owner through the few things that unlock recommendations —
 * connect Shopify, sync the catalogue, add costs + suppliers, then run the forecast.
 * Generic across tenants; nothing is hardcoded.
 */
function SetupChecklist({ slug, onRun, busy }: { slug: string; onRun: () => void; busy: boolean }) {
  const [s, setS] = useState<ShopStatusLite | null>(null);

  useEffect(() => {
    apiFetch(slug, "/api/shop/status")
      .then(r => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => setS(null));
  }, [slug]);

  const total = s?.products.total ?? 0;
  const withCost = s?.products.withCost ?? 0;
  const steps = [
    {
      done: !!s?.shopify.connected,
      label: "Connect Shopify",
      detail: s?.shopify.connected ? "connected" : "syncs sales & stock automatically",
      href: `/shop/${slug}/settings`,
    },
    {
      done: total > 0,
      label: "Sync your catalogue",
      detail: total > 0 ? `${total} products` : "seed your products from Settings",
      href: `/shop/${slug}/settings`,
    },
    {
      done: total > 0 && withCost === total,
      label: "Add cost prices",
      detail: total === 0 ? "needed for the buy math" : `${withCost} / ${total} priced — the rest are excluded`,
      href: `/shop/${slug}/products`,
    },
    {
      done: (s?.suppliers.count ?? 0) > 0,
      label: "Add suppliers",
      detail: (s?.suppliers.count ?? 0) > 0 ? `${s?.suppliers.count} set` : "lead times + MOQ per supplier",
      href: `/shop/${slug}/suppliers`,
    },
  ];
  const readyToRun = total > 0 && withCost > 0;
  const doneCount = steps.filter(st => st.done).length;

  return (
    <div className="card max-w-2xl mx-auto p-7">
      <div className="text-2xs uppercase tracking-wider text-mute">Finish setup to get recommendations</div>
      <h2 className="text-lg font-semibold tracking-tight mt-1">A few steps and your buy list is live</h2>
      <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">
        {doneCount} of {steps.length} done. New here? See{" "}
        <Link href={`/shop/${slug}/getting-started`} className="text-accent-700 hover:underline">how it works</Link>.
      </p>

      <ol className="mt-5 divide-y divide-line border border-line rounded-xl overflow-hidden">
        {steps.map((st, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3 bg-canvas-raised">
            <span
              className={`shrink-0 h-5 w-5 rounded-full flex items-center justify-center ${
                st.done ? "bg-status-ok text-white" : "border border-line text-mute"
              }`}
            >
              {st.done ? (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5 5 9l4.5-5" /></svg>
              ) : (
                <span className="text-2xs num">{i + 1}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium ${st.done ? "text-mute line-through" : ""}`}>{st.label}</div>
              <div className="text-2xs text-mute">{st.detail}</div>
            </div>
            {!st.done && (
              <Link href={st.href} className="shrink-0 text-2xs font-medium text-accent-700 hover:underline">Set up →</Link>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-5 flex gap-2 flex-wrap">
        <button
          onClick={onRun}
          disabled={busy || !readyToRun}
          className="btn-accent disabled:bg-mute disabled:hover:bg-mute"
          title={readyToRun ? "" : "Add products and at least one cost price first"}
        >
          {busy ? "Running…" : "Generate forecasts"}
        </button>
        <Link href={`/shop/${slug}/settings`} className="btn-ghost">Open Settings</Link>
      </div>
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

/**
 * Compact multi-select reorder/stockout table (Dave, 2026-06-11): no images,
 * dense rows — see everything without scrolling — tick items, one bulk
 * "Mark N as ordered" action.
 */
function ReorderTable({ rows, variant, slug, sel, setSel, bulkBusy, onBulkOrder }: {
  rows: Prediction[];
  variant: "reorder" | "stockout";
  slug: string;
  sel: Set<string>;
  setSel: (s: Set<string>) => void;
  bulkBusy: boolean;
  onBulkOrder: (items: Prediction[]) => Promise<void>;
}) {
  const isOut = variant === "stockout";
  const checked = rows.filter(p => sel.has(p.productId));
  const checkedCost = checked.reduce((s, p) => s + p.reorderCostKes, 0);
  const allChecked = rows.length > 0 && checked.length === rows.length;

  function toggle(id: string) {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  }
  function toggleAll() {
    setSel(allChecked ? new Set() : new Set(rows.map(p => p.productId)));
  }

  return (
    <div className="space-y-3">
      {checked.length > 0 && (
        <div className="sticky top-2 z-10 p-3 rounded-2xl border border-accent-200 bg-accent-50 shadow-soft flex items-center gap-3 flex-wrap">
          <span className="text-sm text-ink-soft">
            <span className="num font-semibold">{checked.length}</span> selected · KES <span className="num font-semibold">{KESshort(checkedCost)}</span> to suppliers
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setSel(new Set())} className="btn-ghost text-sm">Clear</button>
            <button
              onClick={() => onBulkOrder(checked)}
              disabled={bulkBusy}
              className="btn-accent disabled:bg-mute disabled:hover:bg-mute"
            >
              {bulkBusy ? "Marking…" : `Mark ${checked.length} as ordered`}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
              <tr>
                <th className="pl-4 pr-2 py-2.5 w-8">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" className="accent-[#6d5cd6] h-4 w-4 align-middle" />
                </th>
                <th className="px-3 py-2.5 font-medium">Product</th>
                <th className="px-3 py-2.5 font-medium text-right">Stock</th>
                <th className="px-3 py-2.5 font-medium text-right">Run/day</th>
                <th className="px-3 py-2.5 font-medium text-right">Days left</th>
                <th className="px-3 py-2.5 font-medium text-right">En route</th>
                <th className="px-3 py-2.5 font-medium text-right">Order qty</th>
                <th className="px-5 py-2.5 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(p => {
                const isSel = sel.has(p.productId);
                return (
                  <tr
                    key={p.id}
                    onClick={() => toggle(p.productId)}
                    className={`cursor-pointer transition-colors ${isSel ? "bg-accent-50/60" : "hover:bg-canvas"}`}
                  >
                    <td className="pl-4 pr-2 py-2">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(p.productId)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select ${p.product.title}`}
                        className="accent-[#6d5cd6] h-4 w-4 align-middle"
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[320px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          href={`/shop/${slug}/dashboard/product/${p.product.id}`}
                          onClick={e => e.stopPropagation()}
                          className="font-medium truncate hover:underline"
                        >
                          {p.product.title}
                        </Link>
                        <span className={`shrink-0 ${isOut ? "badge-bad" : p.urgency === "high" ? "badge-warn" : "badge-mute"}`}>
                          {isOut ? "out" : p.urgency}
                        </span>
                      </div>
                      <div className="text-2xs text-mute num">{p.product.sku} · {p.product.vendor || "—"}</div>
                    </td>
                    <td className={`px-3 py-2 text-right num ${p.product.currentStock <= 0 ? "text-status-bad font-semibold" : ""}`}>
                      {p.product.currentStock.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-right num">{p.runRate.toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right num ${p.daysUntilStockout < 7 ? "text-status-bad font-semibold" : ""}`}>
                      {p.daysUntilStockout}d
                    </td>
                    <td className="px-3 py-2 text-right num text-mute">{p.onOrder > 0 ? p.onOrder.toFixed(0) : "—"}</td>
                    <td className="px-3 py-2 text-right num font-semibold text-accent-700">{p.recommendedQty.toFixed(0)}</td>
                    <td className="px-5 py-2 text-right num">KES {KESshort(p.reorderCostKes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OnTheWayCard({ p, onChanged }: { p: Prediction; onChanged: () => void | Promise<void> }) {
  const { slug } = useParams<{ slug: string }>();
  const [busy, setBusy] = useState(false);
  // Captured once per mount so render stays pure (cards remount on every data reload).
  const [now] = useState(() => Date.now());
  const ao = p.activeOrder;
  const eta = ao?.expectedArrivalAt ? new Date(ao.expectedArrivalAt) : null;
  const orderedAt = ao?.orderedAt ? new Date(ao.orderedAt) : null;
  const daysLeft = eta ? Math.ceil((eta.getTime() - now) / 86_400_000) : null;

  async function act(path: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await apiFetch(slug, path, { method: "POST" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Action failed"); return; }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border border-status-ok/30 bg-green-50/30 block">
      <div className="p-4 sm:p-5 flex gap-4">
        {p.product.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={p.product.imageUrl} alt={p.product.title} className="w-16 h-16 rounded-xl object-cover border border-line flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/shop/${slug}/dashboard/product/${p.product.id}`} className="font-medium truncate hover:underline block">{p.product.title}</Link>
              <div className="text-2xs text-mute mt-0.5 num">{p.product.sku} · {p.product.vendor || "—"}</div>
            </div>
            <span className="text-2xs uppercase font-semibold tracking-wider px-2 py-1 rounded-md bg-status-ok text-white">On the way</span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mt-3 text-sm">
            <Mini label="Ordered qty" value={(ao?.orderedQty ?? 0).toFixed(0)} tone="accent" />
            <Mini label="Ordered" value={orderedAt ? orderedAt.toLocaleDateString("en-KE") : "—"} />
            <Mini label="ETA" value={eta ? eta.toLocaleDateString("en-KE") : "—"} />
            <Mini
              label="Arrives in"
              value={daysLeft == null ? "—" : daysLeft < 0 ? "overdue" : `${daysLeft}d`}
              tone={daysLeft != null && daysLeft < 0 ? "bad" : "default"}
            />
            <Mini label="Stock now" value={p.product.currentStock.toFixed(0)} tone={p.product.currentStock <= 0 ? "bad" : undefined} />
          </div>

          <div className="mt-3 flex items-center gap-2 justify-end">
            <button
              onClick={(e) => act(`/api/orders/${ao!.id}/unorder`, e)}
              disabled={busy || !ao}
              className="text-sm px-3 py-1.5 rounded-lg btn-ghost disabled:opacity-50 whitespace-nowrap"
            >
              Undo
            </button>
            <button
              onClick={(e) => act(`/api/orders/${ao!.id}/received`, e)}
              disabled={busy || !ao}
              className="text-sm px-3 py-1.5 rounded-lg bg-status-ok text-white hover:opacity-90 transition disabled:opacity-50 whitespace-nowrap"
            >
              {busy ? "…" : "Mark received"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
                  <div className="flex items-center gap-2">
                    <Link href={`/shop/${slug}/dashboard/product/${p.product.id}`} className="font-medium hover:underline">{p.product.title}</Link>
                    {p.activeOrder && <span className="text-2xs px-1.5 py-0.5 rounded bg-status-ok/10 text-status-ok border border-status-ok/30 whitespace-nowrap">on the way</span>}
                  </div>
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
