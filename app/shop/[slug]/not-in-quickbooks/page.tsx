"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type Flagged = {
  id: string; title: string; sku: string; vendor: string | null;
  currentStock: number; activeOverride: boolean; sold90: number;
};

export default function NotInQuickBooksPage() {
  const { slug } = useParams<{ slug: string }>();
  const [rows, setRows] = useState<Flagged[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await apiFetch(slug, "/api/qb/flagged").then((x) => (x.ok ? x.json() : { products: [] }));
    setRows(r.products ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function keepActive(id: string) {
    setBusy(id);
    try {
      await apiFetch(slug, `/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true, activeOverride: true }),
      });
      await load();
    } finally { setBusy(null); }
  }

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 py-7">
        <div className="mb-6">
          <div className="text-2xs uppercase tracking-wider text-mute">Catalogue review</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Not in QuickBooks</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-2xl">
            QuickBooks has no record of these products, so they&apos;re held out of the buy list.
            Out-of-stock items still in QuickBooks are NOT here. If one is real, keep it active.
          </p>
        </div>

        {loading ? (
          <div className="skeleton h-40" />
        ) : rows.length === 0 ? (
          <div className="card p-8 text-center text-sm text-mute">
            Nothing flagged — every product is in QuickBooks.{" "}
            <Link href={`/shop/${slug}/dashboard`} className="text-accent-700 hover:underline">Back to dashboard</Link>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-line text-2xs uppercase tracking-wider text-mute">
              {rows.length} flagged
            </div>
            <div className="divide-y divide-line max-h-[70vh] overflow-y-auto">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <Link href={`/shop/${slug}/dashboard/product/${r.id}`} className="text-sm font-medium truncate block hover:underline">
                      {r.title}
                    </Link>
                    <div className="text-2xs text-mute num">
                      {r.sku} · {r.vendor || "—"} · stock {r.currentStock.toFixed(0)} · 90d sold {r.sold90.toFixed(0)}
                    </div>
                  </div>
                  <button
                    onClick={() => keepActive(r.id)}
                    disabled={busy === r.id}
                    className="btn-ghost text-sm disabled:opacity-50 shrink-0"
                  >
                    {busy === r.id ? "…" : "Keep active"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
