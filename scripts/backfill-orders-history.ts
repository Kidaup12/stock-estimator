/**
 * One-off: now that the app has the `read_all_orders` scope, pull a wider window
 * of order history (default 180 days) via Bulk Operations and write it to
 * SalesHistory with the idempotent day-set writer. Then the next forecast run
 * uses the richer history. Non-destructive (overwrites only the covered days'
 * sales totals from the full order set — no double count, no product deletes).
 *
 *   npx tsx scripts/backfill-orders-history.ts            # 180 days
 *   npx tsx scripts/backfill-orders-history.ts --days 365
 * Run with the dev server stopped (Supabase pooler cap).
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { runBulkQuery, ordersBulkQuery } from "../lib/shopify/bulk";
import { parseBulkJsonl } from "../lib/shopify/jsonl";
import { applySalesForWindow } from "../lib/shopify/sales-window";
import type { ShopifyOrderNode } from "../lib/shopify/ingest";

async function main() {
  const daysArg = process.argv.indexOf("--days");
  const days = daysArg >= 0 ? Number.parseInt(process.argv[daysArg + 1], 10) || 180 : 180;

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant");
  const conn = await prisma.shopifyConnection.findUnique({ where: { tenantId: tenant.id } });
  if (!conn || conn.uninstalledAt) throw new Error("No live Shopify connection");
  const shopDomain = conn.shopDomain;

  // gid -> local product id, for the sales writer.
  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, shopifyProductId: true },
  });
  const idByGid = new Map(products.map((p) => [p.shopifyProductId!, p.id]));

  console.log(`Bulk-pulling ${days}d of orders from ${shopDomain}…`);
  const jsonl = await runBulkQuery(shopDomain, ordersBulkQuery(days));
  const orders = parseBulkJsonl(jsonl) as ShopifyOrderNode[];
  console.log(`Parsed ${orders.length} orders.`);

  const salesRows = await applySalesForWindow(tenant.id, orders, idByGid);

  const agg = await prisma.salesHistory.aggregate({
    where: { tenantId: tenant.id, channel: "shopify" },
    _min: { date: true },
    _max: { date: true },
    _count: true,
  });
  const min = agg._min.date, max = agg._max.date;
  const span = min && max ? Math.round((+max - +min) / 864e5) : 0;
  console.log(
    JSON.stringify({
      ordersParsed: orders.length,
      salesRowsWritten: salesRows,
      salesSpanDays: span,
      from: min?.toISOString().slice(0, 10),
      to: max?.toISOString().slice(0, 10),
      totalSalesRows: agg._count,
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e.message); process.exit(1); });
