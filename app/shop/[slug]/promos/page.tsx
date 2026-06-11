"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

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
  const { slug } = useParams<{ slug: string }>();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [editing, setEditing] = useState<PromoForm | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await apiFetch(slug, "/api/promos");
    const data = await res.json();
    setPromos(data.promos || []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    const res = await apiFetch(slug, "/api/promos", {
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
    <main className="min-h-screen bg-canvas">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-7">
        <div className="flex items-end justify-between mb-7 gap-3 flex-wrap">
          <div>
            <div className="page-eyebrow">Demand signals</div>
            <h1 className="page-title">Promo calendar</h1>
            <p className="page-sub">Promos scheduled here lift the forecast for their dates — typical Kenya rhythm: payday-week drops on the 25th–30th, V-Day fragrance, Jamhuri sitewide.</p>
          </div>
          <button onClick={() => setEditing({ ...emptyForm })} className="btn-accent">
            Add promo
          </button>
        </div>

        {editing && (
          <div className="card p-6 mb-6">
            <h2 className="text-base font-semibold tracking-tight mb-4">{editing.id ? "Edit promo" : "New promo"}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DateField label="Start date" value={editing.startDate} onChange={v => setEditing({ ...editing, startDate: v })} />
              <DateField label="End date" value={editing.endDate} onChange={v => setEditing({ ...editing, endDate: v })} />
              <SelectField label="Scope" value={editing.scope} onChange={v => setEditing({ ...editing, scope: v as typeof editing.scope })} options={["all", "sku", "category", "brand"]} />
              {editing.scope !== "all" && (
                <Field label={`Scope value (${editing.scope})`} value={editing.scopeValue} onChange={v => setEditing({ ...editing, scopeValue: v })} placeholder={editing.scope === "category" ? "FRAGRANCE, SKINCARE…" : editing.scope === "brand" ? "COSRX, LANEIGE…" : "SKU-12369"} />
              )}
              <Field label="Discount %" value={String(editing.discountPct)} onChange={v => setEditing({ ...editing, discountPct: parseFloat(v) || 0 })} type="number" />
              <SelectField label="Promo type" value={editing.promoType} onChange={v => setEditing({ ...editing, promoType: v as typeof editing.promoType })} options={["payday", "holiday", "flash", "gwp"]} />
              <SelectField label="Channel" value={editing.channel} onChange={v => setEditing({ ...editing, channel: v as typeof editing.channel })} options={["all", "shopify", "whatsapp", "instagram"]} />
              <div className="sm:col-span-2">
                <Field label="Notes" value={editing.notes} onChange={v => setEditing({ ...editing, notes: v })} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={save} disabled={saving} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
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
                  <th className="px-5 py-3 font-medium">Dates</th>
                  <th className="px-5 py-3 font-medium">Scope</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Channel</th>
                  <th className="px-5 py-3 font-medium text-right">Discount</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {promos.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-mute text-sm">No promos scheduled</td></tr>
                ) : promos.map(p => (
                  <tr key={p.id} className="hover:bg-canvas">
                    <td className="px-5 py-3">
                      <div className="num">{new Date(p.startDate).toLocaleDateString()}</div>
                      <div className="text-2xs text-mute mt-0.5 num">→ {new Date(p.endDate).toLocaleDateString()}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-medium capitalize">{p.scope}</span>
                      {p.scopeValue && <span className="text-2xs text-mute ml-2 num">{p.scopeValue}</span>}
                    </td>
                    <td className="px-5 py-3 capitalize text-ink-soft">{p.promoType}</td>
                    <td className="px-5 py-3 capitalize text-ink-soft">{p.channel}</td>
                    <td className="px-5 py-3 text-right font-semibold text-accent-700 num">{p.discountPct}%</td>
                    <td className="px-5 py-3 text-right">
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
                      })} className="text-2xs uppercase tracking-wider text-accent-700 hover:text-accent-800">
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

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label} value={value} onChange={onChange} type="date" />;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input capitalize"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
