/**
 * Role-based money visibility (Dave DoD §7: a staff user "cannot see costs,
 * budgets, or settings"). Only OWNER sees cost / margin / budget figures.
 *
 * Enforced SERVER-SIDE: money routes pass their response through redactMoney()
 * so a MEMBER's browser never receives the numbers in the first place (UI hiding
 * alone is not security). Revenue & retail values stay visible — staff can see
 * sales; they just can't see what the shop paid or its margins.
 *
 * Pure module: no Prisma, no I/O — unit-tested as the security regression net.
 */

export type Role = "OWNER" | "MEMBER";

export function canSeeMoney(role: Role | string | null | undefined): boolean {
  return role === "OWNER";
}

/**
 * Cost / margin / budget / COGS field names hidden from non-OWNER. Curated (not
 * a blanket "anything with Kes") so revenue/retail survive. Keep in sync with the
 * money routes' payload shapes.
 */
export const MONEY_KEYS: ReadonlySet<string> = new Set([
  // forecast summary + per-line (cost / margin / COGS — NOT revenue/retail)
  "costKes",
  "stockValueKes",
  "reorderCostKes",
  "cogs",
  "cogs30",
  "grossProfit30",
  "grossMarginPct",
  "deadStockKes",
  "activeStockKes",
  // reports (at-cost; *Retail / revenue stay visible)
  "stockCost",
  "stockValue",
  "totalStockCost",
  // budget / demand-shock (these routes also hard-403 for MEMBER, belt + braces)
  "selectedCostKes",
  "selectedMarginKes",
  "deferredCostKes",
  "deferredMarginKes",
  "margin",
  "roi",
  "extraCost",
  "baselineReorderCost",
  "deltaCost",
  "deltaMargin",
  "reorderMargin",
]);

/**
 * Returns `value` unchanged for OWNER; for anyone else, a deep copy with every
 * MONEY_KEYS field set to null (keys are kept so the UI never hits `undefined`).
 */
export function redactMoney<T>(value: T, role: Role | string | null | undefined): T {
  if (canSeeMoney(role)) return value;
  return walk(value) as T;
}

function walk(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = MONEY_KEYS.has(k) ? null : walk(val);
    }
    return out;
  }
  return v;
}
