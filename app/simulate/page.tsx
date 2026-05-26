"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

export default function SimulatePage() {
  const [facets, setFacets] = useState<{ categories: Facet[]; brands: Facet[] }>({ categories: [], brands: [] });

  // Budget allocator state
  const [budgetInput, setBudgetInput] = useState<string>("800000");
  const [budgetResult, setBudgetResult] = useState<BudgetResult | null>(null);
  const [runningBudget, setRunningBudget] = useState(false);

  // Demand shock state
  const [shockUplift, setShockUplift] = useState<string>("2.0");
  const [shockScope, setShockScope] = useState<"all" | "category" | "brand">("all");
  const [shockScopeValue, setShockScopeValue] = useState<string>("");
  const [shockDays, setShockDays] = useState<string>("30");
  const [shockEvent, setShockEvent] = useState<string>("");
  const [shockResult, setShockResult] = useState<ShockResult | null>(null);
  const [runningShock, setRunningShock] = useState(false);

  useEffect(() => {
    fetch("/api/catalog/facets").then(r => r.json()).then(setFacets);
  }, []);

  async function runBudget() {
    setRunningBudget(true);
    const res = await fetch("/api/simulate/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetKes: parseFloat(budgetInput) }),
    });
    const data = await res.json();
    setBudgetResult(data);
    setRunningBudget(false);
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
    const res = await fetch("/api/simulate/demand-shock", {
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
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">
            ← Dashboard
          </Link>
          <div className="flex items-baseline gap-2.5">
            <div className="h-5 w-5 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-sm font-semibold tracking-tight">Beauty Stock OS</span>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-7 space-y-6">
        <div>
          <div className="text-2xs uppercase tracking-wider text-mute">What-if scenarios</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Simulate</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-2xl">
            Preview decisions before you commit. All scenarios are read-only — no database changes until you act on the results.
          </p>
        </div>

        {/* Cash budget allocator */}
        <section className="card p-6">
          <div className="mb-4">
            <div className="text-2xs uppercase tracking-wider text-mute">Scenario 1 — cash budget</div>
            <h2 className="text-base font-semibold tracking-tight mt-0.5">&ldquo;I have this much to spend on reorders this month — what do I buy?&rdquo;</h2>
            <p className="text-sm text-ink-soft mt-2 max-w-3xl leading-relaxed">
              Critical SKUs are always included (even if they overflow your budget). Then we add remaining items ranked by composite score (urgency × margin) until the budget is hit. Deferred items are shown with their stockout risk.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">Budget (KES)</span>
              <input
                type="number"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                className="input"
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
            <button
              onClick={runBudget}
              disabled={runningBudget || !budgetInput}
              className="btn-accent disabled:bg-mute disabled:hover:bg-mute"
            >
              {runningBudget ? "Running…" : "Run allocation"}
            </button>
          </div>

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

              <div className="grid lg:grid-cols-2 gap-4">
                <BudgetList title={`Buy now · ${budgetResult.selectedCount}`} items={budgetResult.selected} tone="accent" />
                <BudgetList title={`Defer · ${budgetResult.deferredCount}`} items={budgetResult.deferred} tone="muted" />
              </div>
            </div>
          )}
        </section>

        {/* Demand shock */}
        <section className="card p-6">
          <div className="mb-4">
            <div className="text-2xs uppercase tracking-wider text-mute">Scenario 2 — demand shock</div>
            <h2 className="text-base font-semibold tracking-tight mt-0.5">&ldquo;A holiday is coming. Should I bulk order ahead?&rdquo;</h2>
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
            <button onClick={runShock} disabled={runningShock} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
              {runningShock ? "Running…" : "Run shock"}
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
                          <Link href={`/dashboard/product/${it.productId}`} className="font-medium hover:underline truncate block max-w-xs">{it.title}</Link>
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

function BudgetList({ title, items, tone }: { title: string; items: BudgetItem[]; tone: "accent" | "muted" }) {
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
          <Link href={`/dashboard/product/${it.productId}`} key={it.predictionId} className="block px-4 py-2.5 hover:bg-canvas">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{it.title}</div>
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
          </Link>
        ))}
      </div>
    </div>
  );
}

function UrgencyDot({ u }: { u: "critical" | "high" | "medium" | "low" }) {
  const c = u === "critical" ? "bg-status-bad" : u === "high" ? "bg-status-warn" : u === "medium" ? "bg-accent-500" : "bg-mute";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${c}`} />;
}
