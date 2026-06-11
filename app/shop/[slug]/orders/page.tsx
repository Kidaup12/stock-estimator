"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type OrderRow = {
  id: string;
  productId: string | null;
  orderedQty: number | null;
  orderedAt: string | null;
  expectedArrivalAt: string | null;
  receivedAt: string | null;
  stockAtOrder: number | null;
  sawEnroute: boolean;
  product: { id: string; title: string; sku: string; vendor: string | null; importCategory: string | null; imageUrl: string | null } | null;
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "—";

const CAT_LABEL: Record<string, string> = { LOCAL: "Local", KOREAN: "Korean", WESTERN: "Western" };

export default function OrdersPage() {
  const { slug } = useParams<{ slug: string }>();
  const [active, setActive] = useState<OrderRow[]>([]);
  const [history, setHistory] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [now] = useState(() => Date.now());

  async function load() {
    const res = await apiFetch(slug, "/api/orders").then(r => r.json());
    setActive(res.active ?? []);
    setHistory(res.history ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-7 space-y-6">
        <div>
          <div className="text-2xs uppercase tracking-wider text-mute">Order tracking</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Orders</h1>
          <p className="text-sm text-mute mt-1">Everything you&apos;ve marked as ordered — what&apos;s on the way now, and the full history of what arrived when.</p>
        </div>

        {/* Active — on the way */}
        <section className="card overflow-hidden">
          <div className="px-5 pt-5 pb-4 flex items-end justify-between">
            <div>
              <div className="text-2xs uppercase tracking-wider text-mute">On the way</div>
              <h2 className="text-base font-semibold tracking-tight mt-0.5">Active orders</h2>
            </div>
            <span className="text-2xs text-mute">{active.length} order{active.length === 1 ? "" : "s"}</span>
          </div>
          {loading ? (
            <div className="px-5 pb-6 text-sm text-mute">Loading…</div>
          ) : active.length === 0 ? (
            <div className="px-5 pb-6 text-sm text-mute">
              Nothing on the way. Mark items as ordered from the <Link href={`/shop/${slug}/dashboard`} className="text-accent-700 hover:underline">dashboard</Link> or the <Link href={`/shop/${slug}/restock-planner`} className="text-accent-700 hover:underline">Restock Planner</Link>.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
                <tr>
                  <th className="px-5 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium text-right">Qty</th>
                  <th className="px-3 py-2 font-medium text-right">Ordered</th>
                  <th className="px-3 py-2 font-medium text-right">ETA</th>
                  <th className="px-3 py-2 font-medium text-right">Status</th>
                  <th className="px-5 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {active.map(o => <ActiveRow key={o.id} o={o} slug={slug} now={now} onChanged={load} />)}
              </tbody>
            </table>
          )}
        </section>

        {/* History */}
        <section className="card overflow-hidden">
          <div className="px-5 pt-5 pb-4 flex items-end justify-between">
            <div>
              <div className="text-2xs uppercase tracking-wider text-mute">Received</div>
              <h2 className="text-base font-semibold tracking-tight mt-0.5">Order history</h2>
            </div>
            <span className="text-2xs text-mute">last {history.length}</span>
          </div>
          {loading ? (
            <div className="px-5 pb-6 text-sm text-mute">Loading…</div>
          ) : history.length === 0 ? (
            <div className="px-5 pb-6 text-sm text-mute">No received orders yet — when you mark an active order as received it lands here.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
                <tr>
                  <th className="px-5 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium text-right">Qty</th>
                  <th className="px-3 py-2 font-medium text-right">Ordered</th>
                  <th className="px-3 py-2 font-medium text-right">Received</th>
                  <th className="px-5 py-2 font-medium text-right">Took</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map(o => {
                  const took = o.orderedAt && o.receivedAt
                    ? Math.max(0, Math.round((new Date(o.receivedAt).getTime() - new Date(o.orderedAt).getTime()) / 86_400_000))
                    : null;
                  const expected = o.orderedAt && o.expectedArrivalAt
                    ? Math.max(0, Math.round((new Date(o.expectedArrivalAt).getTime() - new Date(o.orderedAt).getTime()) / 86_400_000))
                    : null;
                  const late = took != null && expected != null && took > expected;
                  return (
                    <tr key={o.id} className="hover:bg-canvas">
                      <td className="px-5 py-2.5"><ProductCell o={o} slug={slug} /></td>
                      <td className="px-3 py-2.5 text-right num">{o.orderedQty ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right num">{fmtDate(o.orderedAt)}</td>
                      <td className="px-3 py-2.5 text-right num">{fmtDate(o.receivedAt)}</td>
                      <td className="px-5 py-2.5 text-right num">
                        {took != null ? `${took}d` : "—"}
                        {expected != null && (
                          <span className={`ml-1 text-2xs ${late ? "text-status-warn" : "text-mute"}`}>vs {expected}d est</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}

function ProductCell({ o, slug }: { o: OrderRow; slug: string }) {
  const cat = o.product?.importCategory ? CAT_LABEL[o.product.importCategory] ?? null : null;
  return (
    <div>
      {o.product ? (
        <Link href={`/shop/${slug}/dashboard/product/${o.product.id}`} className="font-medium hover:underline truncate block max-w-xs">
          {o.product.title}
        </Link>
      ) : (
        <span className="text-mute">Deleted product</span>
      )}
      <div className="text-2xs text-mute">
        {o.product?.sku ?? "—"} · {o.product?.vendor ?? "—"}{cat ? ` · ${cat}` : ""}
      </div>
    </div>
  );
}

function ActiveRow({ o, slug, now, onChanged }: { o: OrderRow; slug: string; now: number; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const daysLeft = o.expectedArrivalAt
    ? Math.ceil((new Date(o.expectedArrivalAt).getTime() - now) / 86_400_000)
    : null;
  const overdue = daysLeft != null && daysLeft < 0;

  async function act(path: string, e: MouseEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch(slug, path, { method: "POST" });
      if (res.ok) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="hover:bg-canvas">
      <td className="px-5 py-2.5"><ProductCell o={o} slug={slug} /></td>
      <td className="px-3 py-2.5 text-right num">{o.orderedQty ?? "—"}</td>
      <td className="px-3 py-2.5 text-right num">{fmtDate(o.orderedAt)}</td>
      <td className="px-3 py-2.5 text-right num">{fmtDate(o.expectedArrivalAt)}</td>
      <td className="px-3 py-2.5 text-right">
        {overdue ? (
          <span className="text-2xs font-semibold text-status-warn">overdue {Math.abs(daysLeft!)}d</span>
        ) : daysLeft != null ? (
          <span className="text-2xs text-mute">in {daysLeft}d{o.sawEnroute ? " · seen en route ✓" : ""}</span>
        ) : (
          <span className="text-2xs text-mute">—</span>
        )}
      </td>
      <td className="px-5 py-2.5 text-right whitespace-nowrap">
        <button onClick={e => act(`/api/orders/${o.id}/received`, e)} disabled={busy} className="btn-ghost text-2xs mr-1.5 disabled:opacity-50">
          Mark received
        </button>
        <button onClick={e => act(`/api/orders/${o.id}/unorder`, e)} disabled={busy} className="text-2xs text-mute hover:text-status-bad transition disabled:opacity-50">
          Undo
        </button>
      </td>
    </tr>
  );
}
