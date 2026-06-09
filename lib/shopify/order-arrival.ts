/**
 * Pure arrival-detection for reorder-tracking ("Mark as ordered") markers.
 *
 * An active "ordered" Order is considered RECEIVED once Shopify shows the goods
 * landed — either the en-route bucket was seen on a PRIOR reconcile and is now
 * cleared, or at least half the ordered quantity has hit the sellable shelf.
 * Kept pure (no Prisma / I/O) so the heuristic is unit-testable.
 */

export type OrderArrivalInput = {
  /** Whether en-route stock for this product was observed on a PRIOR reconcile. */
  sawEnroute: boolean;
  /** Current en-route (Incoming/QB) qty for the product. */
  newEnroute: number;
  /** Current sellable on-hand for the product. */
  newStock: number;
  /** Sellable on-hand captured when the order was marked. */
  stockAtOrder: number;
  /** Quantity marked as ordered. */
  orderedQty: number;
};

export type OrderArrivalResult = {
  /** Updated flag — true once en-route has ever been observed. */
  sawEnroute: boolean;
  /** True when the order should be closed as received. */
  received: boolean;
};

export function evaluateOrderArrival(input: OrderArrivalInput): OrderArrivalResult {
  const { sawEnroute, newEnroute, newStock, stockAtOrder, orderedQty } = input;
  const sawEnrouteNext = sawEnroute || newEnroute > 0;
  const landedThreshold = stockAtOrder + Math.ceil(orderedQty * 0.5);
  const received =
    (sawEnroute && newEnroute === 0) || // en-route observed on a prior run, now cleared → arrived
    newStock >= landedThreshold;        // at least half the order is on the shelf
  return { sawEnroute: sawEnrouteNext, received };
}
