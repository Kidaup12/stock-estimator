/**
 * Location classification for inventory sync.
 *
 * Per Dave/Mary (2026-06-11 review): EVERY Shopify location holds real shelf
 * stock — including the "(Virtual)" locations — EXCEPT the en-route bucket:
 *  - "INCOMING (QB) ENROUTE ORDERS" — stock on a QuickBooks purchase order,
 *    ordered but not yet received. It's a "coming soon" bucket, not shelf
 *    stock; counting it would inflate on-hand → under-ordering and wrong
 *    days-of-cover.
 *
 * En-route quantities instead feed each product's `onOrder` (the dashboard's
 * "En route" column + the reorder math, which subtracts on-order so it doesn't
 * double-order).
 */

/** True for the en-route / incoming (QB PO) holding location. */
export function isEnrouteLocation(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return /incoming|en[\s-]?route/.test(n);
}

/** True for real, sellable stock locations — everything except en-route.
 *  Virtual locations COUNT as real stock (confirmed by the shop owner). */
export function isSellableLocation(name: string | null | undefined): boolean {
  return !isEnrouteLocation(name);
}
