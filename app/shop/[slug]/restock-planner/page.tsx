"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { toCsv, saveTextFile } from "@/lib/csv";

type Facet = { name: string; count: number };

type BudgetItem = {
  predictionId: string;
  productId: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  sku: string;
  imageUrl: string | null;
  recommendedQty: number;
  daysUntilStockout: number;
  urgency: "critical" | "high" | "medium" | "low";
  supplierName: string | null;
  importCategory: string | null;
  leadDays: number;
  cost: number;
  revenue: number;
  margin: number;
  roi: number;
};

type BudgetResult = {
  budgetKes: number;
  selectedCostKes: number;
  selectedRevenueKes: number;
  selectedMarginKes: number;
  deferredCostKes: number;
  deferredRevenueKes: number;
  deferredMarginKes: number;
  criticalOverflowKes: number;
  deferredAtRisk: number;
  deferredAtRiskRevenueKes: number;
  selectedCount: number;
  deferredCount: number;
  selected: BudgetItem[];
  deferred: BudgetItem[];
};

type ShockItem = {
  productId: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  sku: string;
  currentStock: number;
  baselineForecast: number;
  shockedForecast: number;
  baselineRecommend: number;
  shockedRecommend: number;
  extraCost: number;
  extraRevenue: number;
  supplierName: string | null;
  leadTimeP90: number;
  leadFeasible: boolean;
};

type ShockResult = {
  eventName: string | null;
  upliftMultiplier: number;
  scope: string;
  scopeValue: string | null;
  daysAhead: number;
  affectedCount: number;
  baseline: { reorderCount: number; reorderCost: number; reorderRevenue: number; reorderMargin: number };
  shocked:  { reorderCount: number; reorderCost: number; reorderRevenue: number; reorderMargin: number };
  delta:    { cost: number; revenue: number; margin: number; reorderCount: number };
  leadTime: { infeasibleCount: number; infeasibleExtraCostKes: number };
  items: ShockItem[];
};

const KES = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
const KESshort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
};

const PRESET_EVENTS = [
  { name: "Valentine's Day", uplift: 2.5, scope: "category" as const, scopeValue: "FRAGRANCE", days: 21 },
  { name: "Mother's Day", uplift: 1.8, scope: "category" as const, scopeValue: "SKINCARE", days: 30 },
  { name: "Father's Day", uplift: 2.0, scope: "category" as const, scopeValue: "FRAGRANCE", days: 30 },
  { name: "Eid", uplift: 1.4, scope: "all" as const, scopeValue: null, days: 28 },
  { name: "Jamhuri Day", uplift: 1.5, scope: "all" as const, scopeValue: null, days: 21 },
  { name: "Christmas", uplift: 2.5, scope: "all" as const, scopeValue: null, days: 45 },
];

export default function RestockPlannerPage() {
  const { slug } = useParams<{ slug: string }>();
  const [facets, setFacets] = useState<{ categories: Facet[]; brands: Facet[] }>({ categories: [], brands: [] });

  // Budget allocator state — budget caps the spend, days sizes the need; either or both.
  const [budgetInput, setBudgetInput] = useState<string>("800000");
  const [daysInput, setDaysInput] = useState<string>("");
  const [budgetResult, setBudgetResult] = useState<BudgetResult | null>(null);
  const [runningBudget, setRunningBudget] = useState(false);
  // Row selection for the bulk actions (productIds; default = every "Buy now" row).
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [ordering, setOrdering] = useState(false);
  const [orderedMsg, setOrderedMsg] = useState<string | null>(null);

  // Demand shock state
  const [shockUplift, setShockUplift] = useState<string>("2.0");
  const [shockScope, setShockScope] = useState<"all" | "category" | "brand">("all");
  const [shockScopeValue, setShockScopeValue] = useState<string>("");
  const [shockDays, setShockDays] = useState<string>("30");
  const [shockEvent, setShockEvent] = useState<string>("");
  const [shockResult, setShockResult] = useState<ShockResult | null>(null);
  const [runningShock, setRunningShock] = useState(false);

  useEffect(() => {
    apiFetch(slug, "/api/catalog/facets").then(r => r.json()).then(setFacets);
  }, []);

  async function runBudget() {
    setRunningBudget(true);
    setOrderedMsg(null);
    const budgetKes = budgetInput.trim() === "" ? undefined : parseFloat(budgetInput);
    const coverDays = daysInput.trim() === "" ? undefined : parseInt(daysInput, 10);
    const res = await apiFetch(slug, "/api/simulate/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetKes, coverDays }),
    });
    const data: BudgetResult = await res.json();
    setBudgetResult(data);
    // Default: every recommended "Buy now" row is checked, ready to act on.
    setChecked(new Set((data.selected ?? []).map(it => it.productId)));
    setRunningBudget(false);
  }

  function toggleChecked(productId: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  const checkedItems = budgetResult?.selected.filter(it => checked.has(it.productId)) ?? [];
  const checkedCost = checkedItems.reduce((s, it) => s + it.cost, 0);

  async function bulkOrder() {
    if (checkedItems.length === 0) return;
    setOrdering(true);
    setOrderedMsg(null);
    try {
      const res = await apiFetch(slug, "/api/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: checkedItems.map(it => ({
            productId: it.productId,
            qty: Math.max(1, Math.ceil(it.recommendedQty)),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setOrderedMsg(`Error: ${data.error ?? "bulk order failed"}`); return; }
      setOrderedMsg(`Marked ${data.ordered} item${data.ordered === 1 ? "" : "s"} as ordered — they're now tracked on the Orders page.`);
    } finally {
      setOrdering(false);
    }
  }

  function downloadOrderSheet() {
    if (checkedItems.length === 0) return;
    // Grouped by supplier so Mary can send each block straight to its supplier.
    const rows = [...checkedItems]
      .sort((a, b) => (a.supplierName ?? "zzz").localeCompare(b.supplierName ?? "zzz") || a.title.localeCompare(b.title))
      .map(it => {
        const qty = Math.max(1, Math.ceil(it.recommendedQty));
        const unitCost = qty > 0 ? it.cost / it.recommendedQty : 0;
        const eta = new Date(Date.now() + it.leadDays * 86_400_000).toISOString().slice(0, 10);
        return [
          it.supplierName ?? "Unassigned",
          it.sku,
          it.title,
          it.importCategory ?? "—",
          qty,
          Math.round(unitCost),
          Math.round(unitCost * qty),
          eta,
        ];
      });
    const csv = toCsv(
      ["Supplier", "SKU", "Product", "Category", "Qty", "Unit cost (KES)", "Line total (KES)", "Est. arrival"],
      rows
    );
    saveTextFile(`order-sheet-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function applyPreset(p: typeof PRESET_EVENTS[number]) {
    setShockEvent(p.name);
    setShockUplift(p.uplift.toString());
    setShockScope(p.scope);
    setShockScopeValue(p.scopeValue ?? "");
    setShockDays(p.days.toString());
  }

  async function runShock() {
    setRunningShock(true);
    const res = await apiFetch(slug, "/api/simulate/demand-shock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upliftMultiplier: parseFloat(shockUplift),
        scope: shockScope,
        scopeValue: shockScope === "all" ? null : (shockScopeValue || null),
        daysAhead: parseInt(shockDays),
        eventName: shockEvent || null,
      }),
    });
    const data = await res.json();
    setShockResult(data);
    setRunningShock(false);
  }

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-7 space-y-6">
        <div>
          <div className="text-2xs uppercase tracking-wider text-mute">Plan → order in one flow</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Restock Planner</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-2xl">
            Tell it your budget, get the smartest restock list for that money — then mark everything as ordered and download the order sheet for your suppliers.
          </p>
        </div>

        {/* Budget planner */}
        <section className="card p-6">
          <div className="mb-4">
            <div className="text-2xs uppercase tracking-wider text-mute">Step 1 — your budget</div>
            <h2 className="text-base font-semibold tracking-tight mt-0.5">&ldquo;I have this much to spend on restocking — what do I buy?&rdquo;</h2>
            <p className="text-sm text-ink-soft mt-2 max-w-3xl leading-relaxed">
              Critical SKUs are always included (even if they overflow your budget). The rest are ranked by urgency × margin until the budget is used. Deferred items are shown with their stockout risk.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">Budget (KES) — optional</span>
              <input
                type="number"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                className="input w-40"
                placeholder="800000"
              />
            </label>
            <div className="flex gap-1.5">
              {[400, 800, 1500, 3000].map(k => (
                <button
                  key={k}
                  onClick={() => setBudgetInput((k * 1000).toString())}
                  className="text-2xs px-3 py-1.5 rounded-md bg-canvas-tint border border-line text-ink-soft hover:bg-canvas"
                >
                  KES {k}k
                </button>
              ))}
            </div>
            <label className="block">
              <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">Cover the next… — optional</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={daysInput}
                  onChange={e => setDaysInput(e.target.value)}
                  className="input w-24"
                  placeholder="days"
                />
                {[5, 7, 14, 21].map(d => (
                  <button
                    key={d}
                    onClick={() => setDaysInput(String(d))}
                    className="text-2xs px-2.5 py-1.5 rounded-md bg-canvas-tint border border-line text-ink-soft hover:bg-canvas"
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </label>
            <button
              onClick={runBudget}
              disabled={runningBudget || (!budgetInput.trim() && !daysInput.trim())}
              className="btn-accent disabled:bg-mute disabled:hover:bg-mute"
            >
              {runningBudget ? "Running…" : "Plan my restock"}
            </button>
          </div>
          <p className="text-2xs text-mute mt-2.5">
            Days sizes the order (&ldquo;enough stock for N days&rdquo;); budget caps the spend. Use either, or both together.
          </p>

          {budgetResult && (
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line rounded-2xl overflow-hidden">
                <Kpi label="Items selected" value={`${budgetResult.selectedCount}`} hint={`KES ${KESshort(budgetResult.selectedCostKes)} of budget used`} />
                <Kpi label="Expected revenue" value={`KES ${KESshort(budgetResult.selectedRevenueKes)}`} hint={`Margin KES ${KESshort(budgetResult.selectedMarginKes)}`} />
                <Kpi label="Items deferred" value={`${budgetResult.deferredCount}`} hint={`${budgetResult.deferredAtRisk} at stockout risk`} tone={budgetResult.deferredAtRisk > 0 ? "warn" : "default"} />
                <Kpi label="Revenue at risk" value={`KES ${KESshort(budgetResult.deferredAtRiskRevenueKes)}`} hint="If deferred items stock out" tone={budgetResult.deferredAtRiskRevenueKes > 100000 ? "warn" : "default"} />
              </div>
              {budgetResult.criticalOverflowKes > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
                  Critical SKUs overflow your budget by <strong>KES {KESshort(budgetResult.criticalOverflowKes)}</strong>. They&apos;re still included — you may want to raise the budget or accept some stockouts.
                </div>
              )}

              {/* Step 2 — act on the list */}
              <div className="p-4 rounded-2xl border border-accent-100 bg-accent-50 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <div className="text-2xs uppercase tracking-wider text-accent-700 font-semibold">Step 2 — act on it</div>
                  <div className="text-sm text-ink-soft mt-0.5">
                    <span className="num font-semibold">{checkedItems.length}</span> of {budgetResult.selectedCount} items ticked · KES <span className="num font-semibold">{KESshort(checkedCost)}</span>
                  </div>
                </div>
                <button
                  onClick={downloadOrderSheet}
                  disabled={checkedItems.length === 0}
                  className="btn-ghost disabled:opacity-50"
                >
                  Download order sheet (CSV)
                </button>
                <button
                  onClick={bulkOrder}
                  disabled={ordering || checkedItems.length === 0}
                  className="btn-accent disabled:bg-mute disabled:hover:bg-mute"
                >
                  {ordering ? "Marking…" : `Mark ${checkedItems.length} as ordered`}
                </button>
              </div>
              {orderedMsg && (
                <div className={`p-3 rounded-xl text-sm border ${orderedMsg.startsWith("Error") ? "border-status-bad/30 bg-status-bad/5 text-status-bad" : "border-status-ok/30 bg-status-ok/5 text-status-ok"}`}>
                  {orderedMsg}
                  {!orderedMsg.startsWith("Error") && (
                    <> <Link href={`/shop/${slug}/orders`} className="underline font-medium">View orders →</Link></>
                  )}
                </div>
              )}

              <div className="grid lg:grid-cols-2 gap-4">
                <BudgetList
                  title={`Buy now · ${budgetResult.selectedCount}`}
                  items={budgetResult.selected}
                  tone="accent"
                  checked={checked}
                  onToggle={toggleChecked}
                />
                <BudgetList title={`Defer · ${budgetResult.deferredCount}`} items={budgetResult.deferred} tone="muted" />
              </div>
            </div>
          )}
        </section>

        {/* Demand shock */}
        <section className="card p-6">
          <div className="mb-4">
            <div className="text-2xs uppercase tracking-wider text-mute">What-if</div>
            <h2 className="text-base font-semibold tracking-tight mt-0.5">Demand spike before a holiday</h2>
            <p className="text-sm text-ink-soft mt-2 max-w-3xl leading-relaxed">
              Bump the 30-day forecast for a category or brand and see the new reorder list. Lead-time feasibility flags items where the supplier&apos;s 90th-percentile lead is longer than your runway to the event.
            </p>
          </div>

          {/* Presets */}
          <div className="mb-4">
            <div className="text-2xs uppercase tracking-wider text-mute mb-2">Quick presets</div>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_EVENTS.map(p => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  className={`text-2xs px-3 py-1.5 rounded-md border transition ${
                    shockEvent === p.name ? "bg-ink text-white border-ink" : "bg-canvas-tint border-line text-ink-soft hover:bg-canvas"
                  }`}
                >
                  {p.name} · {p.uplift}× · {p.days}d
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="block">
              <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">Demand multiplier</span>
              <input type="number" step="0.1" value={shockUplift} onChange={e => setShockUplift(e.target.value)} className="input" />
            </label>
            <label className="block">
              <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">Scope</span>
              <select value={shockScope} onChange={e => setShockScope(e.target.value as "all" | "category" | "brand")} className="input">
                <option value="all">All products</option>
                <option value="category">Category</option>
                <option value="brand">Brand</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">{shockScope === "all" ? "(all)" : shockScope}</span>
              {shockScope === "all" ? (
                <input value="—" disabled className="input opacity-50" />
              ) : (
                <select value={shockScopeValue} onChange={e => setShockScopeValue(e.target.value)} className="input">
                  <option value="">Pick {shockScope}…</option>
                  {(shockScope === "category" ? facets.categories : facets.brands).slice(0, 100).map(f => (
                    <option key={f.name} value={f.name}>{f.name} ({f.count})</option>
                  ))}
                </select>
              )}
            </label>
            <label className="block">
              <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">Days until event</span>
              <input type="number" value={shockDays} onChange={e => setShockDays(e.target.value)} className="input" />
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={runShock} disabled={runningShock} className="btn-ghost disabled:opacity-50">
              {runningShock ? "Running…" : "Preview the spike"}
            </button>
          </div>

          {shockResult && (
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line rounded-2xl overflow-hidden">
                <Kpi label="Extra capital needed" value={`KES ${KESshort(shockResult.delta.cost)}`} hint={`${shockResult.delta.reorderCount >= 0 ? "+" : ""}${shockResult.delta.reorderCount} reorders vs baseline`} />
                <Kpi label="Extra revenue" value={`KES ${KESshort(shockResult.delta.revenue)}`} hint={`Margin +KES ${KESshort(shockResult.delta.margin)}`} />
                <Kpi label="Affected SKUs" value={`${shockResult.affectedCount}`} hint={`Scope: ${shockResult.scope}${shockResult.scopeValue ? ` · ${shockResult.scopeValue}` : ""}`} />
                <Kpi
                  label="Won't make it in time"
                  value={`${shockResult.leadTime.infeasibleCount}`}
                  hint={`KES ${KESshort(shockResult.leadTime.infeasibleExtraCostKes)} blocked`}
                  tone={shockResult.leadTime.infeasibleCount > 0 ? "alarm" : "default"}
                />
              </div>

              <div className="card overflow-hidden">
                <div className="px-5 pt-5 pb-4 flex items-end justify-between">
                  <div>
                    <div className="text-2xs uppercase tracking-wider text-mute">Top revenue impact (first 50)</div>
                    <h3 className="text-base font-semibold tracking-tight mt-0.5">Shocked reorder list</h3>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
                    <tr>
                      <th className="px-5 py-2 font-medium">Product</th>
                      <th className="px-5 py-2 font-medium">Supplier</th>
                      <th className="px-5 py-2 font-medium text-right">Baseline</th>
                      <th className="px-5 py-2 font-medium text-right">Shocked</th>
                      <th className="px-5 py-2 font-medium text-right">Extra cost</th>
                      <th className="px-5 py-2 font-medium text-right">Extra revenue</th>
                      <th className="px-5 py-2 font-medium text-center">Lead OK?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shockResult.items.slice(0, 50).map(it => (
                      <tr key={it.productId} className="hover:bg-canvas">
                        <td className="px-5 py-2.5">
                          <Link href={`/shop/${slug}/dashboard/product/${it.productId}`} className="font-medium hover:underline truncate block max-w-xs">{it.title}</Link>
                          <div className="text-2xs text-mute">{it.vendor || "—"} · {it.productType || "—"}</div>
                        </td>
                        <td className="px-5 py-2.5 text-2xs text-ink-soft">{it.supplierName || "—"}</td>
                        <td className="px-5 py-2.5 text-right num">{it.baselineRecommend.toFixed(0)}</td>
                        <td className="px-5 py-2.5 text-right num font-semibold text-accent-700">{it.shockedRecommend.toFixed(0)}</td>
                        <td className="px-5 py-2.5 text-right num">KES {KESshort(it.extraCost)}</td>
                        <td className="px-5 py-2.5 text-right num text-status-ok">KES {KESshort(it.extraRevenue)}</td>
                        <td className="px-5 py-2.5 text-center">
                          {it.leadFeasible ? (
                            <span className="text-2xs text-status-ok">✓ {Math.round(it.leadTimeP90)}d</span>
                          ) : (
                            <span className="text-2xs text-status-bad">✗ {Math.round(it.leadTimeP90)}d</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Kpi({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "warn" | "alarm" }) {
  const c = tone === "alarm" ? "text-status-bad" : tone === "warn" ? "text-status-warn" : "";
  return (
    <div className="bg-canvas-raised p-4 sm:p-5">
      <div className="text-2xs uppercase tracking-wider text-mute">{label}</div>
      <div className={`text-2xl font-semibold mt-2 num tracking-tight ${c}`}>{value}</div>
      {hint && <div className="text-2xs text-mute mt-1">{hint}</div>}
    </div>
  );
}

function BudgetList({ title, items, tone, checked, onToggle }: {
  title: string;
  items: BudgetItem[];
  tone: "accent" | "muted";
  /** When provided, rows render a checkbox (the actionable "Buy now" list). */
  checked?: Set<string>;
  onToggle?: (productId: string) => void;
}) {
  const { slug } = useParams<{ slug: string }>();
  const selectable = !!checked && !!onToggle;
  return (
    <div className="card overflow-hidden">
      <div className={`px-4 py-3 border-b border-line ${tone === "accent" ? "bg-accent-50" : "bg-canvas-tint"}`}>
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-line">
        {items.length === 0 && (
          <div className="px-4 py-8 text-center text-2xs text-mute">Nothing here</div>
        )}
        {items.slice(0, 100).map(it => (
          <div key={it.predictionId} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
            {selectable && (
              <input
                type="checkbox"
                checked={checked!.has(it.productId)}
                onChange={() => onToggle!(it.productId)}
                className="h-4 w-4 shrink-0 accent-[var(--color-accent-600)] cursor-pointer"
                aria-label={`Include ${it.title} in the order`}
              />
            )}
            <div className="min-w-0 flex-1">
              <Link href={`/shop/${slug}/dashboard/product/${it.productId}`} className="text-sm font-medium truncate block hover:underline">
                {it.title}
              </Link>
              <div className="text-2xs text-mute mt-0.5 flex items-center gap-1.5">
                <UrgencyDot u={it.urgency} />
                <span>{it.vendor || "—"}</span>
                <span>·</span>
                <span className="num">{it.recommendedQty.toFixed(0)} units</span>
                <span>·</span>
                <span className="num">{it.daysUntilStockout}d left</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold num">KES {KESshort(it.cost)}</div>
              <div className="text-2xs text-mute num">→ KES {KESshort(it.revenue)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UrgencyDot({ u }: { u: "critical" | "high" | "medium" | "low" }) {
  const c = u === "critical" ? "bg-status-bad" : u === "high" ? "bg-status-warn" : u === "medium" ? "bg-accent-500" : "bg-mute";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${c}`} />;
}
