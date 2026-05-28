# Codebase Structure

**Analysis Date:** 2026-05-28

## Directory Layout

```
stock-estimator/
├── app/                                  # Next.js App Router root — pages + API routes
│   ├── layout.tsx                        # Root server layout: fonts, footer, body shell
│   ├── page.tsx                          # `/` — redirects to `/dashboard`
│   ├── globals.css                       # Tailwind v4 imports + `@theme` design tokens
│   ├── favicon.ico                       # Browser tab icon
│   ├── icon.svg                          # PWA-style icon source
│   ├── dashboard/
│   │   ├── page.tsx                      # Main dashboard (client): Reorder/Stockout/Dead/All tabs
│   │   └── product/[id]/page.tsx         # Product drill-down with 365d history chart
│   ├── settings/
│   │   └── page.tsx                      # DE-FACTO ONBOARDING: shop connect + seed + forecast buttons
│   ├── suppliers/
│   │   └── page.tsx                      # Supplier list + create/edit modal
│   ├── promos/
│   │   └── page.tsx                      # Promo calendar list + create/edit modal
│   ├── simulate/
│   │   └── page.tsx                      # Budget allocator + demand-shock what-if
│   ├── reports/
│   │   └── page.tsx                      # Monthly trends, category/brand/supplier breakdowns
│   ├── pricing/
│   │   └── page.tsx                      # Static marketing: pricing tiers
│   ├── contact/
│   │   └── page.tsx                      # Static marketing: contact info
│   └── api/                              # All HTTP endpoints (route.ts handlers)
│       ├── shop/
│       │   ├── route.ts                  # GET/POST tenant (shop) record
│       │   └── test/route.ts             # POST test Shopify connection (mock-aware)
│       ├── seed/
│       │   └── route.ts                  # POST: runs seed() + synth() — populates catalog + 365d sales
│       ├── forecast/
│       │   ├── route.ts                  # GET: dashboard payload (predictions + summary + monthly revenue)
│       │   └── run/route.ts              # POST: re-runs simulateLayeredForecast over all products
│       ├── products/
│       │   ├── route.ts                  # GET list (filter by vendor/productType)
│       │   └── [id]/route.ts             # GET detail + history + prediction + order; PATCH supplier
│       ├── suppliers/
│       │   └── route.ts                  # GET list / POST upsert
│       ├── promos/
│       │   └── route.ts                  # GET list / POST upsert
│       ├── orders/
│       │   └── [id]/
│       │       ├── approve/route.ts      # POST: mark order approved (mock draft order id)
│       │       └── skip/route.ts         # POST: mark order skipped with reason
│       ├── monthly-context/
│       │   └── route.ts                  # GET list / POST upsert monthly business context
│       ├── catalog/
│       │   └── facets/route.ts           # GET distinct categories + brands with counts
│       ├── reports/
│       │   └── route.ts                  # GET aggregated reports payload
│       └── simulate/
│           ├── budget/route.ts           # POST: budget-constrained reorder selection
│           └── demand-shock/route.ts     # POST: what-if uplift on scope (no DB writes)
├── lib/                                  # Framework-agnostic logic (no UI)
│   ├── prisma.ts                         # PrismaClient singleton (globalThis-cached in dev)
│   ├── forecast/
│   │   ├── baseline.ts                   # Pure primitives: weightedDailyRate, kingsSafetyStock, zForServiceLevel, urgencyFromDays
│   │   └── simulate-layers.ts            # **THE FORECAST CONTRACT**: simulateLayeredForecast()
│   ├── shopify/
│   │   └── client.ts                     # ShopifyClient class — mock methods, real impl noted per method
│   └── seed/
│       └── kenya-calendar.ts             # Kenyan holidays, payday weeks, day-of-week multipliers
├── scripts/                              # tsx-executed CLI scripts (also imported by API routes)
│   ├── seed-from-beautysquare.ts         # Scrapes beautysquareke.co/products.json — seeds Product rows
│   ├── synth-sales-history.ts            # Generates 365d Poisson sales with Kenya patterns
│   ├── seed-suppliers.ts                 # Seeds 6 hard-coded suppliers + auto-assigns to products
│   ├── backfill-costs.ts                 # Recomputes Product.costKes from supplier-origin margins
│   └── run-forecasts.ts                  # CLI version of /api/forecast/run
├── prisma/
│   ├── schema.prisma                     # 8 models: Tenant, Product, SalesHistory, Supplier, Promo, MonthlyContext, Prediction, Order
│   └── dev.db                            # SQLite database (committed for Vercel demo only)
├── public/                               # Next.js static assets (default Vercel SVGs)
│   ├── file.svg
│   ├── globe.svg
│   ├── next.svg
│   ├── vercel.svg
│   └── window.svg
├── .planning/                            # GSD planning + codebase-map docs
│   └── codebase/                         # This directory
├── package.json                          # Deps + scripts (dev/build/start/db:push/seed)
├── package-lock.json                     # npm lockfile
├── tsconfig.json                         # TS config — path alias `@/*` → repo root
├── next.config.ts                        # Next.js config
├── postcss.config.mjs                    # PostCSS / Tailwind v4 plugin wiring
├── eslint.config.mjs                     # Next + ESLint v9 flat config
└── README.md                             # Stack, local-dev steps, Vercel/Postgres deploy notes
```

## Directory Purposes

**`app/`** (Next.js App Router)
- Purpose: All routable code — pages + API endpoints.
- Contains: `page.tsx` (UI routes), `route.ts` (API handlers), `layout.tsx` (shared chrome), `globals.css`.
- Key files: `app/layout.tsx` (root layout), `app/page.tsx` (root redirect), `app/dashboard/page.tsx` (primary surface), `app/settings/page.tsx` (onboarding flow), `app/api/forecast/run/route.ts` (forecast engine HTTP entry).

**`app/api/`** (route handlers)
- Purpose: The de-facto service layer. Every page calls these via `fetch`.
- Pattern: One folder per resource, `route.ts` exports `GET`/`POST`/`PATCH`. Dynamic params use `[id]/route.ts` with `{ params: Promise<{ id: string }> }`.
- Key files: `app/api/forecast/run/route.ts` (forecast pipeline), `app/api/seed/route.ts` (catalog + sales seed), `app/api/shop/route.ts` (tenant CRUD).

**`lib/`**
- Purpose: Reusable logic that should NOT live in route handlers.
- Contains: Prisma singleton, forecast math, Shopify abstraction, calendar helpers.
- Key files: `lib/forecast/simulate-layers.ts` (THE forecast contract — pure function, the swap-to-Python seam), `lib/prisma.ts` (always import from here, never `new PrismaClient()` in routes).

**`lib/forecast/`**
- Purpose: Demand forecasting + safety-stock math.
- Files: `baseline.ts` (pure stats primitives), `simulate-layers.ts` (Layer 1 SARIMA-mock + Layer 2 XGBoost-mock + King's safety stock).
- **This is where forecasts are computed.** If you're changing the forecast model, this is the only directory you touch in app code (plus the Prediction write in `app/api/forecast/run/route.ts`).

**`lib/shopify/`**
- Purpose: Shopify integration surface.
- File: `client.ts` — `ShopifyClient` class with mock methods. Each method has `// MOCK — real impl:` comment pointing at the real Shopify Admin API endpoint to call.

**`lib/seed/`**
- Purpose: Kenya-specific demand calendar primitives.
- File: `kenya-calendar.ts` — holidays, payday detection, day-of-week multipliers. Used by BOTH the synthetic sales generator AND the forecast Layer-2 lookahead.

**`scripts/`**
- Purpose: One-shot CLI ops. Run via `tsx scripts/<name>.ts`. Two of them (`seed-from-beautysquare.ts`, `synth-sales-history.ts`) export functions that the API also imports.
- **This is where products are seeded** (`seed-from-beautysquare.ts` — scrapes beautysquareke.co).
- **This is where synthetic sales are generated** (`synth-sales-history.ts` — 365d Poisson with Kenya patterns).
- **This is where suppliers are seeded** (`seed-suppliers.ts` — 6 hard-coded suppliers with vendor/type matching rules).

**`prisma/`**
- Purpose: ORM schema + local SQLite DB.
- Key file: `prisma/schema.prisma` — 8 models. `prisma/dev.db` is committed so Vercel can serve read-only demos; production needs Postgres per `README.md`.

**`public/`**
- Purpose: Next.js static assets. Currently only default Next.js example SVGs; no project-specific assets yet.
- Generated: No. Committed: Yes.

**`.planning/codebase/`**
- Purpose: GSD codebase-map docs (this directory). Consumed by `/gsd:plan-phase` and `/gsd:execute-phase`.
- Generated: Yes (by `/gsd:map-codebase`). Committed: Yes.

## Key File Locations

**Entry Points:**
- `app/page.tsx` — root, redirects to dashboard.
- `app/layout.tsx` — root layout, font loading, footer.
- `app/dashboard/page.tsx` — main working surface.
- `app/settings/page.tsx` — onboarding (shop connect → seed → forecast).

**Configuration:**
- `package.json` — scripts (`dev`, `build`, `db:push`, `db:studio`, `seed`) + dependencies (Next 16, React 19, Prisma 6, Zod 3, Tailwind 4).
- `tsconfig.json` — strict TS, `@/*` path alias to repo root, excludes `app inspo`, `app/(app)`, `app/login`, `app/showroom` (legacy/unused dirs).
- `next.config.ts` — Next.js config.
- `postcss.config.mjs` — Tailwind v4 PostCSS plugin.
- `eslint.config.mjs` — ESLint flat config extending `eslint-config-next`.
- `prisma/schema.prisma` — datasource (`provider = "sqlite"`, `url = "file:./dev.db"`), 8 models.
- `app/globals.css` — Tailwind v4 `@theme` design tokens (canvas/ink/accent/status colors, fonts, shadows).

**Forecast Computation:**
- `lib/forecast/simulate-layers.ts` — `simulateLayeredForecast()` is THE function. Pure, framework-free, returns `ForecastResult`.
- `lib/forecast/baseline.ts` — math primitives (`kingsSafetyStock`, `weightedDailyRate`, `zForServiceLevel`, etc).
- `app/api/forecast/run/route.ts` — HTTP entry that calls `simulateLayeredForecast` per product and writes `Prediction` + optional `Order` rows.
- `scripts/run-forecasts.ts` — CLI equivalent (same pipeline).

**Product Seeding:**
- `scripts/seed-from-beautysquare.ts` — exports `seed()`. Scrapes `https://beautysquareke.co/products.json`, paginates, upserts `Product` rows.
- `scripts/synth-sales-history.ts` — exports `synth()`. Generates 365d Poisson sales using `lib/seed/kenya-calendar.ts` multipliers, then tunes `Product.currentStock` to engineer a realistic stockout/dead-stock mix.
- `app/api/seed/route.ts` — HTTP wrapper that calls both.

**Supplier CRUD:**
- `app/suppliers/page.tsx` — UI (list + edit modal).
- `app/api/suppliers/route.ts` — GET list / POST upsert, Zod-validated.
- `scripts/seed-suppliers.ts` — bulk seed 6 hard-coded suppliers + auto-assign products by vendor/type matching.
- `scripts/backfill-costs.ts` — recompute `Product.costKes` based on supplier origin margin ranges.

**Promos:**
- `app/promos/page.tsx` — UI (list + edit modal).
- `app/api/promos/route.ts` — GET list / POST upsert. Scope: `all|sku|category|brand`. Type: `payday|holiday|flash|gwp`. Channel: `shopify|whatsapp|instagram|all`.
- Active promos are pulled at forecast-run time in `app/api/forecast/run/route.ts` and shaped into `ActivePromo[]` for `simulateLayeredForecast`.

**Orders (reorder workflow):**
- `app/api/orders/[id]/approve/route.ts` — mark approved, mint mock draft-order id.
- `app/api/orders/[id]/skip/route.ts` — mark skipped with reason.
- Orders are auto-created during forecast runs when `urgency ∈ {critical, high}` and `recommendedQty > 0`.

**Monthly Context:**
- `app/api/monthly-context/route.ts` — GET/POST. Stores per-month `marketingBudget`, `promotions`, `seasonalExpectation`, `cashFlow`, `notes`. UI lives in `app/settings/page.tsx`. Not yet wired into forecast inputs.

**Simulation:**
- `app/simulate/page.tsx` — UI for both tools.
- `app/api/simulate/budget/route.ts` — greedy selection by urgency × margin × ROI under KES budget cap.
- `app/api/simulate/demand-shock/route.ts` — re-projects forecasts at a multiplier in-memory; never writes to DB.

**Reports:**
- `app/reports/page.tsx` — UI.
- `app/api/reports/route.ts` — 188 LOC aggregator: monthly trends, by-category/brand/supplier, top/slow movers, ABC counts, lost-sales estimate.

**Prisma:**
- `lib/prisma.ts` — singleton. **Always import `prisma` from here**, never construct `new PrismaClient()` in app code (scripts are exempt; they manage their own lifecycle and call `prisma.$disconnect()`).

## Naming Conventions

**Files:**
- Pages: `page.tsx` (App Router convention).
- API handlers: `route.ts` (App Router convention).
- Dynamic segments: `[id]/route.ts`, `[id]/page.tsx`.
- Lib modules: kebab-case (`simulate-layers.ts`, `kenya-calendar.ts`).
- Scripts: kebab-case (`seed-from-beautysquare.ts`, `synth-sales-history.ts`, `run-forecasts.ts`).

**Directories:**
- Lowercase, single-word where possible (`forecast`, `shopify`, `seed`, `suppliers`, `promos`).
- Hyphenated for multi-word (`monthly-context`, `demand-shock`).
- API resources singular when a CRUD entity (`shop`), plural for collections (`suppliers`, `promos`, `products`, `orders`).

**TypeScript identifiers:**
- Functions: `camelCase` (`simulateLayeredForecast`, `weightedDailyRate`, `kingsSafetyStock`).
- Types: `PascalCase` (`ForecastInput`, `ForecastResult`, `Signal`, `ShopifyClient`, `ActivePromo`).
- Constants at module top: `UPPER_SNAKE_CASE` (`SOURCE`, `TENANT_NAME`, `SHOPIFY_DOMAIN`, `COST_FACTOR_BY_SUPPLIER`, `URGENCY_WEIGHT`).
- React components: `PascalCase` default exports (`Dashboard`, `SettingsPage`, `SuppliersPage`, `PromosPage`).

**Database (Prisma):**
- Models: `PascalCase` singular (`Tenant`, `Product`, `SalesHistory`, `Supplier`, `Promo`, `MonthlyContext`, `Prediction`, `Order`).
- Fields: `camelCase` (`shopifyDomain`, `leadTimeAvgDays`, `priceKes`).
- Money fields suffixed with currency: `priceKes`, `costKes`, `revenueKes`, `marketingBudget`.
- Time fields: `createdAt`, `lastSynced`, `runDate`, `startDate`, `endDate`, `approvedAt`.

**Imports:**
- Path alias `@/*` resolves to repo root (configured in `tsconfig.json`). Use it: `import { prisma } from "@/lib/prisma"`, `import { simulateLayeredForecast } from "@/lib/forecast/simulate-layers"`. Avoid `../../../`.

## Where to Add New Code

**New API endpoint:**
- Create `app/api/<resource>/route.ts` (or `app/api/<resource>/[id]/route.ts` for dynamic).
- Pattern: import `NextRequest/NextResponse` from `"next/server"`, `prisma` from `@/lib/prisma`, `z` from `"zod"`. Define Zod schema. Guard with `prisma.tenant.findFirst()`. Return `NextResponse.json(...)`.
- Reference: `app/api/suppliers/route.ts` (38 lines, canonical example).

**New page:**
- Create `app/<route>/page.tsx`. If interactive, start with `"use client"`. Fetch via `fetch("/api/...")` in `useEffect`. Tailwind classes via the design tokens from `app/globals.css` (`bg-canvas`, `text-ink`, `border-line`, `text-accent-600`, etc).
- Add a nav link in `app/dashboard/page.tsx` header.

**New Prisma model or field:**
- Edit `prisma/schema.prisma`. Add `tenantId` + `@@index([tenantId])` + `Tenant @relation(... onDelete: Cascade)` for tenancy.
- Run `npx prisma db push` (dev) — no migration files in this repo.
- `npx prisma generate` runs automatically on `postinstall` and `build`.

**New forecast signal:**
- Add a computation helper to `lib/forecast/simulate-layers.ts` (e.g., next to `lookaheadHolidayBoost`, `lookaheadPaydays`).
- Push a `Signal` into the `signals: Signal[]` array inside `simulateLayeredForecast`.
- Multiply the lift into `totalMult` so it flows into `layer2Final`.
- If the signal depends on a new DB field, also update the input fetch in `app/api/forecast/run/route.ts` AND `scripts/run-forecasts.ts` (both pipelines must stay in sync).

**New CLI script:**
- Add `scripts/<name>.ts`. Pattern: `import { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient();` then `main().catch(...).finally(() => prisma.$disconnect())`. Run with `tsx scripts/<name>.ts`.

**New Shopify integration method:**
- Add to `ShopifyClient` in `lib/shopify/client.ts`. Mirror the existing pattern: type the return shape, write the mock (Prisma-backed), add `// MOCK — real impl: <Shopify endpoint>` comment.

**New shared utility:**
- If pure logic → `lib/<domain>/<name>.ts`.
- If forecast-specific → `lib/forecast/baseline.ts` (existing) or a new sibling file under `lib/forecast/`.
- Never add utilities under `app/` — keep `app/` for routes and pages only.

## Special Directories

**`prisma/`**
- Contains: `schema.prisma` (source of truth for DB), `dev.db` (SQLite file).
- Generated: `dev.db` is generated by `prisma db push` but committed to git for Vercel demo deploys.
- Committed: Yes (both files). Production deploys must override `DATABASE_URL` to Postgres and re-run `prisma db push`.

**`.planning/`**
- Contains: GSD planning artifacts and `codebase/` map docs.
- Generated: Yes (by GSD commands).
- Committed: Yes.

**`public/`**
- Contains: Currently only default Next.js sample SVGs. No project assets yet — product images come from Shopify CDN via `Product.imageUrl`.
- Generated: No. Committed: Yes.

**Excluded from TS compilation** (per `tsconfig.json`):
- `app inspo/`, `app/(app)/`, `app/login/`, `app/showroom/` — none exist in the current tree but reserved as escape hatches for scratch work.

---

*Structure analysis: 2026-05-28*
