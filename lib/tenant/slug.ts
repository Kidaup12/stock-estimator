/**
 * Tenant slug generation — the `/shop/[slug]/` URL key (D-07).
 *
 * slugify: turns a human shop name into a URL-safe segment. Lowercase,
 *   Unicode-normalized (NFKD strips diacritics to their ASCII base where
 *   possible), non-alphanumerics collapsed to single hyphens, no leading or
 *   trailing hyphen. Pure, dependency-free (research: a npm dep is overkill).
 *
 * Usage:
 *   slugify("Beauty Square KE!"); // "beauty-square-ke"
 *
 * Consumed by the onboarding flow (Plan 05) on tenant creation and by the
 * backfill script. Uniqueness is enforced by `Tenant.slug @unique`, not here —
 * callers handle collisions (e.g. suffixing) at insert time.
 */

/** Slugify a shop name into a URL segment: lowercase, alphanumerics joined by hyphens, no leading/trailing hyphen. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
