/**
 * Idempotent sales writer for the nightly reconcile.
 *
 * The Plan 03-03 mapper `upsertOrderAsSales` INCREMENTS — correct for the
 * clean-slate cutover, wrong here (overlap windows would double-count). Instead we
 * bucket the window's orders by (product, day) and OVERWRITE (`set`) each day's
 * SalesHistory total. Because the reconcile window re-pulls whole days, the
 * overwrite is exact and re-running is a no-op.
 */
import { prisma } from "@/lib/prisma";
import type { ShopifyOrderNode } from "./ingest";

export type DayBucket = {
  productId: string;
  dateKey: string; // YYYY-MM-DD (UTC)
  quantity: number;
  revenueKes: number;
};

/** Pure: aggregate order line items into (product, day) buckets. */
export function bucketSalesByProductDay(
  orders: ShopifyOrderNode[],
  productIdByGid: Map<string, string>
): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>();
  for (const order of orders) {
    if (!order.createdAt) continue;
    const dateKey = order.createdAt.slice(0, 10); // YYYY-MM-DD
    for (const line of order.lineItems ?? []) {
      const gid = line.product?.id;
      if (!gid) continue;
      const productId = productIdByGid.get(gid);
      if (!productId) continue;
      const qty = line.quantity ?? 0;
      if (qty <= 0) continue;
      const unit = line.originalUnitPriceSet?.shopMoney?.amount
        ? Number.parseFloat(line.originalUnitPriceSet.shopMoney.amount)
        : 0;
      const revenue = Number.isFinite(unit) ? unit * qty : 0;

      const key = `${productId}|${dateKey}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.quantity += qty;
        existing.revenueKes += revenue;
      } else {
        buckets.set(key, { productId, dateKey, quantity: qty, revenueKes: revenue });
      }
    }
  }
  return buckets;
}

/** Overwrite SalesHistory for each bucketed (product, day). Idempotent.
 *  Batched: delete exactly the touched (product, day) pairs, then createMany —
 *  2-3 queries instead of one upsert round-trip per pair (the per-row version
 *  contributed to the cron's 300s Vercel timeout). SET semantics unchanged. */
export async function applySalesForWindow(
  tenantId: string,
  orders: ShopifyOrderNode[],
  productIdByGid: Map<string, string>
): Promise<number> {
  const buckets = [...bucketSalesByProductDay(orders, productIdByGid).values()];
  if (buckets.length === 0) return 0;

  const rows = buckets.map((b) => ({
    tenantId,
    productId: b.productId,
    date: new Date(`${b.dateKey}T00:00:00.000Z`),
    quantity: b.quantity,
    revenueKes: b.revenueKes,
    channel: "shopify" as const,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await prisma.salesHistory.deleteMany({
      where: {
        tenantId,
        channel: "shopify",
        OR: chunk.map((r) => ({ productId: r.productId, date: r.date })),
      },
    });
    await prisma.salesHistory.createMany({ data: chunk });
  }
  return rows.length;
}
