"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type PositionRow = {
  productId: string; title: string; sku: string; runRate: number;
  openingOnHand: number; openingEstimated: boolean; currentStock: number;
  onOrder: number; expectedArrivalAt: string | null;
  leadTimeAvgDays: number | null; leadTimeStdDays: number | null; daysOfCover: number | null;
};
type PositionGroup = { rows: PositionRow[]; subtotal: { count: number; opening: number; current: number; enRoute: number } };
type PositionView = { windowDays: number; groups: { A: PositionGroup; B: PositionGroup; C: PositionGroup }; trackingSince: string | null };

type Cls = "A" | "B" | "C";

const CLASS_BLURB: Record<Cls, string> = {
  A: "Bestsellers — your fastest movers. Keep these always in stock.",
  B: "Steady mid-tier sellers.",
  C: "Slow / long-tail. Order sparingly.",
};

function leadLabel(r: PositionRow): string {
  if (r.leadTimeAvgDays == null) return "—";
  return r.leadTimeStdDays != null ? `${r.leadTimeAvgDays}±${r.leadTimeStdDays}d` : `${r.leadTimeAvgDays}d`;
}

export default function StockHealthPage() {
  const { slug } = useParams<{ slug: string }>();
  const [position, setPosition] = useState<PositionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [posWindow, setPosWindow] = useState(30);
  const [cls, setCls] = useState<Cls>("A");

  useEffect(() => {
    setLoading(true);
    apiFetch(slug, `/api/inventory-position?window=${posWindow}`)
      .then((r) => r.json())
      .then((d) => { setPosition(d); setLoading(false); })
      .catch(() => { setPosition(null); setLoading(false); });
  }, [posWindow]);

  const grp = position?.groups[cls];

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link href={`/shop/${slug}/dashboard`} className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">
            ← Dashboard
          </Link>
          <div className="flex items-baseline gap-2.5">
            <div className="h-5 w-5 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-sm font-semibold tracking-tight">Wezesha Restock OS</span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-7 space-y-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-2xs uppercase tracking-wider text-mute">Inventory position</div>
            <h1 className="text-xl font-semibold tracking-tight mt-0.5">Stock health</h1>
            <p className="text-2xs text-mute mt-1">How fast each product sells (run rate, units/day), what you hold now, and how many days of cover are left.</p>
          </div>
          <div className="flex items-center gap-1">
            {[30, 60, 90].map((w) => (
              <button
                key={w}
                onClick={() => setPosWindow(w)}
                className={`text-2xs px-2.5 py-1.5 rounded-lg border transition ${
                  posWindow === w ? "border-ink text-ink bg-canvas-raised" : "border-line text-mute hover:text-ink"
                }`}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>

        {/* A/B/C switcher */}
        <div className="inline-flex rounded-xl border border-line bg-canvas-raised p-0.5 shadow-soft">
          {(["A", "B", "C"] as const).map((g) => {
            const count = position?.groups[g]?.subtotal.count ?? 0;
            return (
              <button
                key={g}
                onClick={() => setCls(g)}
                className={`px-4 py-1.5 text-sm rounded-lg transition flex items-center gap-2 ${
                  cls === g ? "bg-ink text-white" : "text-mute hover:text-ink"
                }`}
              >
                <span>Class {g}</span>
                <span className={`text-2xs num px-1.5 py-0.5 rounded ${cls === g ? "bg-white/20" : "bg-canvas-tint text-mute"}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {position?.trackingSince ? (
          <p className="text-2xs text-mute">
            Opening measured since {new Date(position.trackingSince).toLocaleDateString("en-KE")}; older windows estimated (~).
          </p>
        ) : (
          <p className="text-2xs text-mute">Opening-stock tracking starts today; openings shown are estimates (~).</p>
        )}

        {loading ? (
          <div className="text-center py-16 text-mute text-sm">Loading…</div>
        ) : !grp || grp.rows.length === 0 ? (
          <div className="card text-center py-14 text-mute text-sm">No products in Class {cls}.</div>
        ) : (
          <section className="card overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Class {cls}</h2>
                <p className="text-2xs text-mute mt-0.5">{CLASS_BLURB[cls]}</p>
              </div>
              <div className="flex items-center gap-3 text-2xs text-mute">
                <span>{grp.subtotal.count} SKUs</span>
                <span>opening {Math.round(grp.subtotal.opening)}</span>
                <span>on-hand {Math.round(grp.subtotal.current)}</span>
                <span>en route {Math.round(grp.subtotal.enRoute)}</span>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas sticky top-0">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Product</th>
                    <th className="px-5 py-2.5 font-medium text-right">Run/day</th>
                    <th className="px-5 py-2.5 font-medium text-right">Opening</th>
                    <th className="px-5 py-2.5 font-medium text-right">On-hand</th>
                    <th className="px-5 py-2.5 font-medium text-right">En route</th>
                    <th className="px-5 py-2.5 font-medium text-right">Lead</th>
                    <th className="px-5 py-2.5 font-medium text-right">Days cover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {grp.rows.map((r) => {
                    const atRisk =
                      r.daysOfCover !== null && r.leadTimeAvgDays !== null && r.daysOfCover < r.leadTimeAvgDays;
                    return (
                      <tr key={r.productId} className="hover:bg-canvas">
                        <td className="px-5 py-2.5">
                          <Link href={`/shop/${slug}/dashboard/product/${r.productId}`} className="font-medium hover:underline truncate block max-w-xs">{r.title}</Link>
                          <div className="text-2xs text-mute num">{r.sku}</div>
                        </td>
                        <td className="px-5 py-2.5 text-right num font-semibold text-ink">{r.runRate.toFixed(2)}</td>
                        <td className="px-5 py-2.5 text-right num text-mute">{Math.round(r.openingOnHand)}{r.openingEstimated ? "~" : ""}</td>
                        <td className="px-5 py-2.5 text-right num">{Math.round(r.currentStock)}</td>
                        <td className="px-5 py-2.5 text-right num text-mute">
                          {r.onOrder}
                          {r.expectedArrivalAt ? ` (${new Date(r.expectedArrivalAt).toLocaleDateString("en-KE")})` : ""}
                        </td>
                        <td className="px-5 py-2.5 text-right num text-mute">{leadLabel(r)}</td>
                        <td className={`px-5 py-2.5 text-right num ${atRisk ? "text-status-bad font-semibold" : ""}`}>
                          {r.daysOfCover == null ? "—" : Math.round(r.daysOfCover)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
