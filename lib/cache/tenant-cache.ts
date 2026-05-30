import { unstable_cache } from "next/cache";

/**
 * The ONLY sanctioned cache helper (TNT-07 / D-18). Every cache key AND tag is
 * automatically prefixed with the tenantId so no cache entry — and no
 * revalidateTag — can ever cross tenants. Do NOT call `unstable_cache` directly
 * elsewhere; route cacheable tenant reads through here.
 */

/** Tenant-prefixed cache key parts. `("t1","forecast",30) -> ["t1","forecast","30"]`. */
export function tenantScopedCacheKey(
  tenantId: string,
  ...parts: (string | number)[]
): string[] {
  return [tenantId, ...parts.map(String)];
}

/**
 * Wrap a data loader in Next's unstable_cache with tenant-scoped key + tags.
 * Tags become `${tag}:${tenantId}` so a revalidateTag never leaks across tenants.
 */
export function tenantCache<T>(
  tenantId: string,
  keyParts: (string | number)[],
  fn: () => Promise<T>,
  opts?: { tags?: string[]; revalidate?: number }
): Promise<T> {
  const key = tenantScopedCacheKey(tenantId, ...keyParts);
  const tags = (opts?.tags ?? []).map((t) => `${t}:${tenantId}`);
  const cached = unstable_cache(fn, key, {
    tags,
    revalidate: opts?.revalidate,
  });
  return cached();
}
