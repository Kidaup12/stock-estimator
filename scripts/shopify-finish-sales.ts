/**
 * Resume helper: insert ONLY the orders->SalesHistory rows for beauty-square,
 * using the cached bulk fetch + the real products already in the DB.
 *
 * Why this exists: the cutover inserts products/locations/inventory first, then
 * sales last. On Roy's flaky Kenya↔EU link the full cutover can exceed the script
 * timeout mid-sales. Products/locations/inventory are already in (idempotent
 * upserts); this finishes the sales step alone — no re-delete, no re-insert of the
 * 1100 products. Idempotent: safe to re-run (upsert on productId+date+channel,
 * but it resets each row's quantity first run via the cutover's clean slate).
 *
 * Resumable: it processes orders in chunks and records progress so a mid-run
 * timeout just continues from where it stopped.
 *
 *   npx tsx scripts/shopify-finish-sales.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { upsertOrderAsSales, type ShopifyOrderNode } from "../lib/shopify/ingest";
import fs from "node:fs";

const SLUG = "beauty-square";
const CACHE = ".planning/_bulk-cache.json";
const PROGRESS = ".planning/_sales-progress.txt";
const OUT = ".planning/_finish-sales.json";

async function db<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`DB '${label}' failed: ${(lastErr as Error)?.message}`);
}

async function main() {
  const tenant = await db("tenant", () =>
    prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } })
  );
  if (!tenant) throw new Error("tenant not found");
  const tenantId = tenant.id;

  // Build gid -> local product id from the products already ingested.
  const products = await db("products", () =>
    prisma.product.findMany({ where: { tenantId }, select: { id: true, shopifyProductId: true } })
  );
  const idByGid = new Map<string, string>();
  for (const p of products) idByGid.set(p.shopifyProductId!, p.id);

  const orders = JSON.parse(fs.readFileSync(CACHE, "utf8")).orders as ShopifyOrderNode[];

  // Resume from the last completed index, if any.
  let start = 0;
  if (fs.existsSync(PROGRESS)) start = parseInt(fs.readFileSync(PROGRESS, "utf8").trim() || "0", 10) || 0;

  let salesRows = 0;
  for (let i = start; i < orders.length; i++) {
    salesRows += await db(`order#${i}`, () => upsertOrderAsSales(tenantId, orders[i], idByGid));
    if (i % 100 === 0) fs.writeFileSync(PROGRESS, String(i));
  }
  fs.writeFileSync(PROGRESS, String(orders.length));

  const finalSales = await db("count", () => prisma.salesHistory.count({ where: { tenantId } }));
  fs.writeFileSync(
    OUT,
    JSON.stringify({ ok: true, ordersProcessed: orders.length - start, salesRowsWritten: salesRows, salesHistoryTotal: finalSales })
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    fs.writeFileSync(OUT, JSON.stringify({ ok: false, error: (e as Error).message }));
    process.exit(1);
  });
