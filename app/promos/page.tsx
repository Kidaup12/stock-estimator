"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Promo = {
  id: string;
  startDate: string;
  endDate: string;
  scope: "all" | "sku" | "category" | "brand";
  scopeValue: string | null;
  discountPct: number;
  promoType: "payday" | "holiday" | "flash" | "gwp";
  channel: "shopify" | "whatsapp" | "instagram" | "all";
  notes: string | null;
};

type PromoForm = {
  id?: string;
  startDate: string;
  endDate: string;
  scope: "all" | "sku" | "category" | "brand";
  scopeValue: string;
  discountPct: number;
  promoType: "payday" | "holiday" | "flash" | "gwp";
  channel: "shopify" | "whatsapp" | "instagram" | "all";
  notes: string;
};

const emptyForm: PromoForm = {
  id: undefined,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date().toISOString().slice(0, 10),
  scope: "all",
  scopeValue: "",
  discountPct: 10,
  promoType: "flash",
  channel: "all",
  notes: "",
};

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [editing, setEditing] = useState<PromoForm | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/promos");
    const data = await res.json();
    setPromos(data.promos || []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    const res = await fetch("/api/promos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...editing,
        scopeValue: editing.scope === "all" ? null : editing.scopeValue || null,
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
      <div className="max-w-5xl mx-auto">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">← Dashboard</Link>
        <div className="flex items-center justify-between mt-2 mb-6">
          <h1 className="text-3xl font-bold">Promo Calendar</h1>
          <button onClick={() => setEditing({ ...emptyForm })} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">
            + Add promo
          </button>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          Active promos feed the Layer-2 forecast. Common Kenya patterns: payday-week WhatsApp drops (25–30 each month, 15%), V-Day fragrance push, Jamhuri sitewide.
        </p>

        {editing && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 mb-6">
            <h2 className="font-semibold mb-4">{editing.id ? "Edit promo" : "New promo"}</h2>
            <div className="grid grid-cols-2 gap-4">
              <DateField label="Start date" value={editing.startDate} onChange={v => setEditing({ ...editing, startDate: v })} />
              <DateField label="End date" value={editing.endDate} onChange={v => setEditing({ ...editing, endDate: v })} />
              <SelectField label="Scope" value={editing.scope} onChange={v => setEditing({ ...editing, scope: v as typeof editing.scope })} options={["all", "sku", "category", "brand"]} />
              {editing.scope !== "all" && (
                <Field label={`Scope value (${editing.scope})`} value={editing.scopeValue} onChange={v => setEditing({ ...editing, scopeValue: v })} placeholder={editing.scope === "category" ? "FRAGRANCE, SKINCARE…" : editing.scope === "brand" ? "COSRX, LANEIGE…" : "SKU-12369"} />
              )}
              <Field label="Discount %" value={String(editing.discountPct)} onChange={v => setEditing({ ...editing, discountPct: parseFloat(v) || 0 })} type="number" />
              <SelectField label="Promo type" value={editing.promoType} onChange={v => setEditing({ ...editing, promoType: v as typeof editing.promoType })} options={["payday", "holiday", "flash", "gwp"]} />
              <SelectField label="Channel" value={editing.channel} onChange={v => setEditing({ ...editing, channel: v as typeof editing.channel })} options={["all", "shopify", "whatsapp", "instagram"]} />
              <div className="col-span-2">
                <Field label="Notes" value={editing.notes} onChange={v => setEditing({ ...editing, notes: v })} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white px-4 py-2 rounded text-sm font-medium">
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
                <th className="text-left px-4 py-3">Dates</th>
                <th className="text-left px-4 py-3">Scope</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Channel</th>
                <th className="text-right px-4 py-3">Discount</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {promos.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No promos scheduled</td></tr>
              ) : promos.map(p => (
                <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3">
                    <div>{new Date(p.startDate).toLocaleDateString()}</div>
                    <div className="text-xs text-zinc-500">→ {new Date(p.endDate).toLocaleDateString()}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{p.scope}</span>
                    {p.scopeValue && <span className="text-xs text-zinc-500 ml-2">{p.scopeValue}</span>}
                  </td>
                  <td className="px-4 py-3 capitalize">{p.promoType}</td>
                  <td className="px-4 py-3 capitalize">{p.channel}</td>
                  <td className="px-4 py-3 text-right font-bold text-pink-600">{p.discountPct}%</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing({
                      id: p.id,
                      startDate: p.startDate.slice(0, 10),
                      endDate: p.endDate.slice(0, 10),
                      scope: p.scope,
                      scopeValue: p.scopeValue || "",
                      discountPct: p.discountPct,
                      promoType: p.promoType,
                      channel: p.channel,
                      notes: p.notes || "",
                    })} className="text-xs text-blue-600 hover:underline">Edit</button>
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

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label} value={value} onChange={onChange} type="date" />;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
