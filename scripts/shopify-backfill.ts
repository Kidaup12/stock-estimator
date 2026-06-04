/**
 * Execution harness for Plan 03-03's guarded backfill + synthetic->real cutover.
 *
 * Imports the SAME lib/shopify functions the production route
 * (app/api/shopify/backfill/route.ts) uses — this CLI is the driver for the
 * one-time guarded cutover (it lets us surface the dry-run counts at the human
 * checkpoint and run with the dev server stopped, per the Supabase pooler cap).
 *
 *   npx tsx scripts/shopify-backfill.ts            # DRY RUN — counts only, no writes
 *   npx tsx scripts/shopify-backfill.ts --confirm  # destructive cutover + re-forecast
 *
 * Resilience (Roy's flaky Kenya↔EU link): DB reads run BEFORE the ~3-min bulk
 * fetch, the fetched JSONL is CACHED to .planning/_bulk-cache.json, and a cached
 * run is reused (pass --refresh to force a re-fetch). So a network blip never
 * wastes the expensive bulk fetch — just re-run.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { parseBulkJsonl } from "../lib/shopify/jsonl";
import {
  runBulkQuery,
  ordersBulkQuery,
  productsBulkQuery,
  inventoryBulkQuery,
} from "../lib/shopify/bulk";
import { cutoverToReal, type RealIngest } from "../lib/shopify/cutover";
import type {
  ShopifyProductNode,
  ShopifyLocationNode,
  ShopifyOrderNode,
} from "../lib/shopify/ingest";
import fs from "node:fs";

const SLUG = "beauty-square";
const CONFIRM = process.argv.includes("--confirm");
const REFRESH = process.argv.includes("--refresh");
const OUT = ".planning/_backfill.json";
const CACHE = ".planning/_bulk-cache.json";

function log(obj: unknown) {
  fs.writeFileSync(OUT, JSON.stringify(obj, null, 2));
}

/** Retry a DB op a few times — survives a transient pooler/network blip. */
async function db<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`DB op '${label}' failed after retries: ${(lastErr as Error)?.message}`);
}

async function main() {
  // 1) DB reads FIRST (cheap; if the link is down we fail fast, no wasted bulk).
  const tenant = await db("tenant", () =>
    prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } })
  );
  if (!tenant) throw new Error(`Tenant '${SLUG}' not found`);
  const tenantId = tenant.id;

  const connection = await db("connection", () =>
    prisma.shopifyConnection.findUnique({ where: { tenantId } })
  );
  if (!connection || connection.uninstalledAt) throw new Error("Shopify not connected for tenant");
  const shopDomain = connection.shopDomain;

  const [synProducts, synSales, synPredictions, synOrders] = await db("synthetic-counts", () =>
    Promise.all([
      prisma.product.count({ where: { tenantId } }),
      prisma.salesHistory.count({ where: { tenantId } }),
      prisma.prediction.count({ where: { tenantId } }),
      prisma.order.count({ where: { tenantId } }),
    ])
  );
  const synthetic = {
    products: synProducts,
    salesHistory: synSales,
    predictions: synPredictions,
    orders: synOrders,
  };

  // 2) Bulk fetch — cached so a failure after this never re-pays the ~3 min.
  let realData: RealIngest;
  if (!REFRESH && fs.existsSync(CACHE)) {
    realData = JSON.parse(fs.readFileSync(CACHE, "utf8")) as RealIngest;
  } else {
    // SERIALIZED bulk ops (one per shop): inventory -> products -> orders.
    const inventoryJsonl = await runBulkQuery(shopDomain, inventoryBulkQuery());
    const locations = parseBulkJsonl(inventoryJsonl) as ShopifyLocationNode[];

    const productsJsonl = await runBulkQuery(shopDomain, productsBulkQuery());
    const products = parseBulkJsonl(productsJsonl) as ShopifyProductNode[];

    const ordersJsonl = await runBulkQuery(shopDomain, ordersBulkQuery(365));
    const orders = parseBulkJsonl(ordersJsonl) as ShopifyOrderNode[];

    realData = { products, locations, orders };
    fs.writeFileSync(CACHE, JSON.stringify(realData));
  }

  const real = {
    products: realData.products.length,
    orders: realData.orders.length,
    locations: realData.locations.length,
    lineItems: realData.orders.reduce((n, o) => n + (o.lineItems?.length ?? 0), 0),
    inventoryLevels: realData.locations.reduce((n, l) => n + (l.inventoryLevels?.length ?? 0), 0),
  };

  if (!CONFIRM) {
    // Multi-variant probe (OQ4): how many products have >1 variant?
    const multiVariant = realData.products.filter((p) => (p.variants?.length ?? 0) > 1).length;
    // Inventory linkage sanity: how many on_hand levels resolve to a product gid?
    const invWithProduct = realData.locations.reduce(
      (n, l) =>
        n + (l.inventoryLevels ?? []).filter((x) => x.item?.variant?.product?.id).length,
      0
    );
    log({
      mode: "DRY_RUN",
      synthetic,
      real,
      multiVariantProducts: multiVariant,
      inventoryLevelsWithProduct: invWithProduct,
      cached: !REFRESH && fs.existsSync(CACHE),
    });
    return;
  }

  const result = await cutoverToReal(tenantId, realData, { confirm: true });
  log({ mode: "CUTOVER", synthetic, real, result });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    log({ mode: CONFIRM ? "CUTOVER" : "DRY_RUN", error: (e as Error).message, stack: (e as Error).stack });
    process.exit(1);
  });
