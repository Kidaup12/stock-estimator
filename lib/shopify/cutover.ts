/**
 * Guarded synthetic -> real cutover (D-13). THE single most destructive operation
 * in the phase, given a named home with a grep-verifiable acceptance instead of
 * being buried in checkpoint prose.
 *
 * Safety contract:
 *  - Refuses to delete anything unless `opts.confirm === true` (the dry-run count
 *    MUST have been surfaced to the owner first — see the backfill route's
 *    ?dryRun path and the human checkpoint).
 *  - The four synthetic deletes run CHILD-FIRST and tenant-scoped inside a single
 *    `prisma.$transaction` so the clear is atomic (never half-deleted).
 *  - It NEVER references Supplier / Promo / MonthlyContext — those are
 *    owner-entered and survive the cutover (RESEARCH Pattern 6 + D-13).
 *
 * Inserts run AFTER the delete transaction as idempotent upserts (via the Task-2
 * ingest mappers), deliberately NOT inside the transaction: 1100 products + 2134
 * orders of per-row upserts would hold a long transaction open against the
 * Supabase session pooler (the same connection-cap gotcha that bites prisma
 * migrate). If an insert is interrupted, re-running the cutover/backfill recovers
 * via the upserts.
 */

import { prisma } from "@/lib/prisma";
import {
  upsertProductFromShopify,
  upsertLocationFromShopify,
  upsertInventoryLevel,
  upsertOrderAsSales,
  type ShopifyProductNode,
  type ShopifyLocationNode,
  type ShopifyOrderNode,
} from "./ingest";

export type RealIngest = {
  products: ShopifyProductNode[];
  locations: ShopifyLocationNode[];
  orders: ShopifyOrderNode[];
};

export type CutoverResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      deleted: { orders: number; predictions: number; salesHistory: number; products: number };
      inserted: {
        products: number;
        locations: number;
        inventoryLevels: number;
        salesRows: number;
      };
      productCount: number;
    };

/** Sum of on_hand across all locations, keyed by Shopify product gid. */
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

export async function cutoverToReal(
  tenantId: string,
  realData: RealIngest,
  opts: { confirm: boolean }
): Promise<CutoverResult> {
  // GUARD: never delete without an explicit confirm (the surfaced-count gate).
  if (opts.confirm !== true) {
    return { ok: false, reason: "confirm flag required — dry-run count must be reviewed first" };
  }

  // 1) Atomic, child-first, tenant-scoped clear of synthetic data.
  //    Supplier / Promo / MonthlyContext are owner-entered — never touched.
  const [delOrders, delPredictions, delSales, delProducts] = await prisma.$transaction([
    prisma.order.deleteMany({ where: { tenantId } }),
    prisma.prediction.deleteMany({ where: { tenantId } }),
    prisma.salesHistory.deleteMany({ where: { tenantId } }),
    prisma.product.deleteMany({ where: { tenantId } }),
  ]);

  // 2) Insert real products (idempotent upserts), capturing gid -> local id.
  const onHandByGid = sumOnHandByProductGid(realData.locations);
  const productIdByGid = new Map<string, string>();
  for (const p of realData.products) {
    const localId = await upsertProductFromShopify(tenantId, p, onHandByGid.get(p.id) ?? 0);
    productIdByGid.set(p.id, localId);
  }

  // 3) Locations (first active = primary) + on_hand inventory levels.
  let locationsInserted = 0;
  let inventoryLevels = 0;
  const primaryGid =
    realData.locations.find((l) => l.isActive)?.id ?? realData.locations[0]?.id ?? null;
  for (const loc of realData.locations) {
    const locationId = await upsertLocationFromShopify(tenantId, loc, {
      isPrimary: loc.id === primaryGid,
    });
    locationsInserted++;
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

  // 4) Orders -> SalesHistory (accumulating per product/day on the clean slice).
  let salesRows = 0;
  for (const order of realData.orders) {
    salesRows += await upsertOrderAsSales(tenantId, order, productIdByGid);
  }

  const productCount = await prisma.product.count({ where: { tenantId } });

  return {
    ok: true,
    deleted: {
      orders: delOrders.count,
      predictions: delPredictions.count,
      salesHistory: delSales.count,
      products: delProducts.count,
    },
    inserted: {
      products: productIdByGid.size,
      locations: locationsInserted,
      inventoryLevels,
      salesRows,
    },
    productCount,
  };
}
