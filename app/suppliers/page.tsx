"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<typeof empty | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/suppliers");
    const data = await res.json();
    setSuppliers(data.suppliers || []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    const res = await fetch("/api/suppliers", {
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
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">← Dashboard</Link>
        <div className="flex items-center justify-between mt-2 mb-6">
          <h1 className="text-3xl font-bold">Suppliers</h1>
          <button onClick={() => setEditing({ ...empty })} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">
            + Add supplier
          </button>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          Lead times affect safety stock via King&apos;s formula. For Kenyan beauty importers: Guangzhou typically 45d ±12d sea, Dubai 14d ±4d, EU 28d ±7d.
        </p>

        {editing && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 mb-6">
            <h2 className="font-semibold mb-4">{editing.id ? "Edit supplier" : "New supplier"}</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name" value={editing.name} onChange={v => setEditing({ ...editing, name: v })} />
              <Field label="Country" value={editing.country || ""} onChange={v => setEditing({ ...editing, country: v })} placeholder="China, Dubai, Kenya, …" />
              <Field label="Currency" value={editing.currency} onChange={v => setEditing({ ...editing, currency: v })} placeholder="USD, AED, KES, EUR" />
              <Field label="Lead time avg (days)" value={String(editing.leadTimeAvgDays)} onChange={v => setEditing({ ...editing, leadTimeAvgDays: parseInt(v) || 0 })} type="number" />
              <Field label="Lead time std dev (days)" value={String(editing.leadTimeStdDays)} onChange={v => setEditing({ ...editing, leadTimeStdDays: parseInt(v) || 0 })} type="number" />
              <Field label="MOQ" value={String(editing.moq)} onChange={v => setEditing({ ...editing, moq: parseInt(v) || 1 })} type="number" />
              <div className="col-span-2">
                <Field label="Notes" value={editing.notes || ""} onChange={v => setEditing({ ...editing, notes: v })} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={save} disabled={saving || !editing.name} className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white px-4 py-2 rounded text-sm font-medium">
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(null)} className="border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-4 py-2 rounded text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 dark:bg-zinc-800 text-xs uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Country</th>
                <th className="text-left px-4 py-3">Currency</th>
                <th className="text-right px-4 py-3">Lead</th>
                <th className="text-right px-4 py-3">MOQ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {suppliers.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No suppliers yet</td></tr>
              ) : suppliers.map(s => (
                <tr key={s.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{s.country || "—"}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{s.currency}</td>
                  <td className="px-4 py-3 text-right">{s.leadTimeAvgDays}d ± {s.leadTimeStdDays}d</td>
                  <td className="px-4 py-3 text-right">{s.moq}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing({ ...s })} className="text-xs text-blue-600 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>
  );
}
