import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { z } from "zod";

/**
 * Bulk supplier import — paste/upload a CSV (e.g. a QuickBooks vendor export).
 *
 * Body: { csv: string }. First row = headers, matched tolerantly:
 *   name (required) · country · currency · lead avg/lead_time_avg_days ·
 *   lead std/lead_time_std_days · moq · notes
 * Unknown columns are ignored, so a raw QB export works as long as it has a
 * name-ish column. Upserts by case-insensitive name (re-import = update).
 */

const Body = z.object({ csv: z.string().min(1).max(2_000_000) });

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "supplier", "supplier name", "vendor", "vendor name", "display name", "displayname", "company", "company name"],
  country: ["country", "origin", "location"],
  currency: ["currency", "curr", "currency ref", "currencyref"],
  leadTimeAvgDays: ["leadtimeavgdays", "lead time avg (days)", "lead time avg", "lead avg", "lead time", "leadtime", "lead_time_avg_days", "lead days"],
  leadTimeStdDays: ["leadtimestddays", "lead time std (days)", "lead time std", "lead std", "lead_time_std_days"],
  moq: ["moq", "minimum order", "min order qty", "minimum order quantity"],
  notes: ["notes", "note", "memo", "comments", "description"],
};

/** RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF. No deps. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function mapHeaders(headerRow: string[]): Map<keyof typeof HEADER_ALIASES, number> {
  const map = new Map<keyof typeof HEADER_ALIASES, number>();
  headerRow.forEach((h, idx) => {
    const norm = h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (!map.has(field as keyof typeof HEADER_ALIASES) && aliases.includes(norm)) {
        map.set(field as keyof typeof HEADER_ALIASES, idx);
      }
    }
  });
  return map;
}

const intOr = (raw: string | undefined, fallback: number): number => {
  const n = Number.parseInt((raw ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let raw: unknown = {};
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const rows = parseCsv(parsed.data.csv);
  if (rows.length < 2) {
    return NextResponse.json({ error: "Need a header row plus at least one supplier row" }, { status: 400 });
  }
  const headers = mapHeaders(rows[0]);
  if (!headers.has("name")) {
    return NextResponse.json(
      { error: `No supplier-name column found. Got headers: ${rows[0].join(", ")}. Accepted: Name / Supplier / Vendor / Display Name / Company.` },
      { status: 400 }
    );
  }

  const existing = await prisma.supplier.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const byLowerName = new Map(existing.map((s) => [s.name.trim().toLowerCase(), s.id]));

  let created = 0, updated = 0, skipped = 0;
  const errors: string[] = [];
  const get = (row: string[], f: keyof typeof HEADER_ALIASES) => {
    const idx = headers.get(f);
    return idx == null ? undefined : row[idx]?.trim();
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = get(row, "name");
    if (!name) { skipped++; continue; }
    if (name.length > 200) { errors.push(`Row ${i + 1}: name too long`); continue; }

    const data = {
      country: get(row, "country") || null,
      currency: (get(row, "currency") || "KES").toUpperCase().slice(0, 8),
      leadTimeAvgDays: intOr(get(row, "leadTimeAvgDays"), 30) || 30,
      leadTimeStdDays: intOr(get(row, "leadTimeStdDays"), 7),
      moq: intOr(get(row, "moq"), 1) || 1,
      notes: get(row, "notes") || null,
    };

    try {
      const id = byLowerName.get(name.toLowerCase());
      if (id) {
        await prisma.supplier.update({ where: { id }, data });
        updated++;
      } else {
        const s = await prisma.supplier.create({ data: { ...data, name, tenantId: tenant.id } });
        byLowerName.set(name.toLowerCase(), s.id); // dedupe repeats within the same file
        created++;
      }
    } catch {
      errors.push(`Row ${i + 1} (${name}): save failed`);
    }
  }

  return NextResponse.json({ ok: true, created, updated, skipped, errors: errors.slice(0, 20), totalRows: rows.length - 1 });
}
