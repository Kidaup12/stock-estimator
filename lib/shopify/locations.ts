/**
 * Location classification for inventory sync.
 *
 * Beauty Square's Shopify has non-sellable locations that must NOT count as
 * on-hand stock:
 *  - "(Virtual)" placeholder locations.
 *  - "INCOMING (QB) ENROUTE ORDERS" — stock on a QuickBooks purchase order,
 *    ordered but not yet received (en-route). It's a "coming soon" bucket, not
 *    real shelf stock, and must be EXCLUDED from currentStock (counting it would
 *    inflate on-hand → under-ordering + wrong days-of-cover) and excluded from
 *    Shopify↔QuickBooks reconciliation.
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

/** True only for real, sellable shelf locations (excludes Virtual + en-route). */
export function isSellableLocation(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  if (/virtual|\(qb\)/.test(n)) return false;
  if (isEnrouteLocation(n)) return false;
  return true;
}
