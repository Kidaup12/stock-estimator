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
  latestOrder: { id: string; status: string } | null;
};

const KES = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });

export default function Dashboard() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"urgent" | "review" | "all">("urgent");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/forecast");
    const data = await res.json();
    setPredictions(data.predictions || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function rerun() {
    setBusy(true);
    await fetch("/api/forecast/run", { method: "POST" });
    await load();
    setBusy(false);
  }

  async function approveOrder(orderId: string) {
    await fetch(`/api/orders/${orderId}/approve`, { method: "POST" });
    await load();
  }
  async function skipOrder(orderId: string) {
    await fetch(`/api/orders/${orderId}/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "manual skip" }),
    });
    await load();
  }

  const filtered = predictions.filter(p =>
    p.product.title.toLowerCase().includes(search.toLowerCase()) ||
    p.product.sku.toLowerCase().includes(search.toLowerCase()) ||
    (p.product.vendor ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const urgent = filtered.filter(p => p.urgency === "critical" || p.urgency === "high");
  const review = filtered.filter(p => p.urgency === "medium");
  const all = filtered;

  const visible = tab === "urgent" ? urgent : tab === "review" ? review : all;

  const totalRecKes = urgent.reduce((s, p) => s + p.recommendedQty * p.product.priceKes, 0);
  const lowStock = predictions.filter(p => p.product.currentStock < 10).length;

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
            <Link href="/promos" className="btn-ghost">Promos</Link>
            <Link href="/suppliers" className="btn-ghost">Suppliers</Link>
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
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Today&apos;s reorder queue</h1>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line rounded-2xl overflow-hidden shadow-soft mb-6">
          <Kpi label="Products tracked" value={predictions.length.toString()} hint="Across the catalogue" />
          <Kpi label="Urgent reorders" value={urgent.length.toString()} hint="Critical or high priority" tone={urgent.length > 0 ? "alarm" : "default"} />
          <Kpi label="Low stock (<10)" value={lowStock.toString()} hint="Below the soft floor" tone={lowStock > 0 ? "warn" : "default"} />
          <Kpi label="Urgent order value" value={`KES ${KES(totalRecKes)}`} hint="If approved today" />
        </div>

        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="inline-flex rounded-xl border border-line bg-canvas-raised p-0.5 shadow-soft">
            <TabBtn active={tab === "urgent"} onClick={() => setTab("urgent")} label="Urgent" count={urgent.length} />
            <TabBtn active={tab === "review"} onClick={() => setTab("review")} label="Review" count={review.length} />
            <TabBtn active={tab === "all"}    onClick={() => setTab("all")}    label="All"    count={all.length} />
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
        ) : tab === "urgent" ? (
          <div className="grid gap-3">
            {visible.map(p => <UrgentCard key={p.id} p={p} onApprove={approveOrder} onSkip={skipOrder} />)}
          </div>
        ) : (
          <ProductTable predictions={visible} />
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
      <span className={`text-2xs num ${active ? "text-white/70" : "text-mute"}`}>{count}</span>
    </button>
  );
}

function UrgentCard({ p, onApprove, onSkip }: { p: Prediction; onApprove: (id: string) => void; onSkip: (id: string) => void }) {
  const isCrit = p.urgency === "critical";
  const accent = isCrit
    ? "border-status-bad/25 bg-status-bad/[0.03]"
    : "border-status-warn/25 bg-status-warn/[0.03]";
  const pillTone = isCrit
    ? "bg-status-bad/10 text-status-bad"
    : "bg-status-warn/10 text-status-warn";

  return (
    <div className={`rounded-2xl border ${accent} p-5 shadow-soft`}>
      <div className="flex gap-4">
        {p.product.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={p.product.imageUrl} alt={p.product.title} className="w-20 h-20 rounded-xl object-cover flex-shrink-0 border border-line" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/dashboard/product/${p.product.id}`} className="font-medium hover:underline block truncate">
                {p.product.title}
              </Link>
              <div className="text-2xs text-mute mt-1 num">
                {p.product.sku} · {p.product.vendor || "—"} · {p.product.productType || "—"}
              </div>
            </div>
            <span className={`text-2xs font-semibold uppercase tracking-wider px-2 py-1 rounded-md ${pillTone}`}>
              {p.urgency}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-4 mt-4">
            <Field label="Stock" value={p.product.currentStock.toFixed(0)} />
            <Field label="Days left" value={`${p.daysUntilStockout}d`} tone={p.daysUntilStockout < 7 ? "bad" : "default"} />
            <Field label="30d forecast" value={p.finalForecast30d.toFixed(0)} />
            <Field label="Recommend" value={`${p.recommendedQty.toFixed(0)} u`} tone="accent" />
          </div>

          {p.signals.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {p.signals.map((s, i) => (
                <span key={i} className="text-2xs px-2 py-1 rounded-md bg-canvas-tint border border-line text-ink-soft">
                  {s.emoji} {s.label}
                </span>
              ))}
            </div>
          )}

          {p.latestOrder && p.latestOrder.status === "pending" && (
            <div className="mt-5 flex gap-2">
              <button onClick={() => onApprove(p.latestOrder!.id)} className="btn-accent">
                Approve · KES {KES(p.recommendedQty * p.product.priceKes)}
              </button>
              <button onClick={() => onSkip(p.latestOrder!.id)} className="btn-ghost">
                Skip
              </button>
            </div>
          )}
          {p.latestOrder && p.latestOrder.status === "approved" && (
            <div className="mt-5 text-2xs uppercase tracking-wider text-status-ok font-medium">✓ Approved · mock draft PO created</div>
          )}
          {p.latestOrder && p.latestOrder.status === "skipped" && (
            <div className="mt-5 text-2xs uppercase tracking-wider text-mute">Skipped</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "bad" | "accent" }) {
  const c = tone === "bad" ? "text-status-bad" : tone === "accent" ? "text-accent-700" : "text-ink";
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-mute">{label}</div>
      <div className={`text-sm font-semibold num mt-1 ${c}`}>{value}</div>
    </div>
  );
}

function ProductTable({ predictions }: { predictions: Prediction[] }) {
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
              <th className="px-5 py-3 font-medium text-right">30d fcst</th>
              <th className="px-5 py-3 font-medium text-right">Reorder</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {predictions.map(p => (
              <tr key={p.id} className="hover:bg-canvas">
                <td className="px-5 py-3">
                  <Link href={`/dashboard/product/${p.product.id}`} className="font-medium hover:underline">{p.product.title}</Link>
                  <div className="text-2xs text-mute num mt-0.5">{p.product.sku}</div>
                </td>
                <td className="px-5 py-3 text-ink-soft">{p.product.vendor || "—"}</td>
                <td className="px-5 py-3 text-mute text-xs">{p.product.productType || "—"}</td>
                <td className="px-5 py-3 text-center">
                  <AbcPill code={p.product.abcCategory} />
                </td>
                <td className={`px-5 py-3 text-right num font-medium ${p.product.currentStock < 10 ? "text-status-bad" : ""}`}>{p.product.currentStock.toFixed(0)}</td>
                <td className={`px-5 py-3 text-right num ${p.daysUntilStockout < 14 ? "text-status-bad font-medium" : ""}`}>{p.daysUntilStockout}</td>
                <td className="px-5 py-3 text-right num">{p.finalForecast30d.toFixed(0)}</td>
                <td className="px-5 py-3 text-right num font-semibold text-accent-700">{p.recommendedQty.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AbcPill({ code }: { code: string | null }) {
  const c = code === "A" ? "bg-status-ok/10 text-status-ok"
          : code === "B" ? "bg-accent-100 text-accent-700"
          : "bg-canvas-tint text-mute";
  return (
    <span className={`text-2xs font-semibold px-2 py-0.5 rounded-md ${c}`}>{code || "C"}</span>
  );
}
