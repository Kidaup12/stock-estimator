/**
 * Core "mark as ordered" write — shared by the single-product route
 * (POST /api/products/[id]/order) and the bulk route (POST /api/orders/bulk).
 *
 * Records the intent to reorder so the dashboard stops recommending the product
 * while it's on the way. Suppression rides on this Order record, NOT on
 * Product.onOrder (the nightly Shopify reconcile authoritatively resets onOrder).
 * Idempotent: one active marker per product; re-ordering refreshes qty + ETA.
 */
import { prisma } from "@/lib/prisma";
import { leadDaysFor } from "@/lib/forecast/category";

export type MarkOrderedResult =
  | { ok: true; orderId: string; qty: number; expectedArrivalAt: Date }
  | { ok: false; reason: "product_not_found" | "no_forecast" };

export async function markOrdered(
  tenantId: string,
  productId: string,
  requestedQty?: number | null
): Promise<MarkOrderedResult> {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: {
      id: true,
      currentStock: true,
      leadTimeDays: true,
      importCategory: true,
      supplier: { select: { leadTimeAvgDays: true } },
    },
  });
  if (!product) return { ok: false, reason: "product_not_found" };

  const prediction = await prisma.prediction.findFirst({
    where: { tenantId, productId },
    orderBy: { runDate: "desc" },
    select: { id: true, recommendedQty: true },
  });
  if (!prediction) return { ok: false, reason: "no_forecast" };

  const qty = requestedQty ?? Math.max(1, Math.ceil(prediction.recommendedQty));
  // Precedence: per-product override → supplier → import-category default → 30.
  const leadDays = leadDaysFor(product, product.supplier);
  const now = new Date();
  const eta = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1000);

  const data = {
    status: "ordered",
    orderedQty: qty,
    orderedAt: now,
    expectedArrivalAt: eta,
    stockAtOrder: product.currentStock,
    sawEnroute: false,
    predictionId: prediction.id,
  };

  const existing = await prisma.order.findFirst({
    where: { tenantId, productId, status: "ordered", receivedAt: null },
    select: { id: true },
  });

  const order = existing
    ? await prisma.order.update({ where: { id: existing.id }, data })
    : await prisma.order.create({ data: { ...data, tenantId, productId } });

  return { ok: true, orderId: order.id, qty, expectedArrivalAt: eta };
}
