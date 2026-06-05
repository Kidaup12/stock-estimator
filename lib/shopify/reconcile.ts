/**
 * Nightly incremental reconcile for one tenant. Non-destructive (no cutover): it
 * refreshes products + on_hand inventory + recent sales from Shopify via paginated
 * GraphQL, advancing per-resource cursors so a crash re-pulls only the unfinished
 * resource next run. Then snapshots inventory + re-forecasts.
 */
import { prisma } from "@/lib/prisma";
import {
  fetchProductsSince,
  fetchOrdersSince,
  fetchLocationsWithInventory,
} from "./paginate";
import {
  upsertProductFromShopify,
  upsertLocationFromShopify,
  upsertInventoryLevel,
  type ShopifyProductNode,
  type ShopifyLocationNode,
  type ShopifyOrderNode,
} from "./ingest";
import { applySalesForWindow } from "./sales-window";
import { computeWindowStart } from "./reconcile-window";
import { runForecastsForTenant } from "@/lib/forecast/run-batch";

const OVERLAP_HOURS = 6;
const FIRST_RUN_LOOKBACK_HOURS = 48;

export type ReconcileResult = {
  windowStart: string;
  products: number;
  locations: number;
  inventoryLevels: number;
  salesRows: number;
  orders: number;
  forecastsCreated: number;
};

async function getCursor(tenantId: string, resource: string): Promise<Date | null> {
  const row = await prisma.ingestCursor.findFirst({
    where: { tenantId, source: "shopify", resource },
    select: { cursor: true },
  });
  return row?.cursor ?? null;
}

async function setCursor(tenantId: string, resource: string, value: Date): Promise<void> {
  await prisma.ingestCursor.upsert({
    where: { tenantId_source_resource: { tenantId, source: "shopify", resource } },
    create: { tenantId, source: "shopify", resource, cursor: value },
    update: { cursor: value },
  });
}

/** Sum on_hand across all locations, keyed by Shopify product gid. */
function sumOnHandByProductGid(locations: ShopifyLocationNode[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const loc of locations) {
    for (const level of loc.inventoryLevels ?? []) {
      const gid = level.item?.variant?.product?.id;
      if (!gid) continue;
      const onHand = level.quantities?.find((q) => q.name === "on_hand")?.quantity ?? 0;
      out.set(gid, (out.get(gid) ?? 0) + onHand);
    }
  }
  return out;
}

export async function reconcileTenant(
  tenantId: string,
  /** Tenant IANA timezone — defaults to the schema default. Pass from the caller. */
  timezone = "Africa/Nairobi"
): Promise<ReconcileResult> {
  const connection = await prisma.shopifyConnection.findUnique({ where: { tenantId } });
  if (!connection || connection.uninstalledAt) {
    throw new Error(`Tenant ${tenantId} has no live Shopify connection`);
  }
  const shopDomain = connection.shopDomain;
  const runStart = new Date();

  // ── Products (changed since cursor) ─────────────────────────────────────────
  const productsCursor = await getCursor(tenantId, "products");
  const productsSince = computeWindowStart(productsCursor, runStart, {
    overlapHours: OVERLAP_HOURS,
    firstRunLookbackHours: FIRST_RUN_LOOKBACK_HOURS,
  });
  const products = (await fetchProductsSince(shopDomain, productsSince.toISOString())) as ShopifyProductNode[];

  // ── Inventory (full refresh) ────────────────────────────────────────────────
  const locations = (await fetchLocationsWithInventory(shopDomain)) as ShopifyLocationNode[];
  const onHandByGid = sumOnHandByProductGid(locations);

  // Upsert products with their summed on_hand as currentStock.
  const productIdByGid = new Map<string, string>();
  for (const p of products) {
    const localId = await upsertProductFromShopify(tenantId, p, onHandByGid.get(p.id) ?? 0);
    productIdByGid.set(p.id, localId);
  }
  // For products NOT in this delta, still refresh currentStock from on_hand.
  if (onHandByGid.size > 0) {
    const known = await prisma.product.findMany({
      where: { tenantId },
      select: { id: true, shopifyProductId: true },
    });
    for (const k of known) {
      if (!productIdByGid.has(k.shopifyProductId) && onHandByGid.has(k.shopifyProductId)) {
        await prisma.product.update({
          where: { id: k.id },
          data: { currentStock: onHandByGid.get(k.shopifyProductId)! },
        });
        productIdByGid.set(k.shopifyProductId, k.id);
      } else if (!productIdByGid.has(k.shopifyProductId)) {
        productIdByGid.set(k.shopifyProductId, k.id);
      }
    }
  }
  await setCursor(tenantId, "products", runStart);

  // Locations + inventory levels (primary = first active).
  let inventoryLevels = 0;
  const primaryGid = locations.find((l) => l.isActive)?.id ?? locations[0]?.id ?? null;
  for (const loc of locations) {
    const locationId = await upsertLocationFromShopify(tenantId, loc, { isPrimary: loc.id === primaryGid });
    for (const level of loc.inventoryLevels ?? []) {
      const gid = level.item?.variant?.product?.id;
      if (!gid) continue;
      const productId = productIdByGid.get(gid);
      if (!productId) continue;
      const onHand = level.quantities?.find((q) => q.name === "on_hand")?.quantity ?? 0;
      await upsertInventoryLevel(tenantId, locationId, productId, onHand);
      inventoryLevels++;
    }
  }

  // ── Orders (changed since cursor) -> idempotent day-set sales ────────────────
  const ordersCursor = await getCursor(tenantId, "orders");
  const ordersSince = computeWindowStart(ordersCursor, runStart, {
    overlapHours: OVERLAP_HOURS,
    firstRunLookbackHours: FIRST_RUN_LOOKBACK_HOURS,
  });
  const orders = (await fetchOrdersSince(shopDomain, ordersSince.toISOString())) as ShopifyOrderNode[];
  const salesRows = await applySalesForWindow(tenantId, orders, productIdByGid);
  await setCursor(tenantId, "orders", runStart);

  // ── Snapshot + re-forecast ──────────────────────────────────────────────────
  const { created: forecastsCreated } = await runForecastsForTenant(tenantId, timezone);

  return {
    windowStart: productsSince.toISOString(),
    products: products.length,
    locations: locations.length,
    inventoryLevels,
    salesRows,
    orders: orders.length,
    forecastsCreated,
  };
}
