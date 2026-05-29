# Phase 2: Multi-Tenant Auth & Tenant Routing — Context

**Gathered:** 2026-05-30
**Status:** Ready for planning
**Mode:** auto (recommended option chosen per gray area; rationale logged inline)

<domain>
## Phase Boundary

Turn the single-tenant demo into a **real multi-tenant SaaS**: two tenants coexist in the same Postgres database with **zero cross-contamination**, reachable only by an **authenticated** user, under **path-based `/shop/[slug]/` URLs**. The 12 `prisma.tenant.findFirst()` shortcuts are replaced by a single `requireTenant()` chokepoint, tenant isolation is enforced by lint + a 2-tenant test, caching is tenant-scoped, and every forecast/reorder date bucket respects the tenant's timezone.

**In scope — Requirements:** AUTH-01..05, TNT-01..08.

**Explicit non-scope** (belongs to later phases — do not build in Phase 2):
- Real Shopify / QuickBooks / Odoo OAuth + token storage + encryption (Phases 3-4). `TOKEN_ENCRYPTION_KEY` env var is already documented (Phase 1 D-14) but no tokens are stored yet.
- Member-invitation flow (adding `MEMBER`s to an existing tenant) — schema + role enum ship now; the invite UI is deferred.
- Subdomain routing (`acme.wezesha.app`) — v2 (path-based only for v1).
- Python sidecar, PO delivery, source-of-truth merge — Phases 4-5.
- UI redesign — pages move directories and gain an auth/tenant shell, but layout/visuals stay as-is.
</domain>

<decisions>
## Implementation Decisions

### Authentication (AUTH-01..05)

- **D-01: Auth provider = Supabase Auth via `@supabase/ssr`.** SOW mandate (overrides STACK.md's Better Auth suggestion). Same Supabase project as the Postgres DB (Phase 1 D-01) — one project, one dashboard, one billing line.
- **D-02: Sign-in methods = email magic link (primary) + Google OAuth (optional).** Verbatim SOW. Magic link first; Google OAuth wired but secondary (AUTH-01, AUTH-02).
- **D-03: Sessions = cookie-based via `@supabase/ssr` (httpOnly).** Not localStorage. This is the current Supabase standard for the Next.js App Router: httpOnly cookies survive a browser refresh (AUTH-03), are readable by server components and route handlers, and aren't exposed to XSS. A Next `middleware.ts` runs `supabase.auth.getUser()` to refresh the session cookie on every request.
- **D-04: Custom login page at `app/login/page.tsx`.** A minimal branded page that calls `supabase-js` (signInWithOtp for magic link, signInWithOAuth for Google) — NOT Supabase's hosted Auth UI. Keeps the brand consistent and server-first. Magic-link + OAuth callbacks land on a route handler `app/auth/callback/route.ts` that exchanges the code for a session cookie.
- **D-05: Logout available from every authenticated page.** A sign-out action in the app shell header (server action or POST to `app/auth/signout/route.ts`) that clears the Supabase session and redirects to `/login` (AUTH-04).
- **D-06: Every `app/api/*` route requires a valid session → 401 if absent (AUTH-05).** Enforced inside `requireTenant()` (D-10) so auth + tenant resolution are one call, plus a `middleware.ts` matcher covering `/api/:path*` and `/shop/:path*` as the outer gate. Webhook routes (Phase 3+, under `app/api/webhooks/*`) are the documented exception — they have no session and authenticate by HMAC + domain/realmId resolver (D-11).

### Tenant Routing (TNT-01)

- **D-07: New `Tenant.slug String @unique`, slugified from the shop name on creation.** Beauty Square's existing seeded tenant gets `slug = "beauty-square"` via a backfill (D-15). The slug is the URL segment.
- **D-08: Move tenant-scoped pages under `app/shop/[slug]/`.** Relocate `dashboard/`, `settings/`, `suppliers/`, `promos/`, `simulate/`, `reports/`, and `dashboard/product/[id]/` to `app/shop/[slug]/...`. **Marketing/static pages stay at root** (`contact/`, `pricing/`, the root `page.tsx`). Client `fetch()` calls update to tenant-aware API paths or pass the slug (see D-10).
- **D-09: Root + cross-tenant behavior.** Root `/` redirects: authenticated user with one membership → `/shop/[their-slug]/dashboard`; multiple memberships → a lightweight tenant picker; zero memberships → onboarding (D-14); unauthenticated → `/login`. A logged-in user hitting a `/shop/[slug]/` they are NOT a member of → **403** (membership check in middleware + `requireTenant()`).

### requireTenant() Chokepoint (TNT-02, TNT-03)

- **D-10: Single `requireTenant()` helper at `lib/auth/context.ts` is the ONLY sanctioned tenant resolver in app routes.** It (a) reads the Supabase session (401 if none), (b) resolves the active tenant by slug, (c) verifies the user has a `Membership` for that tenant (403 if not), (d) returns `{ tenant, membership, userId }`. All 12 `prisma.tenant.findFirst()` callsites are deleted and routed through it (`grep -r "prisma.tenant.findFirst" app/` must return zero — success criterion #4).
  - **Active-slug propagation:** page routes get the slug from `params`; API routes get it from a `middleware.ts`-injected `x-tenant-slug` header (derived from the authenticated request's `/shop/[slug]` context) OR an explicit client-sent header. The exact injection mechanism is **Claude's discretion** within this locked contract — the invariant is "no route resolves a tenant any other way."
- **D-11: Webhook routes use a SEPARATE resolver, not `requireTenant()` (TNT-03).** Webhooks (Phase 3+) have no session; the source domain (Shopify) or `realmId` (QuickBooks) IS the tenant key. A narrowly-scoped `resolveTenantByDomain()/resolveTenantByRealmId()` lives apart and is documented as the one legitimate `findUnique`-by-external-key survivor. Phase 2 only establishes the pattern/placeholder; the webhook handlers themselves ship in Phase 3.

### Membership & Roles (TNT-04)

- **D-12: `Membership { id, userId String, tenantId String, role Role, createdAt }` with `@@unique([userId, tenantId])` and `@@index([tenantId])`.** `Role` enum = `OWNER | MEMBER`. Cascade-delete from `Tenant`.
- **D-13: `userId` stores the Supabase `auth.users` UUID as a plain String — no Prisma FK into Supabase's `auth` schema.** Prisma doesn't manage the `auth` schema; binding by UUID string keeps Prisma migrations clean and avoids cross-schema coupling.
- **D-14: First-time signup → create tenant + OWNER membership.** A new authenticated user with no membership lands on a "Create your shop" onboarding page that creates a `Tenant` (with slugified `slug`) + a `Membership(role=OWNER)`, then redirects to `/shop/[slug]/dashboard`. This satisfies success criterion #1 (signup → own tenant dashboard). Inviting additional `MEMBER`s is **deferred**.
- **D-15: Backfill the existing Beauty Square tenant.** A one-shot script (`scripts/backfill-tenant-membership.ts`) assigns the seeded tenant `slug="beauty-square"` and creates an OWNER `Membership` for Roy's/Mary's Supabase account so the existing 1,023-product dataset is reachable under the new routing immediately. Keeps Phase 1's live demo working post-migration.

### Isolation Enforcement (TNT-05, TNT-06, TNT-07)

- **D-16: ESLint custom rule bans bare `prisma.*.findMany()/findFirst()` without a `tenantId` filter outside the resolver layer, enforced in CI (TNT-06, success criterion #4).** This is the locked required deliverable. A Prisma client extension as a second defense-in-depth layer is **Claude's discretion** (nice-to-have, not required).
- **D-17: Two-tenant integration test (TNT-05) built on the Phase 1 vitest harness.** Seeds tenant A + tenant B, then asserts a request scoped to A cannot read or mutate B's `Product`, `SalesHistory`, `Supplier`, `Promo`, `Prediction`, or `Order` rows. This is the honest acceptance test for isolation. Lives alongside the existing `lib/forecast/*.test.ts` colocated-test pattern (or `tests/` — Claude's discretion).
- **D-18: `lib/cache/tenant-cache.ts` is the only sanctioned cache helper (TNT-07).** A thin wrapper over Next's `unstable_cache` (or a dev Map fallback) whose `tenantScopedCacheKey()` and tags are automatically prefixed with `tenantId` so no cache entry can leak across tenants. Preventive — even if little is cached today, this establishes the pattern before Phase 3-5 add cacheable reads.

### Tenant Timezone (TNT-08)

- **D-19: `Tenant.timezone String @default("Africa/Nairobi")` (IANA tz).** All date bucketing in the forecast + reorder windows respects it. A small date helper converts "today" (the forecast `runDate` seed key) and the sales-day bucketing to the tenant's tz. Library = **Claude's discretion** (lean `Intl.DateTimeFormat` with tz, or `date-fns-tz`). Note: this interacts with Phase 1 D-06 (seed key = `(productId, runDate ISO date string)`) — `runDate` must now be computed in tenant tz so the determinism invariant holds per-tenant.

### Claude's Discretion

- Exact `middleware.ts` tenant-header injection mechanism for API routes (within the D-10 contract).
- Whether to add a Prisma client extension on top of the required ESLint rule (D-16).
- Test file location: colocated `*.test.ts` vs a `tests/` dir for the 2-tenant integration test (D-17).
- Timezone library: `Intl` vs `date-fns-tz` (D-19).
- Tenant-picker UI for multi-membership users (D-09) — simple list is fine; only Roy/dev will have >1 membership in v1.
- Pinned versions of `@supabase/supabase-js` + `@supabase/ssr` (run `npm view` at phase start — research Q1).
- Whether to spike token-encryption approach now (research Q5) or defer fully to Phase 3 — default: **defer** (no tokens stored in Phase 2).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level specs
- `.planning/PROJECT.md` — scope, constraints, SOW, "Tenant routing" + "Codebase map ground truth" sections (the 12 `findFirst` landmines, zero-auth state)
- `.planning/REQUIREMENTS.md` §Authentication (AUTH-01..05) + §Multi-Tenancy (TNT-01..08) — verbatim acceptance criteria
- `.planning/ROADMAP.md` → Phase 2 entry — goal + 5 success criteria (these are the verification targets)

### Research (frozen)
- `.planning/research/SUMMARY.md` §2 (Stack Additions — Supabase Auth row, Tenancy row), §"Architecture Decisions" table (path-based routing, `requireTenant()` chokepoint + lint rule, webhook resolver survivor, cache-key tenant scoping), §"Pitfalls" #2 (12× findFirst → cross-tenant leak) + #3 (cache keys missing tenantId)
- `.planning/research/ARCHITECTURE.md` — tenancy + auth architecture detail
- `.planning/research/PITFALLS.md` — cross-tenant leak + cache leak mitigations
- `.planning/research/STACK.md` — auth/tenancy stack (note: Better Auth proposal is OVERRIDDEN by SOW → Supabase)

### Codebase maps (frozen snapshot at `a2b8fe4`)
- `.planning/codebase/CONCERNS.md` — names every `prisma.tenant.findFirst()` callsite + the zero-auth state with file:line citations
- `.planning/codebase/STRUCTURE.md` — current `app/` + `app/api/` directory layout (what moves under `/shop/[slug]/`)
- `.planning/codebase/CONVENTIONS.md` — API route shape, Zod validation, Prisma singleton patterns to preserve
- `.planning/codebase/INTEGRATIONS.md` — current mock integration boundaries
- `.planning/codebase/ARCHITECTURE.md` — layer model (pages → API-as-service → lib → Prisma)

### Prior phase
- `.planning/phases/01-boot-determinism-cleanup/01-CONTEXT.md` — D-06 (seed key `(productId, runDate)` — interacts with D-19 tenant tz), D-14 (`.env.example` already lists `SUPABASE_*` / `NEXTAUTH_*` / `TOKEN_ENCRYPTION_KEY`), Phase 1 vitest harness that D-17's 2-tenant test builds on

### External docs (libraries — fetch current versions at plan/research time)
- Supabase `@supabase/ssr` Next.js App Router guide — server client, `middleware.ts` session refresh, cookie handling, `auth/callback` code exchange. (Authoritative source for D-01..D-06; use Context7 / official docs at phase start.)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/prisma.ts` — Prisma singleton; `requireTenant()` and the cache helper build on it.
- Phase 1 vitest harness (`lib/forecast/*.test.ts` + `npm test`) — D-17's 2-tenant isolation test reuses this setup.
- `app/api/shop/route.ts` (the `tenant.upsert` via `findFirst`) — the canonical example of the pattern being replaced; PROJECT.md warns it will silently overwrite Beauty Square's row the moment a 2nd tenant connects.
- `app/layout.tsx` — root server layout; the new `app/shop/[slug]/layout.tsx` auth/tenant shell slots beneath it.

### Established Patterns (preserve)
- API routes ARE the service layer: `export async function GET/POST(...)` → resolve tenant → Zod `safeParse` → Prisma → `NextResponse.json`. `requireTenant()` replaces the `prisma.tenant.findFirst()` line at the top of each.
- Next 16: `params` is a `Promise` — `await params` before reading `[slug]`/`[id]`.
- Client pages are `"use client"` and call `/api/*` via `fetch` — these fetch URLs update for tenant-aware routing (D-08/D-10).

### Integration Points
- `middleware.ts` (NEW, repo root) — session refresh + `/shop/:path*` + `/api/:path*` matcher; the outer auth/tenant gate.
- `lib/auth/context.ts` (NEW) — `requireTenant()` chokepoint.
- `lib/cache/tenant-cache.ts` (NEW) — tenant-scoped cache.
- `prisma/schema.prisma` — `Tenant.slug`, `Tenant.timezone`, new `Membership` model + `Role` enum; new migration stacked on Phase 1's.
- 12 `app/api/*/route.ts` handlers — swap `findFirst` → `requireTenant()`.

### Known Affected Callsites (from CONCERNS.md / success criterion #4)
- The 12 `prisma.tenant.findFirst()` sites across `app/api/` (forecast, forecast/run, monthly-context, orders/[id]/approve, orders/[id]/skip, products, products/[id], promos, reports, seed, shop, suppliers, simulate/*). Planner should grep to get the exact current list — Phase 1 may have shifted line numbers.

</code_context>

<specifics>
## Specific Ideas

- **Beauty Square keeps working through the migration** — D-15 backfill is non-negotiable UX: the existing localhost:3082 demo (1,023 products, KES 11.6M) must still render under `/shop/beauty-square/dashboard` after Phase 2, not require a re-seed.
- **The honest test is "seed a second tenant and prove isolation"** (research-emphasized). D-17 is the phase's real proof, not the lint rule.
- Roy's session preferences (carried from Phase 1): grade-9 explanations for technical concepts, CLI-first execution, ask before destructive ops (Prisma's AI-safety guard already gates migrations), Codex CLI as a second-opinion reviewer, dev server on port 3082.

</specifics>

<deferred>
## Deferred Ideas

- **Member-invitation flow** (inviting `MEMBER`s to an existing tenant, invite emails, accept flow) — schema + `Role` enum ship in Phase 2 (D-12), but the invite UI/flow is out of scope for the success criteria. Future phase or v1.x.
- **Subdomain-based tenant routing** (`acme.wezesha.app`) — v2 (V2-08). Path-based only for v1; 301 migration later is trivial.
- **Prisma client extension** for tenant-scoping enforcement — optional defense-in-depth beyond the required ESLint rule (D-16); pick up if cheap, else skip.
- **Token-encryption spike** (research Q5) — no tokens stored in Phase 2; fully addressed in Phase 3 when Shopify OAuth lands.
- **Supabase RLS as a second isolation layer** — available for free on Supabase Postgres (Phase 1 D-01 noted this), but the `requireTenant()` chokepoint is the contract; RLS is not leaned on in v1.

</deferred>

---

*Phase: 02-multi-tenant-auth-tenant-routing*
*Context gathered: 2026-05-30*
