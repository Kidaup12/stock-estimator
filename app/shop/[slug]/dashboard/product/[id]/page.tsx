"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type Signal = { label: string; deltaPct: number; emoji: string };

type Detail = {
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
  const { slug } = useParams<{ slug: string }>();
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

  async function load() {
    setLoading(true);
    const [d, s] = await Promise.all([
      apiFetch(slug, `/api/products/${id}`).then(r => r.json()),
      apiFetch(slug, "/api/suppliers").then(r => r.json()),
    ]);
    setData(d);
    setSuppliers(s.suppliers || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function setSupplier(supplierId: string) {
    await apiFetch(slug, `/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplierId: supplierId || null }),
    });
    await load();
  }

  async function setLeadTime(leadTimeDays: string) {
    await apiFetch(slug, `/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadTimeDays: leadTimeDays === "" ? null : leadTimeDays }),
    });
    await load();
  }

  if (loading || !data) {
    return <main className="min-h-screen bg-canvas p-8 text-center text-mute text-sm">Loading…</main>;
  }

  const { product, history, prediction } = data;
  const maxMonthQty = Math.max(1, ...history.byMonth.map(m => m.quantity));

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-7 space-y-6">
        <Link href={`/shop/${slug}/dashboard`} className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition inline-block">
          ← Back to dashboard
        </Link>
        <section className="flex gap-6 items-start">
          {product.imageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={product.imageUrl} alt={product.title} className="w-32 h-32 rounded-2xl object-cover border border-line" />
          )}
          <div className="flex-1">
            <div className="text-2xs uppercase tracking-wider text-mute">{product.vendor || "Unbranded"}</div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">{product.title}</h1>
            <div className="text-2xs text-mute mt-1 num">{product.sku}</div>
            <div className="text-sm text-ink-soft mt-2 flex items-center gap-2 flex-wrap">
              <span>{product.productType || "—"}</span>
              <span className="text-mute">·</span>
              <span className="num">Retail KES {KES(product.priceKes)}</span>
              {product.costKes > 0 && (
                <>
                  <span className="text-mute">·</span>
                  <span className="num text-mute">Cost KES {KES(product.costKes)}</span>
                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200">
                    {(((product.priceKes - product.costKes) / product.priceKes) * 100).toFixed(0)}% margin
                  </span>
                </>
              )}
              {product.abcCategory && (
                <>
                  <span className="text-mute">·</span>
                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-md bg-canvas-tint border border-line">
                    Class {product.abcCategory}
                  </span>
                </>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-px bg-line border border-line rounded-2xl overflow-hidden shadow-soft max-w-md">
              <MiniStat label="Stock" value={product.currentStock.toFixed(0)} />
              <MiniStat
                label="Days left"
                value={prediction ? `${prediction.daysUntilStockout}d` : "—"}
                tone={prediction && prediction.daysUntilStockout < 14 ? "bad" : "default"}
              />
              <MiniStat
                label="Recommend"
                value={prediction ? prediction.recommendedQty.toFixed(0) : "—"}
                tone="accent"
              />
            </div>
          </div>
        </section>

        {prediction && (
          <section className="card p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-2xs uppercase tracking-wider text-mute">Forecast breakdown</div>
                <h2 className="text-base font-semibold mt-1">Next 30 days</h2>
              </div>
              <span className="text-2xs text-mute num">run {new Date(prediction.runDate).toLocaleString()}</span>
            </div>

            <div className="space-y-1">
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
                <div className="pl-4 flex flex-wrap gap-1.5 py-2">
                  {prediction.signals.map((s, i) => (
                    <span key={i} className="text-2xs px-2 py-1 rounded-md bg-canvas-tint border border-line text-ink-soft">
                      {s.emoji} {s.label}
                    </span>
                  ))}
                </div>
              )}

              <div className="border-t border-dashed border-line my-3" />

              <Row label="Final 30-day forecast" value={`${prediction.finalForecast30d.toFixed(0)} units`} bold />
              <Row
                label="Safety stock (King's formula)"
                value={`+${prediction.safetyStock.toFixed(0)} units`}
                hint={product.supplier ? `lead ${product.supplier.leadTimeAvgDays}d ± ${product.supplier.leadTimeStdDays}d` : "default lead 30d ± 7d"}
              />
              <Row label="Reorder point" value={`${prediction.reorderPoint.toFixed(0)} units`} bold />
              <Row
                label="Recommended order qty"
                value={`${prediction.recommendedQty.toFixed(0)} units`}
                hint={`Cost to supplier: KES ${KES(prediction.recommendedQty * product.costKes)} · expected revenue: KES ${KES(prediction.recommendedQty * product.priceKes)}`}
                bold
                accent
              />
            </div>

            <div className="mt-5 p-4 rounded-xl bg-accent-50 border border-accent-100">
              <div className="text-2xs uppercase tracking-wider text-accent-700 font-semibold mb-1.5">Reasoning</div>
              <p className="text-sm text-ink-soft leading-relaxed">{prediction.reasoning}</p>
            </div>

            <div className="mt-3 text-2xs text-mute">
              Layer 1 and Layer 2 outputs are simulated locally for UI development.
              Real model service (Python + statsmodels + xgboost) plugs in at the same JSON shape.
            </div>
          </section>
        )}

        <section className="card p-6">
          <div className="mb-4">
            <div className="text-2xs uppercase tracking-wider text-mute">Trailing 12 months</div>
            <h2 className="text-base font-semibold mt-1">Units sold per month</h2>
          </div>
          <div className="flex items-end gap-1.5 h-32">
            {history.byMonth.slice(-12).map(m => (
              <div key={m.month} className="flex-1 h-full flex flex-col items-center gap-1.5">
                <div className="flex-1 w-full flex items-end">
                  <div
                    className="w-full bg-accent-500 hover:bg-accent-600 transition rounded-t-md"
                    style={{ height: `${(m.quantity / maxMonthQty) * 100}%` }}
                    title={`${m.month}: ${m.quantity.toFixed(0)} units · KES ${KES(m.revenueKes)}`}
                  />
                </div>
                <div className="text-2xs text-mute num">{m.month.slice(5)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-6">
          <div className="mb-4">
            <div className="text-2xs uppercase tracking-wider text-mute">Replenishment</div>
            <h2 className="text-base font-semibold mt-1">Supplier</h2>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={product.supplier?.id || ""}
              onChange={e => setSupplier(e.target.value)}
              className="input max-w-xs"
            >
              <option value="">— Default (30d ± 7d) —</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Link href={`/shop/${slug}/suppliers`} className="text-sm text-accent-700 hover:text-accent-800 hover:underline">
              Manage suppliers
            </Link>
          </div>
          {product.supplier && (
            <div className="mt-3 text-sm text-ink-soft num">
              Supplier lead time: {product.supplier.leadTimeAvgDays}d ± {product.supplier.leadTimeStdDays}d
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-line">
            <label className="text-2xs uppercase tracking-wider text-mute" htmlFor="leadOverride">
              Lead time override (days)
            </label>
            <div className="flex items-center gap-3 mt-1.5">
              <input
                id="leadOverride"
                key={product.leadTimeDays ?? "none"}
                type="number"
                min={1}
                inputMode="numeric"
                defaultValue={product.leadTimeDays ?? ""}
                placeholder={`default ${product.supplier?.leadTimeAvgDays ?? 30}`}
                onBlur={e => setLeadTime(e.target.value)}
                className="input max-w-[8rem]"
              />
              <span className="text-2xs text-mute">
                Per-product. Blank = use supplier ({product.supplier?.leadTimeAvgDays ?? 30}d). Drives safety stock + reorder point.
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "bad" | "accent" }) {
  const c = tone === "bad" ? "text-status-bad" : tone === "accent" ? "text-accent-700" : "text-ink";
  return (
    <div className="bg-canvas-raised p-3">
      <div className="text-2xs uppercase tracking-wider text-mute">{label}</div>
      <div className={`text-lg font-semibold num tracking-tight mt-1 ${c}`}>{value}</div>
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
    <div className={`flex items-center justify-between gap-3 py-2 px-3 rounded-lg ${accent ? "bg-accent-50" : ""}`}>
      <div className="text-sm flex items-center gap-2">
        <span className={bold ? "font-semibold" : "text-ink-soft"}>{label}</span>
        {badge && (
          <span className="text-2xs uppercase font-semibold px-1.5 py-0.5 rounded bg-status-warn/10 text-status-warn">
            {badge}
          </span>
        )}
      </div>
      <div className="text-right">
        <div className={`num ${bold ? "font-semibold" : ""} ${accent ? "text-accent-700" : ""}`}>{value}</div>
        {hint && <div className="text-2xs text-mute mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}
