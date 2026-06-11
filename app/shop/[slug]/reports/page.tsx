"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type Monthly = { month: string; quantity: number; revenueKes: number };
type Slice = { name: string; revenue: number; qty: number; count: number };
type SupplierSlice = { name: string; revenue: number; stockCost: number; stockRetail: number; stockValue: number; count: number; leadAvg: number; country: string | null };
type Mover = { id: string; title: string; sku: string; vendor: string | null; productType: string | null; revenue30: number; qty30: number; stock: number };
type Slow = { id: string; title: string; sku: string; vendor: string | null; productType: string | null; stock: number; stockValue: number; stockRetail: number };

type ReportsData = {
  monthly: Monthly[];
  byCategory: Slice[];
  byBrand: Slice[];
  bySupplier: SupplierSlice[];
  topMovers: Mover[];
  slowMovers: Slow[];
  abcCounts: { A: number; B: number; C: number };
  lostRevenueKes: number;
  totalStockCost: number;
  totalStockRetail: number;
};

const KES = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
const KESshort = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
};

const PALETTE = ["#7a68e2", "#6d5cd6", "#5a4bbf", "#443697", "#ada0f5", "#8e7eea", "#cfc6ff", "#e6e2ff"];

export default function ReportsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(slug, "/api/reports").then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading || !data) {
    return <main className="min-h-screen bg-canvas p-8 text-center text-mute text-sm">Loading reports…</main>;
  }

  const maxMonthRev = Math.max(1, ...data.monthly.map(m => m.revenueKes));
  const maxCategoryRev = Math.max(1, ...data.byCategory.map(c => c.revenue));
  const maxBrandRev = Math.max(1, ...data.byBrand.map(b => b.revenue));
  const totalAbc = data.abcCounts.A + data.abcCounts.B + data.abcCounts.C;
  const totalSupplierExposure = data.bySupplier.reduce((s, x) => s + x.stockCost, 0);

  const last30 = data.monthly.slice(-1)[0];
  const prev30 = data.monthly.slice(-2, -1)[0];
  const last30Rev = last30?.revenueKes ?? 0;
  const prev30Rev = prev30?.revenueKes ?? 0;
  const mom = prev30Rev > 0 ? ((last30Rev - prev30Rev) / prev30Rev) * 100 : 0;

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-7 space-y-6">
        <div>
          <div className="text-2xs uppercase tracking-wider text-mute">Analytics</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Reports</h1>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line rounded-2xl overflow-hidden shadow-soft">
          <Kpi label="Last month revenue" value={`KES ${KESshort(last30Rev)}`} hint={`${mom >= 0 ? "+" : ""}${mom.toFixed(1)}% MoM`} tone={mom < 0 ? "warn" : "default"} />
          <Kpi label="Capital tied up" value={`KES ${KESshort(data.totalStockCost)}`} hint={`Inventory at cost · KES ${KESshort(data.totalStockRetail)} at retail`} />
          <Kpi label="Revenue at risk (7d)" value={`KES ${KESshort(data.lostRevenueKes)}`} hint="If critical SKUs stock out" tone={data.lostRevenueKes > 100000 ? "warn" : "default"} />
          <Kpi label="ABC mix" value={`${data.abcCounts.A} · ${data.abcCounts.B} · ${data.abcCounts.C}`} hint={`A SKUs drive 70% of revenue`} />
        </div>

        {/* Top movers + slow movers — the order-decision content leads the page */}
        <div className="grid lg:grid-cols-2 gap-4">
          <section className="card overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="text-2xs uppercase tracking-wider text-mute">Last 30 days</div>
              <h2 className="text-base font-semibold tracking-tight mt-0.5">Top 10 movers</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
                <tr><th className="px-5 py-2 font-medium">Product</th><th className="px-5 py-2 font-medium text-right">Sold</th><th className="px-5 py-2 font-medium text-right">Revenue</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.topMovers.map(m => (
                  <tr key={m.id} className="hover:bg-canvas">
                    <td className="px-5 py-2.5">
                      <Link href={`/shop/${slug}/dashboard/product/${m.id}`} className="font-medium hover:underline truncate block max-w-xs">{m.title}</Link>
                      <div className="text-2xs text-mute">{m.vendor || "—"} · {m.productType || "—"}</div>
                    </td>
                    <td className="px-5 py-2.5 text-right num">{m.qty30.toFixed(0)}</td>
                    <td className="px-5 py-2.5 text-right num font-semibold">KES {KESshort(m.revenue30)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="text-2xs uppercase tracking-wider text-mute">No sales 90d · at cost</div>
              <h2 className="text-base font-semibold tracking-tight mt-0.5">Top 10 dead stock by capital tied up</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
                <tr><th className="px-5 py-2 font-medium">Product</th><th className="px-5 py-2 font-medium text-right">Stock</th><th className="px-5 py-2 font-medium text-right">Capital tied up</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.slowMovers.map(s => (
                  <tr key={s.id} className="hover:bg-canvas">
                    <td className="px-5 py-2.5">
                      <Link href={`/shop/${slug}/dashboard/product/${s.id}`} className="font-medium hover:underline truncate block max-w-xs">{s.title}</Link>
                      <div className="text-2xs text-mute">{s.vendor || "—"} · {s.productType || "—"}</div>
                    </td>
                    <td className="px-5 py-2.5 text-right num">{s.stock.toFixed(0)}</td>
                    <td className="px-5 py-2.5 text-right num font-semibold text-status-warn">KES {KESshort(s.stockValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        {/* Monthly revenue */}
        <section className="card p-5">
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="text-2xs uppercase tracking-wider text-mute">12 months</div>
              <h2 className="text-base font-semibold tracking-tight mt-0.5">Revenue</h2>
            </div>
            <div className="text-2xs text-mute">KES</div>
          </div>
          <div className="flex items-end gap-1.5 h-40">
            {data.monthly.slice(-12).map(m => {
              const h = (m.revenueKes / maxMonthRev) * 100;
              return (
                <div key={m.month} className="flex-1 h-full flex flex-col items-center gap-1.5 group" title={`${m.month}: KES ${KES(m.revenueKes)}`}>
                  <div className="text-[10px] text-mute num">{KESshort(m.revenueKes)}</div>
                  <div className="flex-1 w-full flex items-end">
                    <div className="w-full rounded-t bg-accent-500 group-hover:bg-accent-600 transition" style={{ height: `${h}%` }} />
                  </div>
                  <div className="text-[10px] text-mute num">{m.month.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Revenue breakdowns — secondary analytics, collapsed by default */}
        <details className="card overflow-hidden group">
          <summary className="px-5 py-4 cursor-pointer select-none flex items-center justify-between hover:bg-canvas transition list-none [&::-webkit-details-marker]:hidden">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Revenue breakdowns</h2>
              <p className="text-2xs text-mute mt-0.5">By category, brand and supplier exposure — open when you need them</p>
            </div>
            <span className="text-mute text-sm transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="px-5 pb-5 space-y-6 border-t border-line pt-5">
            <div className="grid lg:grid-cols-2 gap-6">
              <div>
                <div className="mb-4">
                  <div className="text-2xs uppercase tracking-wider text-mute">Last 30 days</div>
                  <h3 className="text-base font-semibold tracking-tight mt-0.5">Revenue by category</h3>
                </div>
                <div className="space-y-2">
                  {data.byCategory.slice(0, 10).map((c, i) => (
                    <BarRow
                      key={c.name}
                      label={c.name}
                      pct={(c.revenue / maxCategoryRev) * 100}
                      value={`KES ${KESshort(c.revenue)}`}
                      hint={`${c.count} SKUs`}
                      color={PALETTE[i % PALETTE.length]}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-4">
                  <div className="text-2xs uppercase tracking-wider text-mute">Last 30 days · top 12</div>
                  <h3 className="text-base font-semibold tracking-tight mt-0.5">Revenue by brand</h3>
                </div>
                <div className="space-y-2">
                  {data.byBrand.map((b, i) => (
                    <BarRow
                      key={b.name}
                      label={b.name}
                      pct={(b.revenue / maxBrandRev) * 100}
                      value={`KES ${KESshort(b.revenue)}`}
                      hint={`${b.count} SKUs`}
                      color={PALETTE[i % PALETTE.length]}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <div className="text-2xs uppercase tracking-wider text-mute">Capital tied up by origin (at cost)</div>
                  <h3 className="text-base font-semibold tracking-tight mt-0.5">Supplier exposure</h3>
                </div>
                <div className="text-2xs text-mute">Sum at cost: <span className="num text-ink-soft">KES {KESshort(totalSupplierExposure)}</span></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                {data.bySupplier.map((s, i) => (
                  <BarRow
                    key={s.name}
                    label={`${s.name}`}
                    pct={(s.stockCost / Math.max(1, totalSupplierExposure)) * 100}
                    value={`KES ${KESshort(s.stockCost)}`}
                    hint={`${s.count} SKUs · ${s.country || "—"} · lead ${s.leadAvg}d`}
                    color={PALETTE[i % PALETTE.length]}
                  />
                ))}
              </div>
            </div>
          </div>
        </details>
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

function BarRow({ label, pct, value, hint, color }: { label: string; pct: number; value: string; hint?: string; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 truncate text-sm">{label}</div>
      <div className="flex-1 h-5 bg-canvas-tint rounded-md overflow-hidden">
        <div
          className="h-full rounded-md"
          style={{ width: `${Math.max(2, pct)}%`, background: color }}
        />
      </div>
      <div className="text-right min-w-[110px]">
        <div className="text-sm font-semibold num">{value}</div>
        {hint && <div className="text-2xs text-mute num">{hint}</div>}
      </div>
    </div>
  );
}
