/**
 * Promo-spike exclusion for the run rate (Dave DoD §6: "one Black Friday must not
 * inflate every future recommendation"). A past promo lifts sales for its window;
 * leaving those days in the baseline run rate permanently over-orders. So we drop
 * history days that fall inside a matching promo window before averaging.
 *
 * Pure module: no Prisma, no I/O. Gated by EXCLUDE_PROMO_SPIKES at the call site
 * (lib/forecast/run-batch.ts) so the change can be backtested before going live.
 */

export type PromoWindow = { start: Date; end: Date; scope: string; scopeValue: string | null };
export type ProductMatch = { sku: string; productType: string | null; vendor: string | null };

/** Same scope-matching as activePromoLift() in simulate-layers.ts. */
export function promoMatchesProduct(p: { scope: string; scopeValue: string | null }, prod: ProductMatch): boolean {
  return (
    p.scope === "all" ||
    (p.scope === "sku" && p.scopeValue === prod.sku) ||
    (p.scope === "category" && !!p.scopeValue && p.scopeValue.toUpperCase() === (prod.productType ?? "").toUpperCase()) ||
    (p.scope === "brand" && !!p.scopeValue && p.scopeValue.toUpperCase() === (prod.vendor ?? "").toUpperCase())
  );
}

/** The promo windows that apply to one product. */
export function windowsForProduct(promos: PromoWindow[], prod: ProductMatch): Array<{ start: Date; end: Date }> {
  return promos.filter((p) => promoMatchesProduct(p, prod)).map((p) => ({ start: p.start, end: p.end }));
}

/** Drop history points whose date falls inside any window (inclusive). */
export function excludePromoDays<T extends { date: Date }>(
  history: T[],
  windows: Array<{ start: Date; end: Date }>
): T[] {
  if (windows.length === 0) return history;
  return history.filter((h) => !windows.some((w) => h.date >= w.start && h.date <= w.end));
}
