"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type PoRow = {
  id: string;
  poNumber: string;
  status: string;
  currency: string;
  subtotalKes: number;
  createdAt: string;
  sentAt: string | null;
  supplier: { name: string; country: string | null };
  _count: { lines: number };
};

const KES = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

/**
 * Download helper: uses apiFetch (attaches x-tenant-slug header) to fetch the
 * binary response, then triggers a blob-URL download. window.open() cannot send
 * custom headers, so we must use fetch+blob to honour tenant context.
 */
async function downloadFile(slug: string, path: string, filename: string) {
  const res = await apiFetch(slug, path);
  if (!res.ok) {
    alert(`Download failed (${res.status})`);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PurchaseOrdersPage() {
  const { slug } = useParams<{ slug: string }>();
  const [pos, setPos] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  function load() {
    apiFetch(slug, "/api/purchase-orders")
      .then((r) => r.json())
      .then((d) => {
        setPos(d.purchaseOrders || []);
        setLoading(false);
      });
  }
  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setGenerating(true);
    try {
      const r = await apiFetch(slug, "/api/purchase-orders/generate", { method: "POST" });
      const d = await r.json();
      alert(
        d.created > 0
          ? `Generated ${d.created} purchase order(s).`
          : "No approved orders to turn into POs."
      );
      load();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link
            href={`/shop/${slug}/dashboard`}
            className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition"
          >
            ← Dashboard
          </Link>
          <button
            onClick={generate}
            disabled={generating}
            className="text-2xs px-3 py-1.5 rounded border border-ink text-ink disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate POs"}
          </button>
        </div>
      </header>

      <section className="max-w-7xl mx-auto px-5 sm:px-8 py-8">
        <h1 className="text-sm font-semibold text-ink mb-4">Purchase Orders</h1>

        {loading ? (
          <p className="text-sm text-mute">Loading…</p>
        ) : pos.length === 0 ? (
          <p className="text-sm text-mute">
            No purchase orders yet. Approve reorder suggestions on the dashboard, then click
            &ldquo;Generate POs&rdquo;.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-2xs">
              <thead className="text-mute">
                <tr className="border-b border-line">
                  <th className="text-left p-2">PO #</th>
                  <th className="text-left p-2">Supplier</th>
                  <th className="text-right p-2">Lines</th>
                  <th className="text-right p-2">Subtotal</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-right p-2">Files</th>
                  <th className="text-right p-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-b border-line/50">
                    <td className="p-2 text-ink">{p.poNumber}</td>
                    <td className="p-2">{p.supplier.name}</td>
                    <td className="p-2 text-right">{p._count.lines}</td>
                    <td className="p-2 text-right">{KES(p.subtotalKes)}</td>
                    <td className="p-2">{p.status}</td>
                    <td className="p-2 text-right">
                      <button
                        className="text-ink underline mr-2"
                        onClick={() =>
                          downloadFile(
                            slug,
                            `/api/purchase-orders/${p.id}/pdf`,
                            `${p.poNumber}.pdf`
                          )
                        }
                      >
                        PDF
                      </button>
                      <button
                        className="text-ink underline"
                        onClick={() =>
                          downloadFile(
                            slug,
                            `/api/purchase-orders/${p.id}/xlsx`,
                            `${p.poNumber}.xlsx`
                          )
                        }
                      >
                        XLSX
                      </button>
                    </td>
                    <td className="p-2 text-right">
                      <button
                        disabled
                        title="Resend key not configured yet"
                        className="opacity-40 cursor-not-allowed"
                      >
                        Email
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
