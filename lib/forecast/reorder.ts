/**
 * Reorder math — single source of truth.
 *
 * Reorder quantity = ceil(demand-over-cover-window + safetyStock - currentStock - onOrder),
 * floored at 0. Subtracting `onOrder` prevents the system from re-recommending
 * SKUs that already have stock in transit (FND-04 / D-10 / D-13).
 *
 * `coverDays` scales the 30-day forecast to the category's order-cover window
 * (Mary's policy via lib/forecast/category.ts: LOCAL 17d, KOREAN/WESTERN 21d,
 * unclassified 30d = legacy behavior). Omitted → 30 (unchanged math).
 */

export type ReorderInput = {
  finalForecast30d: number;
  safetyStock: number;
  currentStock: number;
  onOrder: number;
  /** Days of demand this order should cover; defaults to 30 (legacy). */
  coverDays?: number;
};

export function recommendedQty(input: ReorderInput): number {
  const { finalForecast30d, safetyStock, currentStock, onOrder } = input;
  const coverDays = input.coverDays ?? 30;
  const demandOverCover = (finalForecast30d / 30) * coverDays;
  return Math.max(0, Math.ceil(demandOverCover + safetyStock - currentStock - onOrder));
}
