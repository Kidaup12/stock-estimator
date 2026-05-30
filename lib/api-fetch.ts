/**
 * Tenant-aware fetch wrapper (Pattern 2). Attaches the `x-tenant-slug` header so
 * the middleware can resolve the active tenant for `/api/*` calls made from pages
 * under `/shop/[slug]/`. Use this instead of bare `fetch('/api/...')` in tenant
 * client pages.
 */
export function apiFetch(slug: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      "x-tenant-slug": slug,
      ...(init?.headers ?? {}),
    },
  });
}
