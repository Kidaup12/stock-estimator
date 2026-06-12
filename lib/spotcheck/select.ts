/**
 * Weekly spot-check picker (G8): choose the N highest-value moving SKUs to
 * physically count, catching shelf-vs-system drift where it costs most. Skips
 * dead/empty SKUs (no run rate or no stock). Deterministic. Pure module.
 */
export type SpotCandidate = {
  id: string;
  runRate: number; // units/day
  currentStock: number;
  valueKes: number; // capital at risk on the shelf (stock × price or cost)
};

export function selectSpotChecks<T extends SpotCandidate>(products: T[], count = 5): T[] {
  return products
    .filter((p) => p.runRate > 0 && p.currentStock > 0)
    .sort((a, b) => b.valueKes - a.valueKes || b.runRate - a.runRate || a.id.localeCompare(b.id))
    .slice(0, count);
}
