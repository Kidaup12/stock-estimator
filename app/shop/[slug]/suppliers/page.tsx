"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { toCsv, saveTextFile } from "@/lib/csv";

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
  currency: "KES",
  leadTimeAvgDays: 30,
  leadTimeStdDays: 7,
  moq: 1,
  notes: "",
};

type ImportResult = { created: number; updated: number; skipped: number; errors: string[]; totalRows: number };

export default function SuppliersPage() {
  const { slug } = useParams<{ slug: string }>();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<typeof empty | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  // Bulk import
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function runImport(text: string) {
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const res = await apiFetch(slug, "/api/suppliers/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const data = await res.json();
      if (!res.ok) { setImportError(data.error || "Import failed"); return; }
      setImportResult(data);
      setCsvText("");
      await load();
    } finally {
      setImporting(false);
    }
  }

  function onFilePicked(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => runImport(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const csv = toCsv(
      ["Name", "Country", "Currency", "Lead time avg (days)", "Lead time std (days)", "MOQ", "Notes"],
      [
        ["Guangzhou Beauty Co", "China", "USD", 45, 12, 50, "Sea freight"],
        ["Dubai Cosmetics LLC", "UAE", "AED", 14, 4, 24, ""],
        ["Nairobi Distributors", "Kenya", "KES", 5, 2, 1, "Same-week delivery"],
      ]
    );
    saveTextFile("suppliers-template.csv", csv);
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? suppliers.filter((s) => s.name.toLowerCase().includes(q) || (s.country ?? "").toLowerCase().includes(q))
    : suppliers;

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 py-7">
        <div className="flex items-end justify-between mb-7 gap-3 flex-wrap">
          <div>
            <div className="page-eyebrow">Replenishment</div>
            <h1 className="page-title">Suppliers</h1>
            <p className="page-sub">Lead times here drive safety stock and order timing for every product assigned to the supplier.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setImportOpen(v => !v); setEditing(null); }} className="btn-ghost">
              Import CSV
            </button>
            <button onClick={() => { setEditing({ ...empty }); setImportOpen(false); }} className="btn-accent">
              Add supplier
            </button>
          </div>
        </div>

        {/* Bulk import */}
        {importOpen && (
          <div className="card p-6 mb-6">
            <h2 className="text-base font-semibold tracking-tight">Import suppliers from CSV</h2>
            <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">
              Works with a QuickBooks vendor export or our{" "}
              <button onClick={downloadTemplate} className="text-accent-700 hover:underline font-medium">template</button>.
              Only a name column is required; matching names are updated, new ones created.
            </p>

            <div className="mt-4 grid sm:grid-cols-[auto_1fr] gap-4 items-start">
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => onFilePicked(e.target.files?.[0])}
                />
                <button onClick={() => fileRef.current?.click()} disabled={importing} className="btn-primary disabled:opacity-50">
                  {importing ? "Importing…" : "Choose CSV file"}
                </button>
                <div className="text-2xs text-mute mt-2">or paste below</div>
              </div>
              <div>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={"Name,Country,Currency,Lead time avg (days)\nGuangzhou Beauty Co,China,USD,45"}
                  rows={4}
                  className="input font-mono text-2xs resize-y min-h-[88px]"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => runImport(csvText)}
                    disabled={importing || !csvText.trim()}
                    className="btn-accent disabled:bg-mute disabled:hover:bg-mute"
                  >
                    {importing ? "Importing…" : "Import pasted rows"}
                  </button>
                </div>
              </div>
            </div>

            {importError && (
              <div className="mt-4 p-3 rounded-xl text-sm border border-status-bad/30 bg-status-bad/5 text-status-bad">{importError}</div>
            )}
            {importResult && (
              <div className="mt-4 p-3 rounded-xl text-sm border border-status-ok/30 bg-status-ok/5 text-status-ok">
                Imported {importResult.totalRows} rows: <b>{importResult.created} new</b>, {importResult.updated} updated
                {importResult.skipped > 0 ? `, ${importResult.skipped} skipped (no name)` : ""}.
                {importResult.errors.length > 0 && (
                  <span className="block mt-1 text-status-warn">{importResult.errors.join(" · ")}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Add / edit */}
        {editing && (
          <div className="card p-6 mb-6">
            <h2 className="text-base font-semibold tracking-tight">{editing.id ? "Edit supplier" : "New supplier"}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
              <Field label="Name" value={editing.name} onChange={v => setEditing({ ...editing, name: v })} />
              <Field label="Country" value={editing.country || ""} onChange={v => setEditing({ ...editing, country: v })} placeholder="China, UAE, Kenya…" />
              <Field label="Currency" value={editing.currency} onChange={v => setEditing({ ...editing, currency: v })} placeholder="KES, USD, AED…" />
              <Field label="MOQ" value={String(editing.moq)} onChange={v => setEditing({ ...editing, moq: parseInt(v) || 1 })} type="number" />
              <Field
                label="Lead time avg (days)"
                value={String(editing.leadTimeAvgDays)}
                onChange={v => setEditing({ ...editing, leadTimeAvgDays: parseInt(v) || 0 })}
                type="number"
                help="Guangzhou sea ≈ 45 · Dubai ≈ 14 · EU ≈ 28 · local ≈ 5"
              />
              <Field
                label="Lead time std (days)"
                value={String(editing.leadTimeStdDays)}
                onChange={v => setEditing({ ...editing, leadTimeStdDays: parseInt(v) || 0 })}
                type="number"
                help="How much arrival dates vary — feeds safety stock"
              />
              <div className="sm:col-span-2">
                <Field label="Notes" value={editing.notes || ""} onChange={v => setEditing({ ...editing, notes: v })} />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={save} disabled={saving || !editing.name} className="btn-accent disabled:bg-mute disabled:hover:bg-mute">
                {saving ? "Saving…" : editing.id ? "Save changes" : "Add supplier"}
              </button>
              <button onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search suppliers…"
            className="input max-w-xs"
          />
          <span className="text-2xs text-mute shrink-0">{visible.length} of {suppliers.length}</span>
        </div>

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
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-mute">
                      {q ? `No suppliers match “${query}”.` : (
                        <>No suppliers yet. <button onClick={() => setImportOpen(true)} className="text-accent-700 hover:underline font-medium">Import a CSV</button> or add one by hand.</>
                      )}
                    </td>
                  </tr>
                ) : visible.map(s => (
                  <tr key={s.id} className="hover:bg-canvas">
                    <td className="px-5 py-3 font-medium">{s.name}</td>
                    <td className="px-5 py-3 text-ink-soft">{s.country || "—"}</td>
                    <td className="px-5 py-3 text-ink-soft num">{s.currency}</td>
                    <td className="px-5 py-3 text-right num">{s.leadTimeAvgDays}d ± {s.leadTimeStdDays}d</td>
                    <td className="px-5 py-3 text-right num">{s.moq}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => { setEditing({ ...s }); setImportOpen(false); }} className="text-2xs uppercase tracking-wider text-accent-700 hover:text-accent-800">
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

function Field({ label, value, onChange, placeholder, type = "text", help }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; help?: string;
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
      {help && <span className="block text-2xs text-mute mt-1.5">{help}</span>}
    </label>
  );
}
