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
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:underline">← Home</Link>
            <h1 className="text-3xl font-bold mt-1">Dashboard</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/promos" className="text-sm px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">Promos</Link>
            <Link href="/suppliers" className="text-sm px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">Suppliers</Link>
            <button onClick={rerun} disabled={busy} className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white px-4 py-2 rounded text-sm font-medium">
              {busy ? "Running…" : "Re-run forecasts"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <Stat label="Products tracked" value={predictions.length.toString()} />
          <Stat label="Urgent reorders" value={urgent.length.toString()} accent={urgent.length > 0 ? "red" : undefined} />
          <Stat label="Low stock (<10)" value={lowStock.toString()} accent={lowStock > 0 ? "amber" : undefined} />
          <Stat label="Urgent KES order value" value={`KES ${KES(totalRecKes)}`} />
        </div>

        <div className="flex gap-1 mb-4 border-b border-zinc-200 dark:border-zinc-800">
          <Tab active={tab === "urgent"} onClick={() => setTab("urgent")} label={`Urgent (${urgent.length})`} />
          <Tab active={tab === "review"} onClick={() => setTab("review")} label={`Review (${review.length})`} />
          <Tab active={tab === "all"} onClick={() => setTab("all")} label={`All (${all.length})`} />
        </div>

        <input
          type="search"
          placeholder="Search products, SKU, brand…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
        />

        {loading ? (
          <div className="text-center py-12 text-zinc-500">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            {predictions.length === 0 ? "No forecasts yet. Run sync from the onboarding flow." : "Nothing here."}
          </div>
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: "red" | "amber" }) {
  const c = accent === "red" ? "text-red-600" : accent === "amber" ? "text-amber-600" : "";
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${c}`}>{value}</div>
    </div>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition ${active ? "border-b-2 border-blue-600 text-blue-700 dark:text-blue-400" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}
    >
      {label}
    </button>
  );
}

function UrgentCard({ p, onApprove, onSkip }: { p: Prediction; onApprove: (id: string) => void; onSkip: (id: string) => void }) {
  const urgencyColor = p.urgency === "critical" ? "border-red-500 bg-red-50 dark:bg-red-950/30" : "border-orange-400 bg-orange-50 dark:bg-orange-950/30";
  return (
    <div className={`rounded-lg border-2 ${urgencyColor} p-5`}>
      <div className="flex gap-4">
        {p.product.imageUrl && (
          <img src={p.product.imageUrl} alt={p.product.title} className="w-20 h-20 rounded object-cover flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/dashboard/product/${p.product.id}`} className="font-semibold hover:underline block truncate">
                {p.product.title}
              </Link>
              <div className="text-xs text-zinc-500 mt-1 font-mono">{p.product.sku} · {p.product.vendor || "—"} · {p.product.productType || "—"}</div>
            </div>
            <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${p.urgency === "critical" ? "bg-red-600 text-white" : "bg-orange-500 text-white"}`}>
              {p.urgency}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-3 mt-3 text-sm">
            <div>
              <div className="text-xs text-zinc-500">Stock</div>
              <div className="font-bold">{p.product.currentStock.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Days left</div>
              <div className={`font-bold ${p.daysUntilStockout < 7 ? "text-red-600" : ""}`}>{p.daysUntilStockout}d</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">30d forecast</div>
              <div className="font-bold">{p.finalForecast30d.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Recommend</div>
              <div className="font-bold text-blue-600">{p.recommendedQty.toFixed(0)} units</div>
            </div>
          </div>

          {p.signals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {p.signals.map((s, i) => (
                <span key={i} className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">{s.emoji} {s.label}</span>
              ))}
            </div>
          )}

          {p.latestOrder && p.latestOrder.status === "pending" && (
            <div className="mt-4 flex gap-2">
              <button onClick={() => onApprove(p.latestOrder!.id)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">
                Approve · KES {KES(p.recommendedQty * p.product.priceKes)}
              </button>
              <button onClick={() => onSkip(p.latestOrder!.id)} className="border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-4 py-2 rounded text-sm">
                Skip
              </button>
            </div>
          )}
          {p.latestOrder && p.latestOrder.status === "approved" && (
            <div className="mt-4 text-xs text-green-700 dark:text-green-300 font-medium">✓ Approved · mock draft PO created</div>
          )}
          {p.latestOrder && p.latestOrder.status === "skipped" && (
            <div className="mt-4 text-xs text-zinc-500">Skipped</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductTable({ predictions }: { predictions: Prediction[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-100 dark:bg-zinc-800 text-xs uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
          <tr>
            <th className="text-left px-4 py-3">Product</th>
            <th className="text-left px-4 py-3">Brand</th>
            <th className="text-left px-4 py-3">Type</th>
            <th className="text-center px-4 py-3">ABC</th>
            <th className="text-right px-4 py-3">Stock</th>
            <th className="text-right px-4 py-3">Days</th>
            <th className="text-right px-4 py-3">30d fcst</th>
            <th className="text-right px-4 py-3">Reorder</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {predictions.map(p => (
            <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <td className="px-4 py-3">
                <Link href={`/dashboard/product/${p.product.id}`} className="font-medium hover:underline">{p.product.title}</Link>
                <div className="text-xs text-zinc-500 font-mono">{p.product.sku}</div>
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{p.product.vendor || "—"}</td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 text-xs">{p.product.productType || "—"}</td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xs font-bold px-2 py-1 rounded ${
                  p.product.abcCategory === "A" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                  p.product.abcCategory === "B" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                  "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}>{p.product.abcCategory || "C"}</span>
              </td>
              <td className={`px-4 py-3 text-right font-semibold ${p.product.currentStock < 10 ? "text-red-600" : ""}`}>{p.product.currentStock.toFixed(0)}</td>
              <td className={`px-4 py-3 text-right ${p.daysUntilStockout < 14 ? "text-red-600 font-semibold" : ""}`}>{p.daysUntilStockout}</td>
              <td className="px-4 py-3 text-right">{p.finalForecast30d.toFixed(0)}</td>
              <td className="px-4 py-3 text-right font-semibold text-blue-600">{p.recommendedQty.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
