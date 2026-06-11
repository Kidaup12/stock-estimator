/**
 * Inventory snapshot primitive (shared by forecast-run and the nightly reconcile).
 *
 * Writes one row per product for TODAY (UTC midnight key) holding the current
 * on-hand. Idempotent on (productId, date): re-running the same day overwrites,
 * never duplicates. The inventory-position view reads these as "opening stock"
 * at a window's start.
 */
import { prisma } from "@/lib/prisma";

/** Floor a Date to UTC midnight (the snapshot day key). */
export function utcDayKey(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Replace today's on-hand snapshot for every product of a tenant.
 *  Batched (delete-day + createMany): the old per-product upsert was ~2,000
 *  round-trips and helped blow Vercel's 300s cap on the cron. Idempotent on
 *  (productId, date) exactly as before — same-day re-runs overwrite. */
export async function snapshotInventory(tenantId: string): Promise<{ count: number }> {
  const day = utcDayKey(new Date());
  const products = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, currentStock: true },
  });
  await prisma.inventorySnapshot.deleteMany({ where: { tenantId, date: day } });
  await prisma.inventorySnapshot.createMany({
    data: products.map((p) => ({ tenantId, productId: p.id, date: day, onHand: p.currentStock })),
  });
  return { count: products.length };
}
