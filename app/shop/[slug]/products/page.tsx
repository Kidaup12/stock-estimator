"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type PositionRow = {
  productId: string; title: string; sku: string; runRate: number;
  vendor: string | null; supplierName: string | null; importCategory: string | null;
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

const CATEGORIES = ["LOCAL", "KOREAN", "WESTERN"] as const;
const CAT_SHORT: Record<string, string> = { LOCAL: "Local", KOREAN: "Korean", WESTERN: "Western" };
const CAT_STYLE: Record<string, string> = {
  LOCAL: "bg-status-ok/10 text-status-ok",
  KOREAN: "bg-accent-100 text-accent-700",
  WESTERN: "bg-blue-50 text-blue-700",
};

function LeadCell({ slug, productId, value, onSaved }: { slug: string; productId: string; value: number | null; onSaved: () => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [val, setVal] = useState(value == null ? "" : String(value));

  async function save() {
    setEditing(false);
    const trimmed = val.trim();
    const next = trimmed === "" ? null : Number.parseInt(trimmed, 10);
    if ((next ?? null) === (value ?? null)) return; // no change
    setBusy(true);
    try {
      const res = await apiFetch(slug, `/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadTimeDays: trimmed === "" ? null : trimmed }),
      });
      if (!res.ok) { alert("Could not save lead time"); setVal(value == null ? "" : String(value)); return; }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={1}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setVal(value == null ? "" : String(value)); setEditing(false); }
        }}
        className="w-16 text-right num text-sm border border-accent-500 rounded px-1.5 py-0.5 focus:outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => { setVal(value == null ? "" : String(value)); setEditing(true); }}
      title="Click to edit lead time"
      className="num text-mute hover:text-ink decoration-dotted underline underline-offset-2 decoration-line"
    >
      {busy ? "…" : value == null ? "— set" : `${value}d`}
    </button>
  );
}

/** Inline Local/Korean/Western badge — click to change, drives lead-time + cover defaults. */
function CategoryCell({ slug, productId, value, onSaved }: { slug: string; productId: string; value: string | null; onSaved: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function save(next: string) {
    if (next === (value ?? "")) return;
    setBusy(true);
    try {
      const res = await apiFetch(slug, `/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importCategory: next || null }),
      });
      if (!res.ok) { alert("Could not save category"); return; }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => save(e.target.value)}
      disabled={busy}
      title="Local = quick restock (17d cover) · Korean/Western imports = 28d ETA (21d cover)"
      className={`text-2xs font-medium rounded-md px-1.5 py-1 border-0 cursor-pointer appearance-none text-center ${
        value ? CAT_STYLE[value] ?? "bg-canvas-tint text-mute" : "bg-canvas-tint text-mute"
      } ${busy ? "opacity-50" : ""}`}
    >
      <option value="">—</option>
      {CATEGORIES.map((c) => (
        <option key={c} value={c}>{CAT_SHORT[c]}</option>
      ))}
    </select>
  );
}

export default function ProductsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [position, setPosition] = useState<PositionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [posWindow, setPosWindow] = useState(30);
  const [cls, setCls] = useState<Cls>("A");
  const [query, setQuery] = useState("");

  function loadPosition() {
    setLoading(true);
    return apiFetch(slug, `/api/inventory-position?window=${posWindow}`)
      .then((r) => r.json())
      .then((d) => { setPosition(d); setLoading(false); })
      .catch(() => { setPosition(null); setLoading(false); });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPosition(); }, [posWindow]);

  const grp = position?.groups[cls];

  // Search across the WHOLE catalog (all classes) when a query is typed;
  // otherwise show the selected class.
  const q = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!position) return [];
    const pool = q
      ? [...position.groups.A.rows, ...position.groups.B.rows, ...position.groups.C.rows]
      : position.groups[cls].rows;
    if (!q) return pool;
    return pool.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        (r.vendor ?? "").toLowerCase().includes(q) ||
        (r.supplierName ?? "").toLowerCase().includes(q)
    );
  }, [position, cls, q]);

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-7 space-y-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-2xs uppercase tracking-wider text-mute">Catalogue</div>
            <h1 className="text-xl font-semibold tracking-tight mt-0.5">Products</h1>
            <p className="text-2xs text-mute mt-1">Every product&apos;s run rate (units/day), what you hold, what&apos;s en route, and days of cover. Click <span className="text-ink">Lead</span> or the <span className="text-ink">category</span> to edit — they drive the reorder math.</p>
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

        {/* Search + A/B/C switcher */}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, SKU, brand or supplier…"
            className="input max-w-xs"
          />
          <div className={`inline-flex rounded-xl border border-line bg-canvas-raised p-0.5 shadow-soft ${q ? "opacity-40 pointer-events-none" : ""}`}>
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
          {q && <span className="text-2xs text-mute">{visibleRows.length} match{visibleRows.length === 1 ? "" : "es"} across all classes</span>}
        </div>

        {position?.trackingSince ? (
          <p className="text-2xs text-mute">
            Opening measured since {new Date(position.trackingSince).toLocaleDateString("en-KE")}; older windows estimated (~).
          </p>
        ) : (
          <p className="text-2xs text-mute">Opening-stock tracking starts today; openings shown are estimates (~).</p>
        )}

        {loading ? (
          <div className="space-y-3 py-4">
            <div className="skeleton h-10 max-w-md" />
            <div className="skeleton h-72" />
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="card text-center py-14 text-mute text-sm">{q ? `No products match “${query}”.` : `No products in Class ${cls}.`}</div>
        ) : (
          <section className="card overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold tracking-tight">{q ? "Search results" : `Class ${cls}`}</h2>
                <p className="text-2xs text-mute mt-0.5">{q ? "All classes" : CLASS_BLURB[cls]}</p>
              </div>
              {!q && grp && (
                <div className="flex items-center gap-3 text-2xs text-mute">
                  <span>{grp.subtotal.count} SKUs</span>
                  <span>opening {Math.round(grp.subtotal.opening)}</span>
                  <span>on-hand {Math.round(grp.subtotal.current)}</span>
                  <span>en route {Math.round(grp.subtotal.enRoute)}</span>
                </div>
              )}
            </div>
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas sticky top-0">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 font-medium text-center">Category</th>
                    <th className="px-3 py-2.5 font-medium text-right">Run/day</th>
                    <th className="px-3 py-2.5 font-medium text-right">Opening</th>
                    <th className="px-3 py-2.5 font-medium text-right">On-hand</th>
                    <th className="px-3 py-2.5 font-medium text-right">En route</th>
                    <th className="px-3 py-2.5 font-medium">Supplier</th>
                    <th className="px-3 py-2.5 font-medium text-right">Lead</th>
                    <th className="px-5 py-2.5 font-medium text-right">Days cover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleRows.map((r) => {
                    const atRisk =
                      r.daysOfCover !== null && r.leadTimeAvgDays !== null && r.daysOfCover < r.leadTimeAvgDays;
                    return (
                      <tr key={r.productId} className="hover:bg-canvas">
                        <td className="px-5 py-2.5">
                          <Link href={`/shop/${slug}/dashboard/product/${r.productId}`} className="font-medium hover:underline truncate block max-w-xs">{r.title}</Link>
                          <div className="text-2xs text-mute"><span className="num">{r.sku}</span>{r.vendor ? ` · ${r.vendor}` : ""}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <CategoryCell slug={slug} productId={r.productId} value={r.importCategory} onSaved={loadPosition} />
                        </td>
                        <td className="px-3 py-2.5 text-right num font-semibold text-ink">{r.runRate.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right num text-mute">{Math.round(r.openingOnHand)}{r.openingEstimated ? "~" : ""}</td>
                        <td className="px-3 py-2.5 text-right num">{Math.round(r.currentStock)}</td>
                        <td className="px-3 py-2.5 text-right num text-mute">
                          {r.onOrder > 0 ? (
                            <span title={r.expectedArrivalAt ? `ETA ${new Date(r.expectedArrivalAt).toLocaleDateString("en-KE")}` : undefined}>
                              {r.onOrder}{r.expectedArrivalAt ? ` (${new Date(r.expectedArrivalAt).toLocaleDateString("en-KE", { day: "numeric", month: "short" })})` : ""}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-2xs text-ink-soft truncate max-w-[140px]">{r.supplierName ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right">
                          <LeadCell slug={slug} productId={r.productId} value={r.leadTimeAvgDays} onSaved={loadPosition} />
                        </td>
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
