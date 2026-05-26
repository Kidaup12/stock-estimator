"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

type Signal = { label: string; deltaPct: number; emoji: string };

type Detail = {
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
    supplier: { id: string; name: string; leadTimeAvgDays: number; leadTimeStdDays: number } | null;
  };
  history: {
    byMonth: { month: string; quantity: number; revenueKes: number }[];
  };
  prediction: {
    id: string;
    runDate: string;
    layer1Forecast30d: number;
    layer1Confidence: number;
    layer2Adjustment: number;
    finalForecast30d: number;
    daysUntilStockout: number;
    recommendedQty: number;
    safetyStock: number;
    reorderPoint: number;
    confidence: number;
    reasoning: string;
    urgency: string;
    signals: Signal[];
    latestOrder: { id: string; status: string } | null;
  } | null;
};

const KES = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });

export default function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

  async function load() {
    setLoading(true);
    const [d, s] = await Promise.all([
      fetch(`/api/products/${id}`).then(r => r.json()),
      fetch("/api/suppliers").then(r => r.json()),
    ]);
    setData(d);
    setSuppliers(s.suppliers || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function setSupplier(supplierId: string) {
    await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplierId: supplierId || null }),
    });
    await load();
  }

  if (loading || !data) {
    return <main className="min-h-screen p-8 text-center text-zinc-500">Loading…</main>;
  }

  const { product, history, prediction } = data;
  const maxMonthQty = Math.max(1, ...history.byMonth.map(m => m.quantity));

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="max-w-5xl mx-auto">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">← Dashboard</Link>

        <div className="mt-3 flex gap-6 items-start">
          {product.imageUrl && (
            <img src={product.imageUrl} alt={product.title} className="w-32 h-32 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800" />
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{product.title}</h1>
            <div className="text-sm text-zinc-500 mt-1 font-mono">{product.sku}</div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {product.vendor || "—"} · {product.productType || "—"} · KES {KES(product.priceKes)}
              {product.abcCategory && <span className="ml-2 px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-xs font-bold">Class {product.abcCategory}</span>}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 max-w-md">
              <Stat label="Stock" value={product.currentStock.toFixed(0)} />
              <Stat label="Days left" value={prediction ? `${prediction.daysUntilStockout}d` : "—"} accent={prediction && prediction.daysUntilStockout < 14 ? "red" : undefined} />
              <Stat label="Recommend" value={prediction ? prediction.recommendedQty.toFixed(0) : "—"} />
            </div>
          </div>
        </div>

        {prediction && (
          <div className="mt-8 rounded-lg border-2 border-blue-200 dark:border-blue-900 bg-white dark:bg-zinc-900 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Forecast Breakdown (next 30 days)</h2>
              <span className="text-xs text-zinc-500">run {new Date(prediction.runDate).toLocaleString()}</span>
            </div>

            <div className="space-y-3">
              <Row
                label="Layer 1 — SARIMA baseline"
                badge="mock"
                value={`${prediction.layer1Forecast30d.toFixed(0)} units`}
                hint={`confidence ${(prediction.layer1Confidence * 100).toFixed(0)}%`}
              />
              <Row
                label="Layer 2 — XGBoost adjustment"
                badge="mock"
                value={`${prediction.layer2Adjustment >= 0 ? "+" : ""}${prediction.layer2Adjustment.toFixed(0)} units`}
                hint={prediction.layer2Adjustment >= 0 ? "boosts from signals below" : "headwinds from signals below"}
              />

              {prediction.signals.length > 0 && (
                <div className="pl-4 flex flex-wrap gap-2 py-2">
                  {prediction.signals.map((s, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                      {s.emoji} {s.label}
                    </span>
                  ))}
                </div>
              )}

              <div className="border-t border-zinc-200 dark:border-zinc-800 my-2" />

              <Row label="Final 30-day forecast" value={`${prediction.finalForecast30d.toFixed(0)} units`} bold />
              <Row label="Safety stock (King's formula)" value={`+${prediction.safetyStock.toFixed(0)} units`} hint={product.supplier ? `lead ${product.supplier.leadTimeAvgDays}d ± ${product.supplier.leadTimeStdDays}d` : "default lead 30d ± 7d"} />
              <Row label="Reorder point" value={`${prediction.reorderPoint.toFixed(0)} units`} bold />
              <Row label="Recommended order qty" value={`${prediction.recommendedQty.toFixed(0)} units · KES ${KES(prediction.recommendedQty * product.priceKes)}`} bold accent />
            </div>

            <div className="mt-4 p-3 rounded bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
              <div className="font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Reasoning</div>
              {prediction.reasoning}
            </div>

            <div className="mt-2 text-[10px] text-zinc-400">
              Layer 1 and Layer 2 outputs are simulated locally for UI development. Real model service (Python + statsmodels + xgboost) plugs in at the same JSON shape.
            </div>
          </div>
        )}

        <div className="mt-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <h2 className="text-lg font-bold mb-4">12-month sales</h2>
          <div className="flex items-end gap-1 h-32">
            {history.byMonth.slice(-12).map(m => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="flex-1 w-full flex items-end">
                  <div
                    className="w-full bg-blue-500 dark:bg-blue-600 rounded-t"
                    style={{ height: `${(m.quantity / maxMonthQty) * 100}%` }}
                    title={`${m.month}: ${m.quantity.toFixed(0)} units · KES ${KES(m.revenueKes)}`}
                  />
                </div>
                <div className="text-[10px] text-zinc-500">{m.month.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <h2 className="text-lg font-bold mb-4">Supplier</h2>
          <div className="flex items-center gap-3">
            <select
              value={product.supplier?.id || ""}
              onChange={e => setSupplier(e.target.value)}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="">— Default (30d ± 7d) —</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Link href="/suppliers" className="text-sm text-blue-600 hover:underline">Manage suppliers</Link>
          </div>
          {product.supplier && (
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Lead time: {product.supplier.leadTimeAvgDays}d ± {product.supplier.leadTimeStdDays}d
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "red" }) {
  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-lg font-bold ${accent === "red" ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}

function Row({ label, value, hint, badge, bold, accent }: {
  label: string;
  value: string;
  hint?: string;
  badge?: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm flex items-center gap-2">
        <span className={bold ? "font-semibold" : ""}>{label}</span>
        {badge && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">{badge}</span>}
      </div>
      <div className="text-right">
        <div className={`${bold ? "font-bold" : ""} ${accent ? "text-blue-600" : ""}`}>{value}</div>
        {hint && <div className="text-[10px] text-zinc-500">{hint}</div>}
      </div>
    </div>
  );
}
