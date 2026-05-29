# Phase 2: Multi-Tenant Auth & Tenant Routing — Research

**Researched:** 2026-05-30
**Domain:** Multi-tenant SaaS auth (Supabase Auth via `@supabase/ssr`) + path-based tenant routing on Next.js 16 App Router + Prisma isolation enforcement
**Confidence:** HIGH on Supabase wiring, tenant-context propagation, requireTenant control flow, backfill ordering, timezone bucketing. MEDIUM-HIGH on the custom ESLint rule (flat-config custom-plugin pattern is well-documented; the AST shape for "missing tenantId" needs the planner to pin the exact selector).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Authentication (AUTH-01..05)**
- **D-01:** Auth provider = Supabase Auth via `@supabase/ssr`. SOW mandate (overrides STACK.md's Better Auth suggestion). Same Supabase project as the Postgres DB (Phase 1 D-01).
- **D-02:** Sign-in methods = email magic link (primary) + Google OAuth (optional). Magic link first; Google OAuth wired but secondary.
- **D-03:** Sessions = cookie-based via `@supabase/ssr` (httpOnly). Not localStorage. A `middleware.ts` runs `supabase.auth.getUser()` to refresh the session cookie on every request.
- **D-04:** Custom login page at `app/login/page.tsx` calling `supabase-js` (`signInWithOtp`, `signInWithOAuth`) — NOT Supabase's hosted Auth UI. Callbacks land on `app/auth/callback/route.ts` that exchanges the code for a session cookie.
- **D-05:** Logout available from every authenticated page (sign-out action in the app shell header → clears session → redirects to `/login`).
- **D-06:** Every `app/api/*` route requires a valid session → 401 if absent. Enforced inside `requireTenant()` plus a `middleware.ts` matcher covering `/api/:path*` and `/shop/:path*`. Webhook routes (Phase 3+, `app/api/webhooks/*`) are the documented exception (HMAC + domain/realmId resolver).

**Tenant Routing (TNT-01)**
- **D-07:** New `Tenant.slug String @unique`, slugified from shop name. Beauty Square backfilled to `slug="beauty-square"`. The slug is the URL segment.
- **D-08:** Move tenant-scoped pages under `app/shop/[slug]/` (relocate `dashboard/`, `settings/`, `suppliers/`, `promos/`, `simulate/`, `reports/`, and `dashboard/product/[id]/`). Marketing/static pages stay at root (`contact/`, `pricing/`, root `page.tsx`). Client `fetch()` calls update to tenant-aware API paths or pass the slug.
- **D-09:** Root `/` redirects: authed + one membership → `/shop/[slug]/dashboard`; multiple → tenant picker; zero → onboarding; unauth → `/login`. Logged-in user hitting a `/shop/[slug]/` they are NOT a member of → **403**.

**requireTenant() Chokepoint (TNT-02, TNT-03)**
- **D-10:** Single `requireTenant()` helper at `lib/auth/context.ts` is the ONLY sanctioned tenant resolver in app routes. It (a) reads the Supabase session (401 if none), (b) resolves active tenant by slug, (c) verifies `Membership` (403 if not), (d) returns `{ tenant, membership, userId }`. All 12+ `prisma.tenant.findFirst()` callsites are deleted and routed through it (`grep -r "prisma.tenant.findFirst" app/` must return zero — success criterion #4). **Active-slug propagation:** page routes get slug from `params`; API routes get it from a `middleware.ts`-injected `x-tenant-slug` header OR an explicit client-sent header. **Exact injection mechanism is Claude's discretion** within this contract.
- **D-11:** Webhook routes use a SEPARATE resolver (`resolveTenantByDomain()`/`resolveTenantByRealmId()`), not `requireTenant()`. Phase 2 only establishes the pattern/placeholder; handlers ship in Phase 3.

**Membership & Roles (TNT-04)**
- **D-12:** `Membership { id, userId String, tenantId String, role Role, createdAt }` with `@@unique([userId, tenantId])` and `@@index([tenantId])`. `Role` enum = `OWNER | MEMBER`. Cascade-delete from `Tenant`.
- **D-13:** `userId` stores the Supabase `auth.users` UUID as a plain String — no Prisma FK into Supabase's `auth` schema.
- **D-14:** First-time signup → create tenant + OWNER membership ("Create your shop" onboarding). Inviting additional `MEMBER`s is **deferred**.
- **D-15:** Backfill the existing Beauty Square tenant via `scripts/backfill-tenant-membership.ts`: assign `slug="beauty-square"` + create an OWNER `Membership` for Roy's/Mary's Supabase account.

**Isolation Enforcement (TNT-05, TNT-06, TNT-07)**
- **D-16:** ESLint custom rule bans bare `prisma.*.findMany()/findFirst()` without a `tenantId` filter outside the resolver layer, enforced in CI. This is the locked required deliverable. A Prisma client extension as second defense-in-depth is Claude's discretion.
- **D-17:** Two-tenant integration test (TNT-05) built on the Phase 1 vitest harness. Seeds tenant A + B, asserts A cannot read/mutate B's `Product`, `SalesHistory`, `Supplier`, `Promo`, `Prediction`, or `Order` rows.
- **D-18:** `lib/cache/tenant-cache.ts` is the only sanctioned cache helper. A thin wrapper over `unstable_cache` (or dev Map fallback) whose `tenantScopedCacheKey()` and tags are auto-prefixed with `tenantId`.

**Tenant Timezone (TNT-08)**
- **D-19:** `Tenant.timezone String @default("Africa/Nairobi")` (IANA tz). All date bucketing in forecast + reorder windows respects it. Library = Claude's discretion (`Intl` or `date-fns-tz`). Interacts with Phase 1 D-06: `runDate` (the seed key) must now be computed in tenant tz so the determinism invariant holds per-tenant.

### Claude's Discretion
- Exact `middleware.ts` tenant-header injection mechanism for API routes (within D-10 contract).
- Whether to add a Prisma client extension on top of the required ESLint rule (D-16).
- Test file location: colocated `*.test.ts` vs `tests/` dir (D-17).
- Timezone library: `Intl` vs `date-fns-tz` (D-19).
- Tenant-picker UI for multi-membership users (D-09) — simple list is fine.
- Pinned versions of `@supabase/supabase-js` + `@supabase/ssr` (resolved below — research Q1).
- Whether to spike token-encryption now or defer to Phase 3 — default: **defer** (no tokens stored in Phase 2).

### Deferred Ideas (OUT OF SCOPE)
- Real Shopify/QuickBooks/Odoo OAuth + token storage + encryption (Phases 3-4). `TOKEN_ENCRYPTION_KEY` documented but no tokens stored yet.
- Member-invitation flow (adding `MEMBER`s) — schema + role enum ship now; invite UI deferred.
- Subdomain routing (`acme.wezesha.app`) — v2, path-based only for v1.
- Python sidecar, PO delivery, source-of-truth merge — Phases 4-5.
- UI redesign — pages move directories + gain an auth/tenant shell, but layout/visuals stay as-is.
- Prisma client extension (optional defense-in-depth beyond the required ESLint rule).
- Supabase RLS as a second isolation layer — available free, but `requireTenant()` is the contract; RLS not leaned on in v1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Sign up + log in via Supabase email + magic link | `signInWithOtp({ email, options: { emailRedirectTo } })` + `app/auth/callback` `exchangeCodeForSession` — §Code Examples 5, 6 |
| AUTH-02 | Optional Google OAuth login | `signInWithOAuth({ provider: 'google', options: { redirectTo } })` — same callback route — §Code Examples 5 |
| AUTH-03 | Session persists across browser refresh | httpOnly cookies via `@supabase/ssr` + `middleware.ts updateSession` calling `getUser()` every request — §Code Examples 2, 3 |
| AUTH-04 | Log out from any page | `app/auth/signout/route.ts` POST → `supabase.auth.signOut()` → redirect `/login`; sign-out control in the `app/shop/[slug]/layout.tsx` header — §Code Examples 7 |
| AUTH-05 | Every `app/api/*` requires session → 401 | `requireTenant()` reads session, throws `TenantError(401)` if none; middleware matcher is the outer gate — §Pattern 3 |
| TNT-01 | Path-based `/shop/[slug]/...`; cross-tenant → 403 | Move tree per D-08; middleware + `requireTenant()` do the membership check → 403 — §Architecture, §Pattern 2 |
| TNT-02 | Single `requireTenant()`; all 12 `findFirst()` removed | `lib/auth/context.ts` chokepoint replaces each `const tenant = await prisma.tenant.findFirst()` — §Runtime State Inventory, §Pattern 3 |
| TNT-03 | Webhook routes use separate domain/realmId resolver | `lib/auth/webhook-context.ts` placeholder `resolveTenantByDomain/RealmId` — documented `findUnique` survivor — §Pattern 4 |
| TNT-04 | `Membership` table, role enum (`OWNER`/`MEMBER`) | Schema delta in §Architecture; UUID-string userId (no cross-schema FK) — §Pitfall 4 |
| TNT-05 | Two-tenant integration test for row isolation | Vitest harness extension; per-model assertion matrix — §Validation Architecture, §Code Examples 8 |
| TNT-06 | ESLint rule bans bare `findMany/findFirst` without tenantId | Custom flat-config plugin with `no-restricted-syntax`-style selector — §Don't Hand-Roll, §Code Examples 4, §Pitfall 5 |
| TNT-07 | `lib/cache/tenant-cache.ts` scopes keys+tags by tenantId | `tenantScopedCacheKey()` wrapper over `unstable_cache` — §Pattern 5, §Pitfall 6 |
| TNT-08 | `Tenant.timezone` stored; date bucketing respects it | `date-fns-tz` or `Intl` helper; rewrite the `setUTCHours/getUTCDate` calls in forecast/reorder — §Pattern 6, §Pitfall 7 |
</phase_requirements>

## Summary

Phase 2 retrofits authentication and hard tenant isolation onto a single-tenant demo that currently has **zero auth** and resolves "the tenant" via `prisma.tenant.findFirst()` in 16 places across 14 API route files. The work is well-trodden: Supabase's `@supabase/ssr` package has a canonical Next.js App Router recipe (browser client, server client, `middleware.ts` token refresh, `auth/callback` code exchange), and Next.js 16 middleware supports request-header injection via `NextResponse.next({ request: { headers } })` — the mechanism that lets API routes (still at `app/api/*`, NOT under `/shop/[slug]`) read the active tenant.

The two genuinely project-specific risks are (1) the **ESLint enforcement rule** — there is no off-the-shelf "prisma calls must include tenantId" rule, so the plan must ship a small local flat-config plugin and accept its inherent imprecision (it can reliably ban bare `prisma.tenant.findFirst()` and flag `findMany/findFirst` whose `where` object literal lacks a `tenantId` key, but it cannot follow variables), and (2) the **tenant-timezone retrofit** — Phase 1's forecast/reorder code is littered with `setUTCHours(0,0,0,0)` and `new Date()`, and the determinism seed key `(productId, runDate)` must now compute `runDate` as the tenant-local calendar date or the Phase 1 invariant silently breaks per-tenant.

**Primary recommendation:** Install `@supabase/ssr@0.10.3` + `@supabase/supabase-js@2.106.2` + `date-fns-tz@3.2.0`. Build `lib/supabase/{client,server,middleware}.ts` from the official recipe, a `middleware.ts` that refreshes the session AND injects `x-tenant-slug`/`x-tenant-id`/`x-user-id` headers, a `requireTenant()` that throws typed `401`/`403` errors caught by a route wrapper, a local `eslint-plugin-tenant-safety` flat-config plugin, a `lib/time/tenant-date.ts` helper using `date-fns-tz`, and a 2-tenant vitest integration test that talks directly to Prisma (not over HTTP). Backfill ordering: add `slug` nullable → backfill → make `@unique` not-null in a second migration.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/ssr` | `0.10.3` | Cookie-based Supabase Auth for Next.js App Router (browser + server clients, middleware refresh) | The ONLY Supabase-blessed path for App Router SSR; replaces the deprecated `@supabase/auth-helpers-nextjs`. Published 2026-05-07 (verified `npm view`). |
| `@supabase/supabase-js` | `2.106.2` | Underlying JS client (`auth.signInWithOtp`, `signInWithOAuth`, `signOut`, `getUser`, `exchangeCodeForSession`) | Peer dep of `@supabase/ssr` (`^2.105.3`). Published 2026-05-28 (verified). |
| `date-fns-tz` | `3.2.0` | IANA-timezone date bucketing for `Tenant.timezone` (TNT-08) | Mature, tree-shakeable, `toZonedTime`/`formatInTimeZone` cover the "what calendar day is it in Africa/Nairobi" need exactly. Peer dep `date-fns@^3 || ^4`. |
| `date-fns` | `^4` (or `^3`) | Peer dep of `date-fns-tz` | Required by `date-fns-tz`. Pin one major; `^4` is current. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | ESLint custom rule ships as a **local plugin file**, no npm dep | TNT-06 — write `eslint-plugin-tenant-safety/index.mjs` in-repo; ESLint 9 flat config imports it directly. No `@typescript-eslint/utils` strictly required if you use plain AST selectors, but it helps for typed rules (see §Don't Hand-Roll). |
| `slugify` | — | **Skip** — slug from shop name is a 5-line regex (`.toLowerCase().replace(/[^a-z0-9]+/g, '-')`). Not worth a dep. | D-07 slug generation. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `date-fns-tz` | Native `Intl.DateTimeFormat` with `timeZone` option | `Intl` has zero deps and can compute the tenant-local Y-M-D (the only thing the seed key needs). But assembling a `Date` floor/ceil in a tz from `Intl` parts is fiddly and error-prone; `date-fns-tz`'s `toZonedTime`/`fromZonedTime` are purpose-built. **Recommend `date-fns-tz`** for the date-arithmetic in forecast/reorder; `Intl` is fine if the planner wants zero deps and only needs the Y-M-D string for the seed key. |
| `@supabase/ssr` | `@supabase/auth-helpers-nextjs` | Deprecated. Do not use. `@supabase/ssr` is the replacement. |
| Custom ESLint rule | Supabase RLS only | RLS is real defense-in-depth but is explicitly NOT the contract for v1 (deferred). The ESLint rule is the locked deliverable (D-16). |
| `signInWithOtp` magic link | Supabase hosted Auth UI / `@supabase/auth-ui-react` | `@supabase/auth-ui-react` is in maintenance mode and D-04 mandates a custom branded page. Use raw `supabase-js` calls. |

**Installation:**
```bash
npm install @supabase/ssr@0.10.3 @supabase/supabase-js@2.106.2 date-fns-tz@3.2.0 date-fns@4
```

**Version verification (run at plan start to confirm still-current):**
```bash
npm view @supabase/ssr version          # expect 0.10.3 (2026-05-07)
npm view @supabase/supabase-js version  # expect 2.106.2 (2026-05-28)
npm view date-fns-tz version            # expect 3.2.0
```

> Env vars already exist in `.env.example` (verified): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`. **Note:** Supabase's newest docs reference `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the older `NEXT_PUBLIC_SUPABASE_ANON_KEY` name still works and is what this repo already documents — keep using `ANON_KEY` for consistency unless the planner wants to rename. The service-role key is NOT needed for Phase 2 auth (only for the backfill script which can use `DIRECT_URL`/Prisma directly).

## Architecture Patterns

### Recommended Project Structure (deltas only)
```
middleware.ts                          # NEW — session refresh + tenant-header injection + matcher
lib/
├── supabase/
│   ├── client.ts                      # NEW — createBrowserClient (for "use client" login page)
│   ├── server.ts                      # NEW — createServerClient (RSC + route handlers + requireTenant)
│   └── middleware.ts                  # NEW — updateSession() used by root middleware.ts
├── auth/
│   ├── context.ts                     # NEW — requireTenant() chokepoint (D-10)
│   ├── webhook-context.ts             # NEW — resolveTenantByDomain/RealmId placeholder (D-11)
│   └── route-wrapper.ts               # NEW (optional) — withTenant() that catches TenantError → 401/403
├── cache/
│   └── tenant-cache.ts                # NEW — tenantScopedCacheKey() + tenantCache() (D-18)
├── time/
│   └── tenant-date.ts                 # NEW — tenant-tz date bucketing (D-19)
├── tenant/
│   └── slug.ts                        # NEW — slugify(name)
app/
├── login/page.tsx                     # NEW — "use client" branded login (magic link + Google)
├── auth/
│   ├── callback/route.ts              # NEW — exchangeCodeForSession
│   └── signout/route.ts               # NEW — signOut + redirect /login
├── page.tsx                           # EDIT — root membership-based redirect (D-09)
├── onboarding/page.tsx                # NEW — "Create your shop" (D-14)
└── shop/[slug]/
    ├── layout.tsx                     # NEW — auth/tenant shell + sign-out header
    ├── dashboard/  settings/  suppliers/  promos/  simulate/  reports/   # MOVED from app/*
    └── dashboard/product/[id]/        # MOVED
eslint-plugin-tenant-safety/
└── index.mjs                          # NEW — custom flat-config rule (D-16)
eslint.config.mjs                      # EDIT — register the plugin + rule
prisma/schema.prisma                   # EDIT — Tenant.slug, Tenant.timezone, Membership, Role
prisma/migrations/...                  # NEW — 2 stacked migrations (nullable slug, then unique/not-null)
scripts/backfill-tenant-membership.ts  # NEW — D-15
tests/ or lib/__tests__/               # NEW — 2-tenant isolation test (D-17)
```

### Pattern 1: Three Supabase clients (browser / server / middleware)
**What:** `@supabase/ssr` requires THREE client constructions because cookies are read/written differently in each context.
**When to use:** Always, for App Router. The browser client (`createBrowserClient`) is for `"use client"` components (the login page). The server client (`createServerClient` + `cookies()` from `next/headers`) is for RSCs and route handlers. The middleware client copies cookies onto the `NextResponse`.
**Key gotcha:** In Server Components, `cookieStore.set()` throws — wrap `setAll` in try/catch (Server Components can't set cookies; the middleware refresh covers it). See Code Example 2.

### Pattern 2: Tenant context propagation (middleware → route handler)
**What:** API routes live at `app/api/*`, NOT under `/shop/[slug]`, so they cannot read the slug from `params`. The middleware derives the active slug from the **referring `/shop/[slug]` request** (for page-driven `fetch`es, the slug is in the `Referer` path or a client-sent `x-tenant-slug` header) and injects resolved identity as request headers the route handler reads.
**Recommended mechanism (Claude's discretion resolved):** middleware sets request headers via `NextResponse.next({ request: { headers: newHeaders } })`:
- `x-user-id` — from `supabase.auth.getUser()` (always set when authed)
- `x-tenant-slug` — from the client-sent `x-tenant-slug` header (the page fetch attaches it) OR parsed from `Referer`
Then `requireTenant()` reads `headers().get('x-tenant-slug')` + `x-user-id`, does the membership check, and returns `{ tenant, membership, userId }`.
**Why headers, not AsyncLocalStorage:** The frozen ARCHITECTURE.md sketch proposed AsyncLocalStorage, but Next.js 16 middleware runs on a separate (Edge) runtime from Node route handlers and ALS does not cross that boundary. **Request-header injection is the documented, runtime-safe mechanism.** ALS *can* be layered inside the Node route handler later, but the cross-cut from middleware must be headers.
**Concrete plan note:** client pages under `/shop/[slug]/` should attach `x-tenant-slug: <slug>` to every `fetch('/api/...')` (a thin `apiFetch(slug, path)` wrapper). This is more robust than `Referer` parsing. See Code Example 3.

### Pattern 3: requireTenant() control flow (401 vs 403)
**What:** A single async function that throws a typed error rather than returning `NextResponse` directly, so the same helper works in RSCs (where you'd `redirect()`) and route handlers (where you'd return JSON).
**Recommended shape:** `requireTenant()` throws `TenantError` with a `.status` (401 or 403). A `withTenant(handler)` wrapper for route handlers catches it and returns `NextResponse.json({error}, {status})`. RSCs call `requireTenant()` inside `app/shop/[slug]/layout.tsx` and on a thrown 401 `redirect('/login')`, on 403 `redirect('/')` or render a forbidden page. See Code Example 3.
**401 vs 403 rule:** no session → 401 (AUTH-05). Valid session but no `Membership` for the requested slug → 403 (TNT-01). Slug not found in DB → 404 (or 403 to avoid tenant-existence enumeration — recommend 404 for owner clarity in v1, single-tenant reality makes enumeration moot).

### Pattern 4: Webhook resolver kept separate (D-11)
**What:** `lib/auth/webhook-context.ts` exports `resolveTenantByDomain(domain)` and `resolveTenantByRealmId(realmId)` — the ONE legitimate `findUnique`-by-external-key path. Phase 2 ships only the placeholder + a JSDoc banner ("the only sanctioned non-session tenant resolver; webhooks have no session"). The ESLint rule must **allow-list this file** (or the resolver functions) so it doesn't flag the legitimate lookup.

### Pattern 5: Tenant-scoped cache (D-18)
**What:** `tenantScopedCacheKey(tenantId, ...parts)` returns `[tenantId, ...parts]`; `tenantCache(tenantId, keyParts, fn, { tags })` wraps `unstable_cache` with the tenant-prefixed key AND tenant-prefixed tags (`forecast:${tenantId}`), so `revalidateTag` can never cross tenants. A dev `Map` fallback is fine — almost nothing is cached today; this establishes the pattern before Phases 3-5 add cacheable reads (Pitfall 6).

### Pattern 6: Tenant-timezone date bucketing (D-19)
**What:** `lib/time/tenant-date.ts` exports `tenantToday(tz): Date` (the tenant-local calendar-day floor, as a UTC instant representing local midnight) and `tenantDayKey(tz, date?): string` (the `YYYY-MM-DD` string in tenant tz — this is the new `runDate` seed component). The forecast/reorder code's `new Date()` + `setUTCHours(0,0,0,0)` blocks get replaced with `tenantToday(tenant.timezone)`.
**Determinism interaction (critical):** Phase 1's seed key is `(productId, runDate)` where `runDate` flows through `seedFrom([... date ...])` which does `.toISOString().slice(0,10)`. If `runDate` is the tenant-local day, the slice must reflect tenant-local, NOT UTC. Cleanest fix: pass the **`tenantDayKey` string** into the seed parts (not a `Date`), so the seed is unambiguously the tenant-local calendar day and the `.toISOString()` UTC drift in `rng.ts` is bypassed for this value. See Code Example 9.

### Anti-Patterns to Avoid
- **Running code between `createServerClient` and `getUser()` in middleware.** Supabase warns this causes random logouts (the token refresh must be the first thing). Keep `updateSession` minimal; do tenant-membership work AFTER, or in `requireTenant()`.
- **AsyncLocalStorage across the middleware/route boundary** — does not survive the Edge→Node hop. Use header injection (Pattern 2).
- **`prisma.tenant.findFirst()` regressions** — a new route copy-pasted from an un-migrated one. The ESLint rule (D-16) is the regression net; ensure it runs in `npm run lint` and CI.
- **Putting the slug in `params` for API routes** — API routes stay at `app/api/*`; they never get `[slug]` in params. Don't restructure `app/api` under `/shop/[slug]` — that would break every client `fetch` path and isn't in scope.
- **Trusting the client-sent `x-tenant-slug` header without the membership check** — the header is just routing convenience; `requireTenant()` MUST verify the `Membership(userId, tenantId)` exists. The header is not authorization.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cookie-based session refresh | Custom cookie parsing / JWT refresh logic | `@supabase/ssr` `createServerClient` + middleware `getUser()` | Token refresh, httpOnly cookie chunking, PKCE flow are all handled. Hand-rolling = silent logout bugs. |
| Magic-link / OAuth code exchange | Manual token endpoint calls | `supabase.auth.exchangeCodeForSession(code)` in `auth/callback` | PKCE verifier handling is in the SDK. |
| IANA timezone day math | Manual UTC-offset arithmetic | `date-fns-tz` `toZonedTime` / `fromZonedTime` | DST + offset edge cases (Africa/Nairobi is UTC+3 fixed, but the helper must be correct for any future tenant tz). |
| Slug generation | A dep | 5-line regex (`lib/tenant/slug.ts`) | Trivial; a dep is overkill. |
| The ESLint rule itself | A published "prisma-tenant" plugin (none exists/trustworthy) | A **local** flat-config plugin (`eslint-plugin-tenant-safety/index.mjs`) | TNT-06 is bespoke. Use `meta`/`create` with an AST selector matching `CallExpression[callee.property.name=/^(findMany\|findFirst\|findUnique)$/]` whose object arg lacks a `tenantId` property. Accept it can't follow variables (see Pitfall 5). |

**Key insight:** Everything auth-related has a blessed Supabase recipe — follow it verbatim. The ONLY genuinely custom code is the ESLint rule and the timezone helper, and both are small. Do not invent auth machinery.

## Runtime State Inventory

> This is a retrofit phase (auth + routing + isolation grafted onto an existing app). A grep finds files; it does not find runtime state. Findings:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Existing `Tenant` row** ("Beauty Square KE", `shopifyDomain="beautysquareke.co"`) in Supabase Postgres with ~1,023 Products + synthetic SalesHistory/Predictions/Orders. It has NO `slug`, NO `timezone`, and NO `Membership`. | **Data migration (D-15 backfill):** set `slug="beauty-square"`, `timezone="Africa/Nairobi"` (default covers it), create OWNER `Membership` bound to the dev/owner Supabase user UUID. Without this the 1,023-product demo becomes unreachable under `/shop/[slug]`. |
| Stored data | **Supabase `auth.users`** — the owner's account must EXIST in Supabase before the backfill can bind a `Membership.userId`. On a fresh Supabase project this table is empty until first magic-link signup. | Backfill script must take the owner's Supabase UUID (or email → look up) as input. **Make it env-configurable** (`BACKFILL_OWNER_EMAIL` or `BACKFILL_OWNER_USER_ID`). Ordering: owner signs up via the new `/login` once → grab their UUID → run backfill. Document this 2-step in the script header. |
| Live service config | **Supabase Auth settings** (project dashboard, NOT git): redirect URLs must whitelist `http://localhost:3082/auth/callback` (dev) + the Vercel prod URL; Google OAuth provider must be enabled + client-id/secret entered; email-template/magic-link settings. | **Manual dashboard config** (Roy/Anjay). Flag as a human checklist item in the plan — code alone won't make magic links or Google work. Site URL + Redirect URLs are the usual first-failure. |
| OS-registered state | None — no Task Scheduler / cron / pm2 involvement in Phase 2. | None — verified (no cron added until Phase 3 reconcile). |
| Secrets/env vars | `.env.example` already lists `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (verified). The real values live in `.env` (gitignored) + Vercel env — NOT in git. | **Populate values** (Roy): copy from Supabase dashboard → `.env` (local) + Vercel (prod). No new env var NAMES needed for Phase 2; values must be filled. `TOKEN_ENCRYPTION_KEY` stays unused (Phase 3). |
| Build artifacts | Prisma client (`@prisma/client`) is regenerated by `postinstall`/`db:generate`. After adding `Membership`/`Role`/`Tenant.slug`/`Tenant.timezone`, `prisma generate` MUST rerun or the new types/models are absent. | **Code action:** every migration step in the plan ends with `prisma generate` (the `build` script already chains `prisma generate && prisma migrate deploy`). The 2-tenant test imports the regenerated client. |

**The canonical question — after every file is updated, what runtime systems still hold old state?** The Supabase Auth dashboard config (redirect URLs, Google provider) and the existing tenant row's missing `slug`/`Membership`. Both are addressed above; neither is fixable by code edits alone.

## Common Pitfalls

### Pitfall 1: `findFirst()` pattern carried into new code, leaking data forever
**What goes wrong:** The retrofit replaces the 16 `prisma.tenant.findFirst()` calls, but two months later a new route copy-pastes the old pattern from muscle memory, or a webhook resolves tenant by spoofable domain via `findFirst`. The leak only manifests when a SECOND tenant exists — and Phase 2 is precisely when the second tenant becomes possible.
**Why it happens:** Half-migrated codebases leave landmines; "works in dev with one tenant" stays true through the whole retrofit.
**How to avoid:** The ESLint rule (D-16, TNT-06) is the regression net — it must run in `npm run lint` AND block CI. The 2-tenant test (D-17, TNT-05) is the honest acceptance test. Scripts (`seed`, `run-forecasts`, `backfill`) live outside auth — they need explicit per-tenant scoping, not `requireTenant()`.
**Warning signs:** Any new API route not starting with `await requireTenant()`; any `prisma.*.findMany` without `tenantId` in `where`; the dashboard "just working" for one tenant in dev.

### Pitfall 2: Code between `createServerClient` and `getUser()` in middleware → random logouts
**What goes wrong:** You add membership lookups or logging between client creation and `getUser()` in `updateSession`; users get logged out intermittently.
**Why it happens:** The token-refresh-and-cookie-rewrite must be the first and only thing `updateSession` does; interleaving breaks the cookie sync.
**How to avoid:** Keep `updateSession` to the minimal official shape (create client → `getUser()` → return response with copied cookies). Do tenant/membership work in `requireTenant()` (route/RSC layer), not in middleware. Middleware only injects headers AFTER `getUser()`.
**Warning signs:** Intermittent "logged out on refresh" reports; sessions dropping on specific routes.

### Pitfall 3: Server Component tries to set cookies → throws
**What goes wrong:** `createServerClient`'s `setAll` calls `cookieStore.set()` inside an RSC, which is read-only for cookies → exception.
**Why it happens:** Next.js only allows cookie writes in route handlers, server actions, and middleware — not RSC render.
**How to avoid:** Wrap `setAll` in try/catch (swallow the error) in `lib/supabase/server.ts`. The middleware refresh handles the actual cookie write. This is in the official recipe (Code Example 2).
**Warning signs:** "Cookies can only be modified..." errors in RSC render logs.

### Pitfall 4: Cross-schema FK from Prisma into Supabase `auth.users`
**What goes wrong:** Modeling `Membership.user` as a Prisma relation to a `User` model mapped to `auth.users` → Prisma tries to manage the `auth` schema, migrations fight Supabase, or you get FK violations because Prisma doesn't own that table.
**Why it happens:** Instinct to add a real FK for referential integrity.
**How to avoid (D-13):** Store `Membership.userId String` as the plain Supabase UUID. NO `@relation` to an auth-schema model. No FK. Prisma stays in the `public` schema only. Orphan-membership cleanup (user deleted in Supabase) is a non-issue for v1.
**Warning signs:** `prisma migrate` wanting to create/alter an `auth` schema; "relation auth.users does not exist" in shadow-db.

### Pitfall 5: ESLint rule false-confidence — it can't follow variables
**What goes wrong:** The rule matches `prisma.product.findMany({ where: { tenantId } })` (good) but a developer writes `const q = { where: {} }; prisma.product.findMany(q)` and the rule can't see inside `q` → silent miss. Or the rule is too aggressive and flags legitimate non-tenant tables (Supabase's own, or a future global lookup table).
**Why it happens:** ESLint is syntactic, not type-aware (unless you wire `@typescript-eslint` type info, which is slow).
**How to avoid:** Scope the rule to (a) ban ALL `prisma.tenant.findFirst()`/`findUnique()` outside the allow-listed resolver files (this is reliable — it's a literal property match), and (b) flag `findMany/findFirst` with an **inline object-literal `where`** that lacks a `tenantId` key (catches the common case). Document the known limitation (variable indirection) in the rule's JSDoc. The 2-tenant test (D-17) is the real safety net; the linter is the fast feedback. Allow-list `lib/auth/context.ts`, `lib/auth/webhook-context.ts`, and `scripts/**` (scripts scope explicitly).
**Warning signs:** Rule passing on code that has no `tenantId`; rule flagging the resolver itself (forgot to allow-list).

### Pitfall 6: Forecast/dashboard cache shared across tenants
**What goes wrong:** A later phase caches forecast reads keyed on `productId` or SKU; Tenant B with an overlapping SKU gets Tenant A's cached number. `revalidateTag('forecast')` blows away everyone's cache.
**Why it happens:** Cache keys/tags forget `tenantId`.
**How to avoid (D-18):** `lib/cache/tenant-cache.ts` is the only sanctioned cache; every key and tag is `tenantId`-prefixed. Establish it now even though little is cached, so Phases 3-5 inherit the safe pattern.
**Warning signs:** Cache key strings without `tenantId`; two tenants reporting identical numbers; a global `revalidateTag`.

### Pitfall 7: Tenant-timezone breaks Phase 1 determinism
**What goes wrong:** Forecast `runDate` is computed as UTC `new Date()` + `setUTCHours(0,0,0,0)` (current code). With tenant-tz bucketing, if some code paths compute the day in tenant-local and others in UTC, the seed key `(productId, runDate)` diverges and the same product on the same Nairobi day produces different forecasts (Phase 1 FND-02 invariant breaks). Worse: near midnight UTC (3am Nairobi) the UTC date and Nairobi date differ, so a run at 01:00 Nairobi vs 04:00 Nairobi could seed differently.
**Why it happens:** Mixed UTC/local date math; the seed flows through `rng.ts`'s `.toISOString().slice(0,10)` which is always UTC.
**How to avoid (D-19):** Compute `runDate` ONCE as `tenantDayKey(tenant.timezone)` (a `YYYY-MM-DD` string in tenant tz) and pass that **string** into both the seed parts and the prediction's `runDate`/grouping. Rewrite every `setUTCHours/getUTCDate` in `app/api/forecast/run/route.ts`, `lib/forecast/simulate-layers.ts`, and the reorder window to use the tenant-tz helper. Add a determinism test that runs the forecast at two different UTC instants within the same Nairobi day and asserts identical output.
**Warning signs:** `check:determinism` failing intermittently around UTC midnight; forecasts differing between morning/evening runs.

### Pitfall 8: Moving page directories breaks client `fetch` paths and relative links
**What goes wrong:** Relocating `app/dashboard` → `app/shop/[slug]/dashboard` changes the page URL, but the client components still `fetch('/api/...')` (fine) and use `<Link href="/suppliers">` (now broken — should be `/shop/[slug]/suppliers`).
**Why it happens:** Internal nav links are relative to the old flat structure.
**How to avoid:** Audit every `<Link>` and `router.push` in the moved pages; prefix with `/shop/${slug}/`. The slug is available from `useParams()` in client components. The API `fetch` calls keep their `/api/*` paths but must now attach `x-tenant-slug` (Pattern 2). Plan a dedicated task for "rewire intra-tenant navigation + fetch headers."
**Warning signs:** 404s on nav after the move; API 401/403 because the slug header is missing.

## Code Examples

> All Supabase snippets follow the current official `@supabase/ssr` 0.10.x App Router recipe (getAll/setAll cookie API). Verified against Supabase docs 2026-05.

### 1. Browser client — `lib/supabase/client.ts`
```typescript
// Source: https://supabase.com/docs/guides/auth/server-side/creating-a-client
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

### 2. Server client — `lib/supabase/server.ts`
```typescript
// Source: https://supabase.com/docs/guides/auth/server-side/creating-a-client
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies(); // Next 16: cookies() is async

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component (cookies read-only here).
            // Safe to ignore — middleware updateSession refreshes the cookie.
          }
        },
      },
    }
  );
}
```

### 3. Middleware session refresh + tenant-header injection — `lib/supabase/middleware.ts` + `middleware.ts`
```typescript
// lib/supabase/middleware.ts
// Source: https://supabase.com/docs/guides/auth/server-side/nextjs (adapted)
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // CRITICAL: nothing between createServerClient and getUser() (Pitfall 2)
  const { data: { user } } = await supabase.auth.getUser();

  // Inject identity for API route handlers (Pattern 2). Header injection,
  // NOT AsyncLocalStorage — ALS does not cross the Edge->Node boundary.
  if (user) {
    const slug =
      request.headers.get("x-tenant-slug") ??       // client-sent (preferred)
      request.nextUrl.pathname.split("/")[2] ?? "";  // /shop/[slug]/... fallback
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", user.id);
    if (slug) requestHeaders.set("x-tenant-slug", slug);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    // re-copy auth cookies onto the new response if regenerated (see note)
  }

  return { response, user };
}
```
```typescript
// middleware.ts (repo root)
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  // Outer gate: unauthenticated hitting protected surfaces -> redirect/401
  const path = request.nextUrl.pathname;
  if (!user) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (path.startsWith("/shop/")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }
  return response;
}

export const config = {
  matcher: ["/shop/:path*", "/api/:path*"],
};
```
> **Planner note:** the header-re-injection + cookie-re-copy interaction is the fiddliest part. Keep one canonical `response` object; when you regenerate it via `NextResponse.next({ request: { headers } })`, re-apply the auth cookies. Test: authed refresh keeps session AND `x-user-id` reaches the route handler.

### 4. ESLint custom rule (sketch) — `eslint-plugin-tenant-safety/index.mjs`
```javascript
// Flat-config local plugin. Registered in eslint.config.mjs.
// Bans bare prisma.tenant.findFirst/findUnique and findMany/findFirst whose
// inline `where` literal lacks a `tenantId` key. Known limit: can't follow vars.
const rule = {
  meta: { type: "problem", docs: { description: "Prisma calls must be tenant-scoped (TNT-06)" }, schema: [] },
  create(context) {
    return {
      "CallExpression[callee.type='MemberExpression']"(node) {
        const prop = node.callee.property?.name;
        if (!["findMany", "findFirst", "findUnique"].includes(prop)) return;
        // is it prisma.<model>.<method>?
        const obj = node.callee.object;
        if (obj?.type !== "MemberExpression") return;
        const root = obj.object;
        if (root?.type !== "Identifier" || root.name !== "prisma") return;
        const model = obj.property?.name;
        // Ban any prisma.tenant.findFirst/findUnique outright (the landmine).
        if (model === "tenant" && (prop === "findFirst" || prop === "findUnique")) {
          context.report({ node, message: "Resolve tenants via requireTenant() — bare prisma.tenant lookup is banned (TNT-06)." });
          return;
        }
        // For other models: require an inline where with tenantId.
        const arg = node.arguments[0];
        const where = arg?.properties?.find(p => p.key?.name === "where");
        const hasTenantId = where?.value?.properties?.some(p => p.key?.name === "tenantId");
        if (!hasTenantId) {
          context.report({ node, message: `prisma.${model}.${prop}() must filter by tenantId (TNT-06).` });
        }
      },
    };
  },
};
export default { rules: { "require-tenant-scope": rule } };
```
```javascript
// eslint.config.mjs (additions)
import tenantSafety from "./eslint-plugin-tenant-safety/index.mjs";
// ...
{
  files: ["app/api/**/*.ts", "app/**/*.tsx", "lib/**/*.ts"],
  ignores: ["lib/auth/context.ts", "lib/auth/webhook-context.ts", "scripts/**"],
  plugins: { "tenant-safety": tenantSafety },
  rules: { "tenant-safety/require-tenant-scope": "error" },
}
```
> **Planner note:** `next lint` (the current `lint` script) is deprecated in Next 16 toward direct `eslint`. Verify the local plugin loads under whichever runner; if `next lint` swallows custom plugins, switch `npm run lint` to `eslint .` with the flat config.

### 5. Login page actions (magic link + Google) — `app/login/page.tsx` (client)
```typescript
// Source: supabase-js auth API
const supabase = createClient(); // browser client (Example 1)

// AUTH-01 magic link
await supabase.auth.signInWithOtp({
  email,
  options: { emailRedirectTo: `${location.origin}/auth/callback` },
});

// AUTH-02 Google OAuth
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: `${location.origin}/auth/callback` },
});
```

### 6. Callback code exchange — `app/auth/callback/route.ts`
```typescript
// Source: https://supabase.com/docs/guides/auth/server-side/nextjs
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
```

### 7. Sign out — `app/auth/signout/route.ts`
```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
```

### 8. requireTenant() chokepoint — `lib/auth/context.ts`
```typescript
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export class TenantError extends Error {
  constructor(public status: 401 | 403 | 404, message: string) { super(message); }
}

export async function requireTenant(slugArg?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new TenantError(401, "Unauthorized");           // AUTH-05

  const h = await headers();
  const slug = slugArg ?? h.get("x-tenant-slug") ?? "";
  if (!slug) throw new TenantError(404, "No tenant");

  const tenant = await prisma.tenant.findUnique({ where: { slug } }); // allow-listed file
  if (!tenant) throw new TenantError(404, "Tenant not found");

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) throw new TenantError(403, "Forbidden");          // TNT-01

  return { tenant, membership, userId: user.id };
}
```
```typescript
// lib/auth/route-wrapper.ts — for API route handlers
import { NextResponse } from "next/server";
import { requireTenant, TenantError } from "./context";

export function withTenant(handler) {
  return async (req, ctx) => {
    try {
      const tenantCtx = await requireTenant();
      return handler(req, { ...ctx, tenant: tenantCtx });
    } catch (e) {
      if (e instanceof TenantError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  };
}
```
> Each of the 14 API route files swaps `const tenant = await prisma.tenant.findFirst()` for the wrapper/`requireTenant()`. RSC pages call `requireTenant(params.slug)` and translate thrown errors into `redirect()`.

### 9. Tenant-tz date helper — `lib/time/tenant-date.ts`
```typescript
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";

/** YYYY-MM-DD in the tenant's tz — the determinism seed key component (D-19/D-06). */
export function tenantDayKey(tz: string, when: Date = new Date()): string {
  return formatInTimeZone(when, tz, "yyyy-MM-dd");
}

/** UTC instant for tenant-local midnight "today" — for date-range filters. */
export function tenantTodayUtc(tz: string, when: Date = new Date()): Date {
  const ymd = tenantDayKey(tz, when);
  return fromZonedTime(`${ymd}T00:00:00`, tz); // local midnight -> UTC instant
}
```
```typescript
// In app/api/forecast/run/route.ts, the seed/runDate becomes:
const runDateKey = tenantDayKey(tenant.timezone);      // "2026-05-30" Nairobi
// pass runDateKey (string) into the seed parts AND store as the prediction runDate bucket
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` (getAll/setAll cookie API) | 2024 (helpers deprecated) | Use `@supabase/ssr` only; helpers tutorials are obsolete. |
| `cookies()` sync | `cookies()` returns a Promise (must `await`) | Next 15/16 | `await cookies()` in server client + `await params` in pages (already a repo convention). |
| `next lint` | Direct `eslint` (flat config) | Next 16 deprecates `next lint` | Verify the custom plugin loads; may need `npm run lint` → `eslint .`. |
| AsyncLocalStorage tenant context (frozen research sketch) | Middleware request-header injection | This phase's correction | ALS doesn't cross Edge→Node; headers do. |
| `set({ name, value, options })` single-cookie methods | `getAll()` / `setAll()` | `@supabase/ssr` 0.x | Use the array-based handlers (shown in examples). |

**Deprecated/outdated:**
- `@supabase/auth-helpers-nextjs` — replaced by `@supabase/ssr`.
- `@supabase/auth-ui-react` — maintenance mode; D-04 mandates a custom page anyway.
- Single-cookie `get/set/remove` cookie handlers — replaced by `getAll/setAll`.

## Open Questions

1. **Which Supabase user is the backfill owner bound to?**
   - What we know: D-15 binds an OWNER `Membership` for "Roy's/Mary's Supabase account." `Membership.userId` is the Supabase `auth.users` UUID.
   - What's unclear: That UUID doesn't exist until someone signs up via the new `/login`. Chicken-and-egg with the backfill.
   - Recommendation: 2-step, env-configurable. (1) Deploy auth, owner signs up once via magic link. (2) Run `scripts/backfill-tenant-membership.ts` with `BACKFILL_OWNER_EMAIL` (script resolves email→UUID via Supabase admin API using `SUPABASE_SERVICE_ROLE_KEY`, OR Roy pastes the UUID from the dashboard). Document both paths in the script header.

2. **`next lint` vs `eslint .` for the custom rule.**
   - What we know: current `lint` script is `next lint`; Next 16 deprecates it.
   - What's unclear: whether `next lint` reliably loads a local flat-config plugin in this version.
   - Recommendation: plan a quick spike — if `next lint` doesn't surface the rule, switch `npm run lint` to `eslint .`. Either way the rule must fail CI.

3. **Does any cross-tenant client `fetch` need the slug, or is `Referer` enough?**
   - Recommendation: don't rely on `Referer` (can be stripped). Add a thin `apiFetch(slug, path, init)` that sets `x-tenant-slug`. Lowest-risk, explicit.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase project (Postgres + Auth) | All of Phase 2 | ✓ (Phase 1 D-01 provisioned Postgres on the same Supabase project) | — | None — hard requirement |
| Supabase Auth providers configured (magic link + Google) | AUTH-01, AUTH-02 | ✗ (dashboard config not yet done) | — | Magic link works with email defaults; Google needs client-id/secret in dashboard |
| `@supabase/ssr` / `supabase-js` (npm) | All auth | available (registry) | 0.10.3 / 2.106.2 | None |
| `date-fns-tz` (npm) | TNT-08 | available | 3.2.0 | `Intl.DateTimeFormat` (zero-dep alt) |
| Node 20+ / npm | build/test | ✓ (Phase 1 baseline) | — | — |
| vitest | TNT-05 test | ✓ (Phase 1 installed `vitest@^4.1.7`, harness exists) | 4.1.7 | — |
| Postgres reachable for the 2-tenant test | TNT-05 | ✓ via `DATABASE_URL`/`DIRECT_URL` | — | A dedicated test schema/db is cleaner — see Validation Architecture |

**Missing dependencies with no fallback:** None that block coding. Supabase Auth provider config (magic link + Google) is a **manual dashboard task** (human checklist), not a code dependency — magic link likely works out-of-box; Google needs OAuth credentials.

**Missing dependencies with fallback:** `date-fns-tz` ↔ native `Intl` (recommend the dep for correct date arithmetic).

## Validation Architecture

> `workflow.nyquist_validation` is **false** in config.json, so this section is OPTIONAL. Included in lean form because the 2-tenant isolation test (D-17/TNT-05) is the phase's central proof and the planner needs the test map.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.7 (installed Phase 1) |
| Config file | `vitest.config.ts` (node env; `include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"]`) |
| Quick run command | `npm test` (`vitest run`) |
| Full suite command | `npm test` then `npm run check:determinism` (or `npm run check:phase1`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TNT-05 | Tenant A cannot read/mutate B's Product/SalesHistory/Supplier/Promo/Prediction/Order | integration (Prisma-level) | `npx vitest run tests/tenant-isolation.test.ts` | ❌ Wave 0 |
| TNT-06 | Bare `prisma.*.findMany/findFirst` without tenantId fails lint | static | `npm run lint` (must exit non-zero on a planted violation) | ❌ Wave 0 (rule + fixture) |
| TNT-02 | Zero `prisma.tenant.findFirst` remain in `app/` | grep gate | `! grep -rq "prisma.tenant.findFirst" app/` | n/a (shell check) |
| TNT-08 | Same product, same Nairobi day, different UTC instant → identical forecast | unit/determinism | extend `scripts/check-determinism.ts` for a tz case | ⚠️ extend existing |
| AUTH-01..05, TNT-01 | session 401, cross-tenant 403, magic-link round-trip | manual / e2e | manual UAT (no Playwright in scope) | manual |

> Note the vitest `include` glob currently covers `lib/**` and `scripts/**`, NOT a top-level `tests/`. If the 2-tenant test lives in `tests/`, **add `"tests/**/*.test.ts"` to the include** (one-line config edit) — otherwise colocate it under `lib/__tests__/` to match the existing glob (D-17 leaves location to Claude's discretion; colocating avoids the config edit).

### Sampling Rate
- **Per task commit:** `npm test` (pure-fn + isolation tests; fast).
- **Per wave merge:** `npm test && npm run check:determinism && npm run lint`.
- **Phase gate:** full suite green + `grep` returns zero `findFirst` + manual auth UAT (magic link in, Google in, refresh persists, logout, cross-tenant 403) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/tenant-isolation.test.ts` (or `lib/__tests__/`) — seeds tenant A + B, asserts per-model isolation (TNT-05). Talks to Prisma directly, not over HTTP. Needs a test DB/schema + teardown.
- [ ] `eslint-plugin-tenant-safety/index.mjs` + a fixture file that MUST fail lint (TNT-06).
- [ ] Determinism test case for tenant-tz seed (TNT-08) — extend `scripts/check-determinism.ts` or add a `lib/time/tenant-date.test.ts`.
- [ ] If using `tests/` dir: add `"tests/**/*.test.ts"` to `vitest.config.ts` include.

## Sources

### Primary (HIGH confidence)
- Supabase docs — Server-Side Auth, Creating a Client (Next.js App Router): https://supabase.com/docs/guides/auth/server-side/creating-a-client — browser/server client + getAll/setAll cookie handlers (fetched 2026-05).
- Supabase docs — Setting up Server-Side Auth for Next.js: https://supabase.com/docs/guides/auth/server-side/nextjs — middleware updateSession, auth/callback exchangeCodeForSession.
- `npm view` (registry, 2026-05-30): `@supabase/ssr@0.10.3` (pub 2026-05-07), `@supabase/supabase-js@2.106.2` (pub 2026-05-28), peer `^2.105.3`; `next@16.2.6`; `date-fns-tz@3.2.0` (peer `date-fns@^3||^4`).
- Repo ground truth (read directly): `prisma/schema.prisma` (Tenant has no slug/timezone, no Membership), 16× `prisma.tenant.findFirst` across 14 files, `app/api/forecast/run/route.ts` (UTC `new Date()`+`setUTCHours`), `lib/forecast/rng.ts` (`.toISOString().slice(0,10)` seed), `vitest.config.ts`, `eslint.config.mjs` (flat config), `.env.example` (Supabase vars present).

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` §4 (multi-tenant data flow, header-injection pattern) — corrected here re: AsyncLocalStorage across Edge boundary.
- `.planning/research/PITFALLS.md` #9 (findFirst regression), #15 (cache leak) — incorporated.
- Next.js docs — middleware request-header mutation via `NextResponse.next({ request: { headers } })` (training + official pattern; verify exact API at plan time).

### Tertiary (LOW confidence — validate at plan time)
- Exact behavior of `next lint` loading a local flat-config plugin in Next 16.2.6 (Open Question 2) — spike needed.
- ESLint AST selector precision for the `tenantId`-missing case (Pitfall 5) — the literal-`where` heuristic is reliable; variable indirection is a known gap.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via `npm view`; `@supabase/ssr` is the singular blessed path.
- Architecture (auth wiring, requireTenant, header injection): HIGH — official recipe + repo ground truth; corrected the ALS misstep from frozen research.
- ESLint rule: MEDIUM-HIGH — pattern is sound; exact AST selector + `next lint`-vs-`eslint` runner need a small spike.
- Timezone/determinism: HIGH — clear interaction identified with Phase 1's seed; helper is small and testable.
- Pitfalls: HIGH — each cross-referenced with frozen PITFALLS.md and confirmed against current code.

**Research date:** 2026-05-30
**Valid until:** ~2026-06-29 (30 days; Supabase `@supabase/ssr` is fairly stable but versions move — re-run `npm view` at plan start).
