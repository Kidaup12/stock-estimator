/**
 * Reorder math — single source of truth.
 *
 * Reorder quantity = ceil(finalForecast30d + safetyStock - currentStock - onOrder),
 * floored at 0. Subtracting `onOrder` prevents the system from re-recommending
 * SKUs that already have an approved-but-not-yet-received PO in transit
 * (FND-04 from REQUIREMENTS.md / D-10 / D-13).
 */

export type ReorderInput = {
  finalForecast30d: number;
  safetyStock: number;
  currentStock: number;
  onOrder: number;
};

export function recommendedQty(input: ReorderInput): number {
  const { finalForecast30d, safetyStock, currentStock, onOrder } = input;
  return Math.max(0, Math.ceil(finalForecast30d + safetyStock - currentStock - onOrder));
}
