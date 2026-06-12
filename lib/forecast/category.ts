/**
 * Import-category policy — single source of truth for how a product's
 * Local / Korean / Western classification drives ordering math.
 *
 * Mary's policy (Beauty Square WhatsApp, 2026-06-09):
 *   - Local items: order enough to cover ~2 weeks 3 days; restock is quick.
 *   - Korean + Western imports: ETA is 28 days or longer, so each order
 *     should cover at least 3 weeks.
 *
 * `importCategory` is nullable on Product — null means unclassified and is
 * treated as LOCAL everywhere (the safe default: shorter cover, shorter lead).
 *
 * Pure module: no Prisma, no I/O.
 */

export type ImportCategory = "LOCAL" | "KOREAN" | "WESTERN";

/** Default lead time (days until stock lands) when neither the product nor its
 *  supplier specifies one. Imports: Mary's stated ETA of 28 days. */
export const DEFAULT_LEAD_DAYS: Record<ImportCategory, number> = {
  LOCAL: 7,
  KOREAN: 28,
  WESTERN: 28,
};

/** Default lead-time variability (± days) per category, replacing the supplier's
 *  leadTimeStdDays now that suppliers are gone. Local restock is predictable
 *  (±1d); imports swing with shipping/customs (±7d). Feeds King's safety stock. */
export const DEFAULT_LEAD_STD_DAYS: Record<ImportCategory, number> = {
  LOCAL: 1,
  KOREAN: 7,
  WESTERN: 7,
};
const FALLBACK_LEAD_STD_DAYS = 7; // pre-category behavior, kept as the final net

/** How many days of demand one order should cover. Local = 17 (2wk3d). */
export const COVER_DAYS: Record<ImportCategory, number> = {
  LOCAL: 17,
  KOREAN: 21,
  WESTERN: 21,
};

const FALLBACK_LEAD_DAYS = 30; // pre-category behavior, kept as the final net
const FALLBACK_COVER_DAYS = 30; // pre-category behavior (flat 30d forecast cover)

export function normalizeCategory(raw: string | null | undefined): ImportCategory | null {
  const up = (raw ?? "").toUpperCase();
  return up === "LOCAL" || up === "KOREAN" || up === "WESTERN" ? (up as ImportCategory) : null;
}

/**
 * Lead-time precedence: per-product override → supplier average → category
 * default → 30. (First two rungs unchanged from the pre-category behavior.)
 */
export function leadDaysFor(
  product: { leadTimeDays?: number | null; importCategory?: string | null },
  supplier?: { leadTimeAvgDays?: number | null } | null
): number {
  if (product.leadTimeDays != null) return product.leadTimeDays;
  if (supplier?.leadTimeAvgDays != null) return supplier.leadTimeAvgDays;
  const cat = normalizeCategory(product.importCategory);
  return cat ? DEFAULT_LEAD_DAYS[cat] : FALLBACK_LEAD_DAYS;
}

/**
 * Lead-time STD: supplier std (inert post-removal — supplier is always null) →
 * category default → 7. A per-product lead OVERRIDE only fixes the average lead,
 * not its variability, so std stays category-driven — matching the prior behavior
 * where std came from `supplier?.leadTimeStdDays ?? 7` regardless of any override.
 */
export function leadStdFor(
  product: { importCategory?: string | null },
  supplier?: { leadTimeStdDays?: number | null } | null
): number {
  if (supplier?.leadTimeStdDays != null) return supplier.leadTimeStdDays;
  const cat = normalizeCategory(product.importCategory);
  return cat ? DEFAULT_LEAD_STD_DAYS[cat] : FALLBACK_LEAD_STD_DAYS;
}

/** Order-cover window for the product's category. Unclassified → LOCAL's 17d
 *  is NOT assumed — unclassified keeps the legacy flat 30d so behavior only
 *  changes once a product is actually classified. */
export function coverDaysFor(product: { importCategory?: string | null }): number {
  const cat = normalizeCategory(product.importCategory);
  return cat ? COVER_DAYS[cat] : FALLBACK_COVER_DAYS;
}
