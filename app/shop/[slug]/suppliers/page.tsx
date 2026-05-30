"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type Supplier = {
  id: string;
  name: string;
  country: string | null;
  currency: string;
  leadTimeAvgDays: number;
  leadTimeStdDays: number;
  moq: number;
  notes: string | null;
};

const empty: Omit<Supplier, "id"> & { id?: string } = {
  name: "",
  country: "",
  currency: "USD",
  leadTimeAvgDays: 30,
  leadTimeStdDays: 7,
  moq: 1,
  notes: "",
};

export default function SuppliersPage() {
  const { slug } = useParams<{ slug: string }>();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<typeof empty | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await apiFetch(slug, "/api/suppliers");
    const data = await res.json();
    setSuppliers(data.suppliers || []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    const res = await apiFetch(slug, "/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...editing,
        country: editing.country || null,
        notes: editing.notes || null,
      }),
    });
    if (res.ok) {
      setEditing(null);
      await load();
    } else {
      const err = await res.json();
      alert(err.error || "Save failed");
    }
    setSaving(false);
  }

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link href={`/shop/${slug}/dashboard`} className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">
            ← Dashboard
          </Link>
          <div className="flex items-baseline gap-2.5">
            <div className="h-5 w-5 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-sm font-semibold tracking-tight">Wezesha Restock OS</span>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 sm:px-8 py-7">
        <div className="flex items-end justify-between mb-7 gap-3 flex-wrap">
          <div>
            <div className="text-2xs uppercase tracking-wider text-mute">Replenishment</div>
            <h1 className="text-xl font-semibold tracking-tight mt-0.5">Suppliers</h1>
          </div>
          <button onClick={() => setEditing({ ...empty })} className="btn-accent">
            + Add supplier
          </button>
        </div>

        <p className="text-sm text-ink-soft leading-relaxed mb-6 max-w-2xl">
          Lead times affect safety stock via King&apos;s formula. For Kenyan beauty importers:
          Guangzhou typically 45d ± 12d sea, Dubai 14d ± 4d, EU 28d ± 7d.
        </p>

        {editing && (
          <div className="card p-6 mb-6">
            <div className="mb-4">
              <div className="text-2xs uppercase tracking-wider text-mute">{editing.id ? "Editing" : "New record"}</div>
              <h2 className="text-base font-semibold tracking-tight mt-1">{editing.id ? "Edit supplier" : "New supplier"}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name" value={editing.name} onChange={v => setEditing({ ...editing, name: v })} />
              <Field label="Country" value={editing.country || ""} onChange={v => setEditing({ ...editing, country: v })} placeholder="China, Dubai, Kenya, …" />
              <Field label="Currency" value={editing.currency} onChange={v => setEditing({ ...editing, currency: v })} placeholder="USD, AED, KES, EUR" />
              <Field label="Lead time avg (days)" value={String(editing.leadTimeAvgDays)} onChange={v => setEditing({ ...editing, leadTimeAvgDays: parseInt(v) || 0 })} type="number" />
              <Field label="Lead time std dev (days)" value={String(editing.leadTimeStdDays)} onChange={v => setEditing({ ...editing, leadTimeStdDays: parseInt(v) || 0 })} type="number" />
              <Field label="MOQ" value={String(editing.moq)} onChange={v => setEditing({ ...editing, moq: parseInt(v) || 1 })} type="number" />
              <div className="sm:col-span-2">
                <Field label="Notes" value={editing.notes || ""} onChange={v => setEditing({ ...editing, notes: v })} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={save} disabled={saving || !editing.name} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(null)} className="btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-2xs uppercase tracking-wider text-mute bg-canvas">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Country</th>
                  <th className="px-5 py-3 font-medium">Currency</th>
                  <th className="px-5 py-3 font-medium text-right">Lead</th>
                  <th className="px-5 py-3 font-medium text-right">MOQ</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {suppliers.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-mute text-sm">No suppliers yet</td></tr>
                ) : suppliers.map(s => (
                  <tr key={s.id} className="hover:bg-canvas">
                    <td className="px-5 py-3 font-medium">{s.name}</td>
                    <td className="px-5 py-3 text-ink-soft">{s.country || "—"}</td>
                    <td className="px-5 py-3 text-ink-soft num">{s.currency}</td>
                    <td className="px-5 py-3 text-right num">{s.leadTimeAvgDays}d ± {s.leadTimeStdDays}d</td>
                    <td className="px-5 py-3 text-right num">{s.moq}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => setEditing({ ...s })} className="text-2xs uppercase tracking-wider text-accent-700 hover:text-accent-800">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input"
      />
    </label>
  );
}
