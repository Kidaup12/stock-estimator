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
import { isSellableLocation, isEnrouteLocation } from "./locations";
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

/**
 * Sum on_hand per product gid, SPLIT by location type:
 *  - `sellable`: real shelf locations → Product.currentStock.
 *  - `enroute`: the "INCOMING (QB) ENROUTE ORDERS" location → Product.onOrder.
 * Virtual / other non-sellable locations are ignored entirely (never counted as
 * stock — counting them inflates on-hand and breaks Shopify↔QuickBooks matching).
 */
function sumOnHandByType(locations: ShopifyLocationNode[]): {
  sellable: Map<string, number>;
  enroute: Map<string, number>;
} {
  const sellable = new Map<string, number>();
  const enroute = new Map<string, number>();
  for (const loc of locations) {
    const target = isSellableLocation(loc.name)
      ? sellable
      : isEnrouteLocation(loc.name)
        ? enroute
        : null; // virtual / unknown non-sellable → ignore
    if (!target) continue;
    for (const level of loc.inventoryLevels ?? []) {
      const gid = level.item?.variant?.product?.id;
      if (!gid) continue;
      const onHand = level.quantities?.find((q) => q.name === "on_hand")?.quantity ?? 0;
      target.set(gid, (target.get(gid) ?? 0) + onHand);
    }
  }
  return { sellable, enroute };
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
  const { sellable: onHandByGid, enroute: enrouteByGid } = sumOnHandByType(locations);

  // Upsert products with their summed on_hand as currentStock.
  const productIdByGid = new Map<string, string>();
  for (const p of products) {
    const localId = await upsertProductFromShopify(tenantId, p, onHandByGid.get(p.id) ?? 0);
    productIdByGid.set(p.id, localId);
  }
  // AUTHORITATIVE refresh for EVERY product. The location fetch is a FULL refresh,
  // so a product absent from the on_hand data has ZERO sellable stock — reset it,
  // don't leave a stale inflated currentStock. Same for en-route → onOrder. Without
  // this, sold-out SKUs keep old values and currentStock drifts way above reality.
  const known = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, shopifyProductId: true },
  });
  for (const k of known) {
    if (!productIdByGid.has(k.shopifyProductId)) productIdByGid.set(k.shopifyProductId, k.id);
    await prisma.product.update({
      where: { id: k.id },
      data: {
        currentStock: onHandByGid.get(k.shopifyProductId) ?? 0,
        onOrder: Math.round(enrouteByGid.get(k.shopifyProductId) ?? 0),
      },
    });
  }
  await setCursor(tenantId, "products", runStart);

  // Locations + inventory levels (primary = first ACTIVE SELLABLE location —
  // never the en-route/virtual buckets).
  let inventoryLevels = 0;
  const primaryGid =
    locations.find((l) => l.isActive && isSellableLocation(l.name))?.id ??
    locations.find((l) => isSellableLocation(l.name))?.id ??
    null;
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
