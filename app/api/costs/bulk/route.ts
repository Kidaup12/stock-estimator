import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { z } from "zod";

/**
 * Bulk cost-of-goods import — paste/upload a CSV (e.g. the QuickBooks → COGS n8n
 * export). Body: { csv: string }. First row = headers, matched tolerantly:
 *   cost (required) · sku · name
 * Each row is matched to a product by SKU when present, else by normalized name
 * (QB SKUs are frequently blank). Writes Product.costKes. OWNER only.
 */

const Body = z.object({ csv: z.string().min(1).max(2_000_000) });

const HEADER_ALIASES: Record<string, string[]> = {
  sku: ["sku", "product sku", "item sku", "code", "default code", "barcode"],
  name: ["name", "product", "product name", "title", "item", "item name", "display name"],
  cost: ["cost", "purchase cost", "cost price", "unit cost", "buy price", "cost kes", "costkes", "avg cost", "average cost"],
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

/** Same normalization both sides of the name match: lowercase, strip punctuation, collapse spaces. */
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

/** Parse a money string ("1,234.50", "KES 250") → number, or null when unusable. */
function parseCost(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  if (auth.membership.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let raw: unknown = {};
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const rows = parseCsv(parsed.data.csv);
  if (rows.length < 2) {
    return NextResponse.json({ error: "Need a header row plus at least one data row" }, { status: 400 });
  }
  const headers = mapHeaders(rows[0]);
  if (!headers.has("cost")) {
    return NextResponse.json(
      { error: `No cost column found. Got headers: ${rows[0].join(", ")}. Accepted: Cost / Purchase Cost / Cost Price.` },
      { status: 400 }
    );
  }
  if (!headers.has("sku") && !headers.has("name")) {
    return NextResponse.json(
      { error: `Need a SKU or Name column to match products. Got headers: ${rows[0].join(", ")}.` },
      { status: 400 }
    );
  }

  // Tenant products → match indexes. Names that aren't unique are dropped from the
  // name index (ambiguous → we won't guess); SKU stays authoritative.
  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, sku: true, title: true },
  });
  const bySku = new Map<string, string>();
  for (const p of products) {
    const k = (p.sku ?? "").trim().toLowerCase();
    if (k) bySku.set(k, p.id);
  }
  const nameCounts = new Map<string, number>();
  const byName = new Map<string, string>();
  for (const p of products) {
    const k = normName(p.title ?? "");
    if (!k) continue;
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
    byName.set(k, p.id);
  }
  for (const [k, n] of nameCounts) if (n > 1) byName.delete(k); // ambiguous name → skip

  const get = (row: string[], f: keyof typeof HEADER_ALIASES) => {
    const idx = headers.get(f);
    return idx == null ? undefined : row[idx]?.trim();
  };

  let updated = 0, unmatched = 0, skipped = 0;
  const sampleUnmatched: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>(); // dedupe product writes within one file

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cost = parseCost(get(row, "cost"));
    const sku = get(row, "sku");
    const name = get(row, "name");
    if (cost == null) { skipped++; continue; }

    const id =
      (sku && bySku.get(sku.toLowerCase())) ||
      (name && byName.get(normName(name))) ||
      null;

    if (!id) {
      unmatched++;
      if (sampleUnmatched.length < 10) sampleUnmatched.push(sku || name || `row ${i + 1}`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);

    try {
      await prisma.product.update({ where: { id }, data: { costKes: cost } });
      updated++;
    } catch {
      errors.push(`Row ${i + 1} (${sku || name}): save failed`);
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    matched: updated,
    unmatched,
    skipped,
    totalRows: rows.length - 1,
    sampleUnmatched,
    errors: errors.slice(0, 20),
  });
}
