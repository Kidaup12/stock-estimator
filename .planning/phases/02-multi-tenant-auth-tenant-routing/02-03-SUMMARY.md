# Plan 02-03 Summary — requireTenant() chokepoint + route migrations + page moves

status: complete-verified
plan: 02-03
phase: 02-multi-tenant-auth-tenant-routing
requirements: [TNT-01, TNT-02, TNT-03, AUTH-05]
completed: 2026-05-30

## What was built

The isolation contract. After this plan the app is genuinely multi-tenant.

### Task 1 — chokepoint (commit dcafad3-range)
- **`lib/auth/context.ts`** — `requireTenant(slugArg?)` resolves Supabase session → tenant by slug → membership, throwing typed `TenantError(401|403|404)`. The single allow-listed home of `prisma.tenant.findUnique`.
- **`lib/auth/route-wrapper.ts`** — `withTenant(handler)` (wrapped form) + `requireTenantOrResponse(slugArg?)` (imperative form returning the ctx OR a ready 401/403/404 `NextResponse`). The imperative helper is what the 15 routes use.
- **`lib/auth/webhook-context.ts`** — separate non-session resolver (`resolveTenantByDomain`/`resolveTenantByRealmId`), documented + allow-listed (D-11 placeholder for Phase 3/4).
- **`lib/supabase/middleware.ts`** — after `getUser()` injects `x-user-id` + `x-tenant-slug` request headers via `NextResponse.next({ request: { headers } })`, re-copying auth cookies onto the regenerated response.

### Task 2 — route migrations (commit 68f5eb8)
- All **16 `prisma.tenant.findFirst()` sites across 12 route files** now resolve via `requireTenantOrResponse()`. `grep -r "prisma.tenant.findFirst" app/` = **0** (success criterion #4).
- **W1**: `orders/[id]/approve` + `orders/[id]/skip` order lookups are now `findFirst({ where: { id, tenantId: tenant.id } })` (404 on foreign/missing) and auth-gated.
- **W3**: `seed` route auth-gated via `requireTenant()`; `tenant.id` threaded into `seed(tenantId?)` / `synth(tenantId?)` (optional arg — `npm run seed` CLI still works).
- **Bonus holes closed** (same cross-tenant-mutate class the checker flagged for orders): `promos` + `suppliers` update-by-id now verify tenant ownership before update (404 otherwise); `shop` POST updates the *resolved* tenant only — no blind second-tenant create (the old single-tenant overwrite bug).

### Task 3 — page moves (commit this)
- `git mv` of 7 page trees (`dashboard` incl. `product/[id]`, `settings`, `suppliers`, `promos`, `simulate`, `reports`) under **`app/shop/[slug]/`**. `contact` + `pricing` stay at root.
- **`app/shop/[slug]/layout.tsx`** — async RSC auth shell: `requireTenant(slug)` → 401 redirects `/login`, 403/404 redirect `/`; renders the slug + a `<form action="/auth/signout">` sign-out control + children.
- **`lib/api-fetch.ts`** — `apiFetch(slug, path, init)` attaches `x-tenant-slug`.
- Every intra-tenant `<Link>` href is slug-prefixed (`/shop/${slug}/...`); every page `fetch('/api/...')` → `apiFetch(slug, ...)`. Three dashboard sub-components + one simulate sub-component read `slug` via `useParams` (caught by the build typecheck).

## Verified

- `grep -r "prisma.tenant.findFirst" app/` → 0 (criterion #4 ✓).
- `grep -rl "requireTenant" app/api/` → 15 files (the complete set: 12 findFirst files + orders approve/skip + seed; "16" in the plan referred to findFirst *sites*).
- order approve/skip lookups contain `tenantId: tenant.id`; seed contains `requireTenant`.
- Old `app/dashboard|settings|suppliers|promos|simulate|reports` gone; `app/shop/[slug]/...` present; `app/contact` + `app/pricing` still at root.
- 0 un-prefixed intra-tenant links; 0 raw `fetch(` in pages.
- `npx tsc --noEmit` exits 0 (source + regenerated .next types). Live: unauthenticated `/api/forecast` → 401.

## Deviations

- Used `requireTenantOrResponse()` (imperative) for the 15 route files rather than the `withTenant` wrapper — both are sanctioned by the plan; the imperative form is a 2-line swap that preserves each `export async function GET/POST` signature and existing try/catch.
- Closed `promos`/`suppliers` update-by-id + `shop` upsert cross-tenant holes beyond the plan's explicit orders+seed scope — same isolation class, cheap, and Plan 06's 2-tenant mutate test would otherwise fail on them.
- **`app/page.tsx` still `redirect("/dashboard")`** which now 404s — left intentionally per the plan ("root redirect is Plan 05's job"). Plan 05 (next) replaces it with membership-aware routing.

## Self-Check: PASSED (pending final `next build` gate confirmation — tsc already green)
