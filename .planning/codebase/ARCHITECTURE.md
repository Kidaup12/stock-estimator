# Architecture

**Analysis Date:** 2026-05-28

## Pattern Overview

**Overall:** Next.js 16 App Router monolith — server-first React Server Components for layout/chrome, `"use client"` pages for all interactive screens, fetching their data from co-located REST-style route handlers under `app/api/*`. Prisma ORM talks to SQLite locally (Postgres in prod). Single-tenant in practice (first-row lookup pattern) but modelled as multi-tenant.

**Key Characteristics:**
- **Server-first Next.js App Router** with file-based routing under `app/`. Root layout (`app/layout.tsx`) is a server component that loads fonts and a shared footer; every interactive page (`app/dashboard/page.tsx`, `app/suppliers/page.tsx`, etc.) is a client component that hydrates and calls `/api/*` via `fetch`.
- **Thin API layer over Prisma** — every route handler in `app/api/` follows the same shape: resolve `tenant = prisma.tenant.findFirst()`, validate body with Zod, run Prisma queries, return `NextResponse.json(...)`. No service classes; the routes ARE the service layer.
- **Forecast engine is a pure TypeScript module** living at `lib/forecast/simulate-layers.ts`. It's deliberately framework-agnostic: no Prisma, no Next, no I/O. The same function is called both from `app/api/forecast/run/route.ts` (HTTP path) and `scripts/run-forecasts.ts` (CLI path). This is the "swap-to-Python-sidecar" seam called out in `README.md`.
- **Mock-first integrations** — `lib/shopify/client.ts` exposes a real-looking class (`testConnection`, `fetchProducts`, `fetchOrders`, `fetchInventory`, `createDraftOrder`) but every method currently reads from Prisma instead of HTTP. Each method has a `// MOCK — real impl:` comment naming the actual Shopify endpoint to swap in.
- **No onboarding route exists.** Despite the README mentioning `/onboarding`, there is no `app/onboarding/` directory. The Shopify connect + seed + forecast UX lives on `app/settings/page.tsx` — single-screen flow with three buttons that POST to `/api/shop`, `/api/seed`, `/api/forecast/run` in sequence.

## Layers

**Presentation (Client Pages):**
- Purpose: All interactive UI; tab state, search, modals, button-driven actions.
- Location: `app/dashboard/page.tsx`, `app/dashboard/product/[id]/page.tsx`, `app/settings/page.tsx`, `app/suppliers/page.tsx`, `app/promos/page.tsx`, `app/simulate/page.tsx`, `app/reports/page.tsx`, `app/pricing/page.tsx`, `app/contact/page.tsx`.
- Contains: `"use client"` React 19 components, Tailwind v4 styles via tokens defined in `app/globals.css`.
- Depends on: `/api/*` endpoints via `fetch()`. No direct Prisma imports.
- Used by: Browser (Next.js router).

**HTTP/API (Route Handlers):**
- Purpose: REST-like endpoints over Prisma; the de-facto service layer.
- Location: `app/api/**/route.ts`.
- Pattern: `export async function GET/POST(...)` returning `NextResponse.json(...)`. Bodies validated with Zod (`z.object({...}).safeParse(body)`).
- Depends on: `lib/prisma.ts`, `lib/forecast/simulate-layers.ts`, `lib/shopify/client.ts`, `scripts/seed-from-beautysquare.ts`, `scripts/synth-sales-history.ts`.
- Used by: Client pages, external HTTP callers.

**Domain Logic (lib):**
- Purpose: Pure forecast math, calendar helpers, Shopify abstraction. Framework-agnostic where possible.
- Location: `lib/forecast/`, `lib/seed/`, `lib/shopify/`, `lib/prisma.ts`.
- Depends on: `@prisma/client` (only `lib/prisma.ts` and `lib/shopify/client.ts`).
- Used by: API routes, scripts.

**Persistence (Prisma):**
- Purpose: ORM + schema + migrations.
- Location: `prisma/schema.prisma`, `prisma/dev.db` (SQLite).
- Client singleton: `lib/prisma.ts` — uses `globalThis.prisma` to dodge hot-reload connection storms in dev.
- Used by: All API routes, all scripts. Pages do not touch Prisma directly.

**Scripts (CLI):**
- Purpose: One-shot ops — scrape catalog, generate synthetic sales, seed suppliers, backfill costs, batch-run forecasts.
- Location: `scripts/*.ts` — executed via `tsx` (see `package.json` `"seed"` script).
- Two scripts (`scripts/seed-from-beautysquare.ts`, `scripts/synth-sales-history.ts`) also export `seed()` / `synth()` functions imported by `app/api/seed/route.ts` for browser-triggered seeding. Same code, two entry points.

## Data Flow

### End-to-End: Empty DB → Forecasts on dashboard

This is the critical flow. README describes it as `/onboarding` but the actual surface is `/settings`.

**1. User opens `/settings`** (`app/settings/page.tsx`)
- Page mounts, `useEffect` calls `GET /api/shop` (`app/api/shop/route.ts`) which returns `prisma.tenant.findFirst()` — `null` on first run.
- Same effect fetches `GET /api/monthly-context` (`app/api/monthly-context/route.ts`) — also empty.

**2. User fills Shop name + domain, clicks "Save"**
- `POST /api/shop` with `{ name, shopifyDomain, shopifyAccessToken? }`.
- Handler validates with Zod, then `prisma.tenant.upsert` (find-first-then-update or create). Tenant row exists.

**3. (Optional) User clicks "Test connection"**
- `POST /api/shop/test` constructs `new ShopifyClient({ domain, accessToken })` and calls `testConnection()`. With no token: returns `{ ok: true, shopName: "${domain} (mock mode)", mock: true }`.

**4. User clicks "Seed catalog"**
- `POST /api/seed` (`app/api/seed/route.ts`, `maxDuration = 300`).
- Handler imports `seed` from `scripts/seed-from-beautysquare.ts` and `synth` from `scripts/synth-sales-history.ts`, then runs them sequentially:
  - `seed()` hits `https://beautysquareke.co/products.json?limit=250&page=N`, paginates, and upserts each variant as a `Product` row with random initial stock (20-100) and random cost (45-60% of retail).
  - `synth()` then generates 365 days of `SalesHistory` per product: assigns a base Poisson rate per product (long-tail distribution from `rankToBaseRate`), then loops day-by-day multiplying base rate by `dayOfWeekMultiplier()`, `paydayBoost()`, `holidayBoost()` (all from `lib/seed/kenya-calendar.ts`), and injects 5-8 random promo windows. Final pass overwrites `Product.currentStock` and `Product.dailySalesRate` to engineer a realistic mix of near-stockout, dead-stock, and comfortable products.
- Response: `{ ok: true, productsSeeded: N }`.

**5. User clicks "Generate forecasts"**
- `POST /api/forecast/run` (`app/api/forecast/run/route.ts`, `maxDuration = 120`).
- Handler steps:
  1. `prisma.tenant.findFirst()` + `prisma.product.findMany({ include: { supplier } })`.
  2. Pulls 365 days of `SalesHistory`, groups by `productId` in a JS `Map`.
  3. Computes 90-day revenue per product → `assignAbc()` does cumulative-revenue Pareto bucketing: top 70% revenue = A, next 20% = B, rest = C.
  4. Pulls active `Promo` rows (`startDate <= today+30d AND endDate >= today`).
  5. `prisma.prediction.deleteMany({ tenantId })` — wipes previous run.
  6. For each product, calls `simulateLayeredForecast(...)` from `lib/forecast/simulate-layers.ts`:
     - **Layer 1 (SARIMA mock)** — `seasonalNaive30(history)` blends last-30-day total (60%) with same-30-day-window-last-year (40%); if no LY data, falls back to `weightedDailyRate * 30`.
     - **Layer 2 (XGBoost mock)** — multiplies Layer 1 by `holidayBoost × paydayBoost × promoLift × noise(±5%)`. Captures explainable signals into a `Signal[]` array.
     - **Safety stock** — King's formula via `kingsSafetyStock({ z, leadTimeAvg, leadTimeStd, demandAvg, demandStd })`, with `z` from `zForServiceLevel(abc)` (A=2.33, B=1.65, C=1.28).
     - **Recommended qty** = `ceil(finalForecast30d + safetyStock - currentStock)`.
     - **Urgency** = `urgencyFromDays(currentStock / dailyRate)` (critical <7d, high <14d, medium <30d, low ≥30d).
  7. Writes a `Prediction` row (signals JSON-stringified) and updates `Product.abcCategory`.
  8. If `urgency` is `critical` or `high` and `recommendedQty > 0`, creates a `pending` `Order` row pointing at that prediction.
- Response: `{ ok: true, forecastsCreated: N }`.

**6. User navigates to `/dashboard`** (`app/dashboard/page.tsx`)
- `useEffect` calls `GET /api/forecast` (`app/api/forecast/route.ts`).
- Handler fan-outs `Promise.all([predictions, sales30, sales90, sales365])`, computes summary (revenue30, COGS, gross margin, dead-stock vs active-stock at cost AND retail), builds monthly revenue series, and returns the joined payload.
- Dashboard shows Reorder / Stockout / Dead / All tabs with search and drill-down via `Link` to `/dashboard/product/[id]`.

### Approve / skip pending orders
- Dashboard or detail page POSTs `/api/orders/[id]/approve` or `/api/orders/[id]/skip`.
- Approve sets `status: "approved"`, `approvedAt: now()`, fakes a `shopifyDraftOrderId` (real impl would call `ShopifyClient.createDraftOrder`).
- Skip sets `status: "skipped"` with an optional reason.

### Simulation flows
- `/simulate` page (`app/simulate/page.tsx`) hosts two tools:
  - **Budget allocation** — POST `/api/simulate/budget` with `{ budgetKes }`. Server scores all `recommendedQty > 0` predictions by urgency × margin × ROI, greedy-fills until budget exhausted, returns selected vs deferred lists.
  - **Demand shock** — POST `/api/simulate/demand-shock` with `{ upliftMultiplier, scope, scopeValue, daysAhead, eventName }`. Server re-projects forecasts in scope at the new multiplier without writing to DB; pure what-if.

## Key Abstractions

**`simulateLayeredForecast(input: ForecastInput): ForecastResult`** — `lib/forecast/simulate-layers.ts`
- The forecast contract. Pure function: takes `{ productId, productType, vendor, sku, currentStock, abcCategory, history[], leadTimeAvg, leadTimeStd, activePromos[] }`, returns the full `ForecastResult` (layer1Forecast30d, layer1Confidence, layer2Adjustment, finalForecast30d, daysUntilStockout, recommendedQty, safetyStock, reorderPoint, confidence, reasoning string, urgency enum, signals array).
- This is the single seam for the Python sidecar swap. Same JSON shape, replaceable implementation.
- Helpers in `lib/forecast/baseline.ts` (`weightedDailyRate`, `kingsSafetyStock`, `reorderPoint`, `standardDeviation`, `zForServiceLevel`, `urgencyFromDays`, `daysOfStockRemaining`) are the reusable primitives.

**`ShopifyClient`** — `lib/shopify/client.ts`
- Class-based interface with the methods a real Shopify integration would need: `testConnection`, `fetchProducts`, `fetchOrders`, `fetchInventory`, `createDraftOrder`.
- Currently every method queries Prisma instead of HTTP. Each method has a `// MOCK — real impl: <Shopify endpoint>` comment pinning the future replacement.
- Constructor takes `ShopifyConfig = { domain, accessToken? }`.

**Kenya calendar** — `lib/seed/kenya-calendar.ts`
- `kenyanHolidays(year)` returns dated holidays with per-category boost multipliers (Christmas: 2.5x ALL, 3.0x FRAGRANCE; Valentine's: 3.0x FRAGRANCE, 2.2x MAKEUP; Mother's/Father's Day computed by Nth-weekday-of-month).
- `isPaydayWeek(date)` — true for days 13-16 and 25-end (mid-month + end-of-month Kenya payday pattern).
- `paydayBoost(date)` → 1.6 in payday weeks, else 1.0.
- `dayOfWeekMultiplier(date)` — Fri 1.35, Sat 1.5, Sun 0.9, Mon 0.85.
- `holidayBoost(date, productType)` — fades multiplier linearly within ±3 days of holiday.
- Used by both the synthetic sales generator AND the forecast Layer-2 signals — so the "real" calendar pattern that's seeded in is the same pattern the forecast tries to detect.

**Multi-tenancy via `Tenant`**
- Every domain table (`Product`, `SalesHistory`, `Supplier`, `Promo`, `Prediction`, `Order`, `MonthlyContext`) has a `tenantId String` FK and a `@@index([tenantId])`.
- Cascade deletes from Tenant on every relation (`onDelete: Cascade`) — wiping a tenant wipes the entire dataset.
- BUT every route handler currently uses `prisma.tenant.findFirst()` — single-tenant in practice. Multi-tenant scaffolding is in place; auth + tenant resolution from request context is the missing piece.

**Prisma singleton** — `lib/prisma.ts`
- 7 lines. Stashes the client on `globalThis.prisma` in non-prod to survive Next.js hot reloads without leaking connections.

## Entry Points

**Root redirect** — `app/page.tsx`
- 5 lines. `redirect("/dashboard")`. There is no marketing landing page.

**Dashboard** — `app/dashboard/page.tsx`
- Primary working surface. Loads `/api/forecast` on mount. Reorder / Stockout / Dead Stock / All tabs. Search box, "Rerun forecast" button (POST `/api/forecast/run`), navigation header linking to Simulate / Reports / Promos / Suppliers / Pricing / Contact / Settings.
- If no predictions exist, prompts user to "Go to Settings" to seed.

**Product detail** — `app/dashboard/product/[id]/page.tsx`
- Dynamic route. Loads `GET /api/products/[id]` — returns product + 365d history (by day, by month) + latest prediction + latest order status.

**Settings (de-facto onboarding)** — `app/settings/page.tsx`
- Shop connect form (name, domain, optional access token). Test-connection button. **Seed catalog** button → `POST /api/seed`. **Generate forecasts** button → `POST /api/forecast/run`. Monthly business context form (marketing budget, promotions narrative, seasonal expectation, cash-flow note).

**Suppliers CRUD** — `app/suppliers/page.tsx` ↔ `app/api/suppliers/route.ts`
- List + edit modal. Fields: name, country, currency, leadTimeAvgDays, leadTimeStdDays, moq, notes. Supplier lead-time variability feeds King's safety stock formula in the forecast.

**Promos CRUD** — `app/promos/page.tsx` ↔ `app/api/promos/route.ts`
- Promo calendar. Fields: startDate, endDate, scope (`all|sku|category|brand`), scopeValue, discountPct, promoType (`payday|holiday|flash|gwp`), channel (`shopify|whatsapp|instagram|all`). Active promos at forecast-run time inject a lift into Layer 2.

**Simulate** — `app/simulate/page.tsx`
- Budget allocator + demand-shock what-if.

**Reports** — `app/reports/page.tsx` ↔ `app/api/reports/route.ts`
- Monthly trends, by-category, by-brand, by-supplier breakdowns, top/slow movers, ABC counts, lost-sales estimate.

**Pricing / Contact** — `app/pricing/page.tsx`, `app/contact/page.tsx`
- Static-content marketing pages.

**Scripts (CLI entry points):**
- `npm run seed` → runs `tsx scripts/seed-from-beautysquare.ts && tsx scripts/synth-sales-history.ts` (per `package.json`).
- `tsx scripts/seed-suppliers.ts` — seeds 6 hard-coded suppliers (Guangzhou/Dubai/Nairobi/Eastleigh/EU/Mombasa) and auto-assigns products by vendor/type matching.
- `tsx scripts/backfill-costs.ts` — recomputes `Product.costKes` from supplier-origin-aware margin ranges.
- `tsx scripts/run-forecasts.ts` — same forecast pipeline as `/api/forecast/run` but as CLI.

## Error Handling

**Strategy:** Defensive at API boundary, optimistic elsewhere.

**Patterns:**
- Route handlers wrap risky ops in `try/catch` and return `NextResponse.json({ error: msg }, { status: 4xx/500 })`. See `app/api/seed/route.ts`.
- Zod validation: `schema.safeParse(body)` then early-return `{ error: "Invalid input", details: parsed.error.flatten() }` on failure. Used in `app/api/shop/route.ts`, `app/api/suppliers/route.ts`, `app/api/promos/route.ts`, `app/api/monthly-context/route.ts`, `app/api/simulate/*`.
- Tenant guard: every mutating handler does `const tenant = await prisma.tenant.findFirst(); if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 })`.
- Client pages use plain `alert(err.error || "...failed")` on POST failures — no toast system.

## Cross-Cutting Concerns

**Logging:** `console.log` only, in scripts. No logger in API routes.

**Validation:** Zod (`zod ^3.24.1`) for all POST bodies in API routes. Frontend forms have minimal validation — relies on backend rejection.

**Authentication:** None. No auth provider, no session, no middleware. Single-tenant assumption is "whatever `findFirst()` returns".

**Currency:** All money stored as `Float` in KES on `Product.priceKes`, `Product.costKes`, `SalesHistory.revenueKes`. Suppliers store their native `currency` (USD/AED/EUR/KES) but conversion is not implemented.

**Time:** All date math uses UTC (`setUTCHours(0,0,0,0)`, `toISOString().slice(0,10)`). No timezone handling for Kenya local time.

**Tailwind v4 tokens:** Single source of truth in `app/globals.css` (`@theme` block). Colors: `canvas`, `canvas-raised`, `canvas-tint`, `ink`/`ink-soft`/`ink-deep`, `mute`, `line`, `accent-50..800` (purple), `status-ok/warn/bad/crit`. Fonts: Inter (sans) + JetBrains Mono via `next/font/google` in `app/layout.tsx`.

---

*Architecture analysis: 2026-05-28*
