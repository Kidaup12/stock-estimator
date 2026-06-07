/**
 * One-off: import per-product LEAD TIME (DAYS) from the stock-take CSV into
 * Product.leadTimeDays, matched by NEW SKU -> Product.sku. Lead-time ONLY —
 * cost stays from Shopify unitCost, stock from the Shopify reconcile.
 *
 * Idempotent + tenant-scoped. Run with the dev server stopped (Supabase pooler).
 *   npx tsx scripts/import-lead-times.ts --file "C:\\path\\to\\stock-take.csv"
 * Default file: the May stock-take in Downloads.
 */
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../lib/prisma";

const DEFAULT_FILE =
  "C:\\Users\\ROY\\Downloads\\MAY STOCK TAKE INVENTORY REPORT - FINAL_STOCK_DATA_CLEANED - MAY 31ST 7PM.csv";

/** Split a CSV line, honoring double-quoted fields that contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function main() {
  const fileArg = process.argv.indexOf("--file");
  const file = fileArg >= 0 ? process.argv[fileArg + 1] : DEFAULT_FILE;
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant");

  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = splitCsvLine(lines[0]);
  const skuIdx = header.findIndex((h) => h.toUpperCase() === "NEW SKU");
  const ltIdx = header.findIndex((h) => h.toUpperCase().startsWith("LEAD TIME"));
  if (skuIdx < 0 || ltIdx < 0) throw new Error(`Missing columns. header=${JSON.stringify(header)}`);

  let parsed = 0, matched = 0;
  const unmatched: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const sku = (cols[skuIdx] ?? "").trim();
    const ltRaw = (cols[ltIdx] ?? "").replace(/[^0-9.]/g, "");
    if (!sku || !ltRaw) continue;
    const lead = Math.round(Number.parseFloat(ltRaw));
    if (!Number.isFinite(lead) || lead <= 0) continue;
    parsed++;
    const res = await prisma.product.updateMany({
      where: { tenantId: tenant.id, sku },
      data: { leadTimeDays: lead },
    });
    if (res.count > 0) matched++;
    else if (unmatched.length < 15) unmatched.push(sku);
  }

  console.log(JSON.stringify({ file, rowsWithLeadTime: parsed, matchedProducts: matched, sampleUnmatchedSkus: unmatched }));
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e.message); process.exit(1); });
