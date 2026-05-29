/**
 * ABC classification — single source of truth.
 *
 * Sorts products by revenue (desc) and assigns ABC tier by cumulative
 * revenue share: top 70% = A, next 20% = B, tail 10% = C.
 *
 * Extracted from app/api/forecast/run/route.ts and scripts/run-forecasts.ts
 * (both copies were byte-identical per RESEARCH §7 — D-12 / FND-05).
 */

export type AbcInput = { id: string; revenue: number };
export type AbcCategory = "A" | "B" | "C";

export function assignAbc(productsWithRevenue: AbcInput[]): Record<string, AbcCategory> {
  const sorted = [...productsWithRevenue].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((s, p) => s + p.revenue, 0);
  let cumulative = 0;
  const map: Record<string, AbcCategory> = {};
  for (const p of sorted) {
    cumulative += p.revenue;
    const pct = total > 0 ? cumulative / total : 1;
    if (pct <= 0.7) map[p.id] = "A";
    else if (pct <= 0.9) map[p.id] = "B";
    else map[p.id] = "C";
  }
  return map;
}
