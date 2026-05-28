<!-- GSD:project-start source:PROJECT.md -->
## Project

**Wezesha Restock OS**

A multi-tenant stock-replenishment intelligence platform for Kenyan beauty retailers on Shopify. It forecasts demand, recommends reorder quantities, and emails ready-to-send Purchase Orders to suppliers — accounting for payday weeks, public holidays, promos, and supplier lead times from places like Guangzhou or Dubai. SimplyDone Africa is the vendor; Beauty Square (beautysquareke.co), a Shopify + QuickBooks beauty retailer in Nairobi, is the first paying customer. A working single-tenant demo lives in this repo; the engagement converts it into a multi-tenant SaaS production system.

**Core Value:** **Tell a shop owner exactly what to reorder this week, generate the PO, and email it to the right supplier — with enough confidence that they trust the number.** Forecast quality + reorder correctness + the supplier handoff are the trio that earns the seat. If the predictions are wrong, the on-order math double-counts, or the PO bounces in the supplier's inbox, the product fails no matter how polished the UI looks.

### Constraints

- **Timeline**: Anjay said "today/tomorrow" for kickoff (2026-05-28 call). Phase 1 is intentionally minimal so we move fast. — Client expectation.
- **Tech stack**: Next.js 16 + Prisma 6 + TypeScript for the app; Python FastAPI + statsmodels + xgboost + scikit-learn for the forecast sidecar (separate service). — Existing repo + SOW.
- **Auth**: Supabase (email + magic link, optional Google OAuth). — SOW mandate.
- **Hosting**: Vercel for Next.js, Postgres (Vercel/Neon/Supabase) for DB, Railway for Python sidecar, Supabase for auth. — Roy's standard stack + SOW.
- **Email**: Resend for supplier PO delivery. — SOW mandate.
- **Multi-tenant from day one**: Every new feature must respect tenant isolation. — Anjay's standing rule + SOW.
- **Forecast contract**: `simulateLayeredForecast()` JSON shape is the API boundary. Python service must match it exactly so the swap is a one-file change. — Repo design intent.
- **Source of truth conflict**: For Beauty Square, QB beats Shopify for inventory/sales/cost. Designs assuming Shopify-canonical will break. — Per call.
- **Currency**: KES is the base; per-supplier currency (USD, CNY, AED) with FX-at-creation captured on the PO. — SOW.
- **Observability**: Sentry on web + sidecar, tenant tag on every event. — SOW.
- **Dependency**: Anjay is fetching Shopify and QuickBooks sandbox/test credentials. Real-data phases can't start without them. — Call.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript ^5 — All app code (`app/`, `lib/`, `scripts/`). `strict: true` enabled in `tsconfig.json`.
- Not applicable — single-language repo. No Python sidecar yet (README notes it as next milestone).
## Runtime
- Node.js (version not pinned via `.nvmrc` or `engines`). Required by Next.js 16 / React 19 (typically Node 20+).
- npm
- Lockfile: `package-lock.json` present at repo root.
## Frameworks
- Next.js ^16.2.6 — App Router (`app/` directory). API routes under `app/api/`. Configured in `next.config.ts`.
- React ^19.0.0 + React DOM ^19.0.0 — UI framework.
- Not detected — no Jest, Vitest, Playwright, or test files found in repo.
- Prisma ^6.1.0 (devDependencies) + `@prisma/client` ^6.1.0 (dependencies) — ORM. Schema at `prisma/schema.prisma`.
- tsx ^4.19.2 — Used to run TypeScript scripts directly (seed/synth/run-forecasts scripts).
- Tailwind CSS ^4.0.0 with `@tailwindcss/postcss` ^4.0.0 — Styling. PostCSS pipeline configured in `postcss.config.mjs`.
- PostCSS ^8 — CSS toolchain.
- ESLint ^9 + `eslint-config-next` ^16.2.6 + `@eslint/eslintrc` ^3 — Lint. Flat config in `eslint.config.mjs`.
## Key Dependencies
- `@prisma/client` ^6.1.0 — Database ORM client. Singleton instantiated in `lib/prisma.ts`.
- `next` ^16.2.6 — Server, routing, build.
- `react` / `react-dom` ^19.0.0 — UI.
- `zod` ^3.24.1 — Runtime input validation. Used in API routes (e.g. `app/api/shop/route.ts`, `app/api/shop/test/route.ts`) to validate request bodies.
- `prisma` ^6.1.0 — CLI for migrations / generate / studio.
- `tsx` ^4.19.2 — TS execution for `scripts/`.
## Configuration
- `DATABASE_URL` — Referenced in `README.md` as the env var to set when switching to Postgres on Vercel. Not currently read in code (Prisma schema hardcodes `url = "file:./dev.db"` for SQLite dev).
- `NODE_ENV` — Used in `lib/prisma.ts` to attach the Prisma client to `globalThis` outside production (prevents hot-reload connection leaks).
- No `.env` file detected in repo root.
- `next.config.ts` — Includes `prisma/dev.db` in serverless function output via `outputFileTracingIncludes` (read-only demo data bundle for Vercel). Whitelists `**.shopify.com` and `cdn.shopify.com` for `next/image` remote patterns.
- `tsconfig.json` — `target: ES2017`, `moduleResolution: bundler`, `jsx: preserve`, path alias `@/*` → `./*`. Excludes `app inspo`, `app/(app)`, `app/login`, `app/showroom` (legacy/scratch directories).
- `postcss.config.mjs` — Single `@tailwindcss/postcss` plugin.
- `eslint.config.mjs` — Composes `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript` flat configs; explicitly re-applies default ignores (`.next/**`, `out/**`, `build/**`, `next-env.d.ts`).
## Prisma Schema Overview
- `Tenant` — Single-shop record holding `name`, `shopifyDomain`, optional `shopifyAccessToken`, `currency` (default `KES`). Parent of all other tenant-scoped tables.
- `Product` — Catalog row with Shopify IDs, `sku`, `title`, `vendor`, `productType`, `priceKes`, `costKes`, `imageUrl`, `currentStock`, `abcCategory`, `dailySalesRate`, optional `supplierId`. Unique `(tenantId, shopifyProductId)`.
- `SalesHistory` — Daily per-product sales rows: `date`, `quantity`, `revenueKes`, `channel` (default `shopify`). Unique `(productId, date, channel)`.
- `Supplier` — `name`, `country`, `currency`, `leadTimeAvgDays`, `leadTimeStdDays`, `moq`, `notes`.
- `Promo` — `startDate`, `endDate`, `scope` (`all|sku|category|brand`), `scopeValue`, `discountPct`, `promoType` (`flash` default), `channel`.
- `MonthlyContext` — `month`, `marketingBudget`, `promotions`, `seasonalExpectation`, `cashFlow`, `notes`. Unique `(tenantId, month)`.
- `Prediction` — Forecast snapshot per `productId` + `runDate`: `layer1Forecast30d`, `layer1Confidence`, `layer2Adjustment`, `finalForecast30d`, `daysUntilStockout`, `recommendedQty`, `safetyStock`, `reorderPoint`, `confidence`, `reasoning` (string), `urgency`, `signals` (JSON-encoded string).
- `Order` — Reorder proposal tied to a `Prediction`: `status` (default `pending`), optional `shopifyDraftOrderId`, `approvedAt`, `skipReason`.
## Platform Requirements
- Node.js (Next 16 / React 19 compatible — Node 20+ recommended).
- npm install, then `npx prisma db push` to create local SQLite file at `prisma/dev.db`.
- `npm run dev` to start Next.js dev server.
- Vercel (referenced in `README.md`). The bundled `prisma/dev.db` is included via `outputFileTracingIncludes` but is read-only at runtime; any seed/forecast/promo write requires switching `prisma/schema.prisma` to `postgresql` and setting `DATABASE_URL` (e.g., Vercel Postgres or Neon).
## Scripts
- `postinstall` runs `prisma generate` automatically after `npm install`.
- `scripts/seed-from-beautysquare.ts` — Scrape products from `beautysquareke.co/products.json`.
- `scripts/synth-sales-history.ts` — Generate 365 days of Kenya-calibrated synthetic sales (Poisson).
- `scripts/seed-suppliers.ts` — Seed 6 suppliers and assign products via vendor/type matching.
- `scripts/backfill-costs.ts` — Recalculate `costKes` per supplier-specific margin band.
- `scripts/run-forecasts.ts` — Compute ABC class + run layered forecast for every product; create pending `Order` rows for critical/high urgency.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## TypeScript Style
- `app/dashboard/page.tsx:7` — `type Signal = { label: string; deltaPct: number; emoji: string };`
- `lib/forecast/simulate-layers.ts:13` — `export type ActivePromo = { ... }`
- `lib/shopify/client.ts:3` — `export type ShopifyConfig = { ... }`
- `app/layout.tsx:1` — `import type { Metadata } from "next";`
- `next.config.ts:1` — `import type { NextConfig } from "next";`
- Inline form preferred when mixed: `import { simulateLayeredForecast, type ActivePromo } from "@/lib/forecast/simulate-layers"` (`app/api/forecast/run/route.ts:3`).
## Naming Patterns
- App routes / pages: lowercase, kebab-case for multi-word segments (`monthly-context/`, `demand-shock/`, `[id]/approve/`). Single-word folders stay lowercase (`forecast`, `promos`, `simulate`).
- React page files: always `page.tsx` (Next.js convention).
- API route files: always `route.ts`.
- Library modules: kebab-case (`simulate-layers.ts`, `kenya-calendar.ts`).
- Scripts: kebab-case verb-first (`seed-from-beautysquare.ts`, `synth-sales-history.ts`, `backfill-costs.ts`, `run-forecasts.ts`).
## React Patterns
- `app/dashboard/page.tsx:1`
- `app/promos/page.tsx`
- `app/reports/page.tsx`
- `app/settings/page.tsx`
- `app/simulate/page.tsx`
- `app/suppliers/page.tsx`
- `app/contact/page.tsx`
- `app/dashboard/product/[id]/page.tsx`
## API Route Conventions
- `GET`: no params or `(req: NextRequest)` if reading query string.
- `POST` / `PATCH` / dynamic: `(req: NextRequest, { params }: { params: Promise<{ id: string }> })`. **Note `params` is a Promise** in Next 16 — always `await params` first (`app/api/orders/[id]/approve/route.ts:5`, `app/api/products/[id]/route.ts:5`). Use `_req` when the request object is unused (`app/api/orders/[id]/approve/route.ts:4`).
## Zod Validation
- Most routes return only `{ error: "Invalid input" }` (`app/api/shop/route.ts:27`, `app/api/simulate/budget/route.ts:19`, `app/api/shop/test/route.ts:14`).
- `app/api/promos/route.ts:33` returns `{ error: "Invalid input", details: parsed.error.flatten() }`.
- **Convention: include `details: parsed.error.flatten()` going forward** so the UI can surface field-level messages. Add to existing routes opportunistically.
## Error Handling in API Routes
## Logging
## Prisma Patterns
## Code Style / Formatting
## Comments
- `// MOCK — real impl: GET /admin/api/2024-10/products.json?limit=250` (`lib/shopify/client.ts:48`) — flags that the function is a stub.
- `// Composite: urgency dominates, ROI breaks ties.` (`app/api/simulate/budget/route.ts:37`) — explains a scoring choice.
- `// Pass 1: always include critical` (`app/api/simulate/budget/route.ts:65`) — labels an algorithm step.
- `// Switch to Postgres in production and remove this.` (`next.config.ts:6`) — flags tech debt inline.
## Module Design
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- **Server-first Next.js App Router** with file-based routing under `app/`. Root layout (`app/layout.tsx`) is a server component that loads fonts and a shared footer; every interactive page (`app/dashboard/page.tsx`, `app/suppliers/page.tsx`, etc.) is a client component that hydrates and calls `/api/*` via `fetch`.
- **Thin API layer over Prisma** — every route handler in `app/api/` follows the same shape: resolve `tenant = prisma.tenant.findFirst()`, validate body with Zod, run Prisma queries, return `NextResponse.json(...)`. No service classes; the routes ARE the service layer.
- **Forecast engine is a pure TypeScript module** living at `lib/forecast/simulate-layers.ts`. It's deliberately framework-agnostic: no Prisma, no Next, no I/O. The same function is called both from `app/api/forecast/run/route.ts` (HTTP path) and `scripts/run-forecasts.ts` (CLI path). This is the "swap-to-Python-sidecar" seam called out in `README.md`.
- **Mock-first integrations** — `lib/shopify/client.ts` exposes a real-looking class (`testConnection`, `fetchProducts`, `fetchOrders`, `fetchInventory`, `createDraftOrder`) but every method currently reads from Prisma instead of HTTP. Each method has a `// MOCK — real impl:` comment naming the actual Shopify endpoint to swap in.
- **No onboarding route exists.** Despite the README mentioning `/onboarding`, there is no `app/onboarding/` directory. The Shopify connect + seed + forecast UX lives on `app/settings/page.tsx` — single-screen flow with three buttons that POST to `/api/shop`, `/api/seed`, `/api/forecast/run` in sequence.
## Layers
- Purpose: All interactive UI; tab state, search, modals, button-driven actions.
- Location: `app/dashboard/page.tsx`, `app/dashboard/product/[id]/page.tsx`, `app/settings/page.tsx`, `app/suppliers/page.tsx`, `app/promos/page.tsx`, `app/simulate/page.tsx`, `app/reports/page.tsx`, `app/pricing/page.tsx`, `app/contact/page.tsx`.
- Contains: `"use client"` React 19 components, Tailwind v4 styles via tokens defined in `app/globals.css`.
- Depends on: `/api/*` endpoints via `fetch()`. No direct Prisma imports.
- Used by: Browser (Next.js router).
- Purpose: REST-like endpoints over Prisma; the de-facto service layer.
- Location: `app/api/**/route.ts`.
- Pattern: `export async function GET/POST(...)` returning `NextResponse.json(...)`. Bodies validated with Zod (`z.object({...}).safeParse(body)`).
- Depends on: `lib/prisma.ts`, `lib/forecast/simulate-layers.ts`, `lib/shopify/client.ts`, `scripts/seed-from-beautysquare.ts`, `scripts/synth-sales-history.ts`.
- Used by: Client pages, external HTTP callers.
- Purpose: Pure forecast math, calendar helpers, Shopify abstraction. Framework-agnostic where possible.
- Location: `lib/forecast/`, `lib/seed/`, `lib/shopify/`, `lib/prisma.ts`.
- Depends on: `@prisma/client` (only `lib/prisma.ts` and `lib/shopify/client.ts`).
- Used by: API routes, scripts.
- Purpose: ORM + schema + migrations.
- Location: `prisma/schema.prisma`, `prisma/dev.db` (SQLite).
- Client singleton: `lib/prisma.ts` — uses `globalThis.prisma` to dodge hot-reload connection storms in dev.
- Used by: All API routes, all scripts. Pages do not touch Prisma directly.
- Purpose: One-shot ops — scrape catalog, generate synthetic sales, seed suppliers, backfill costs, batch-run forecasts.
- Location: `scripts/*.ts` — executed via `tsx` (see `package.json` `"seed"` script).
- Two scripts (`scripts/seed-from-beautysquare.ts`, `scripts/synth-sales-history.ts`) also export `seed()` / `synth()` functions imported by `app/api/seed/route.ts` for browser-triggered seeding. Same code, two entry points.
## Data Flow
### End-to-End: Empty DB → Forecasts on dashboard
- Page mounts, `useEffect` calls `GET /api/shop` (`app/api/shop/route.ts`) which returns `prisma.tenant.findFirst()` — `null` on first run.
- Same effect fetches `GET /api/monthly-context` (`app/api/monthly-context/route.ts`) — also empty.
- `POST /api/shop` with `{ name, shopifyDomain, shopifyAccessToken? }`.
- Handler validates with Zod, then `prisma.tenant.upsert` (find-first-then-update or create). Tenant row exists.
- `POST /api/shop/test` constructs `new ShopifyClient({ domain, accessToken })` and calls `testConnection()`. With no token: returns `{ ok: true, shopName: "${domain} (mock mode)", mock: true }`.
- `POST /api/seed` (`app/api/seed/route.ts`, `maxDuration = 300`).
- Handler imports `seed` from `scripts/seed-from-beautysquare.ts` and `synth` from `scripts/synth-sales-history.ts`, then runs them sequentially:
- Response: `{ ok: true, productsSeeded: N }`.
- `POST /api/forecast/run` (`app/api/forecast/run/route.ts`, `maxDuration = 120`).
- Handler steps:
- Response: `{ ok: true, forecastsCreated: N }`.
- `useEffect` calls `GET /api/forecast` (`app/api/forecast/route.ts`).
- Handler fan-outs `Promise.all([predictions, sales30, sales90, sales365])`, computes summary (revenue30, COGS, gross margin, dead-stock vs active-stock at cost AND retail), builds monthly revenue series, and returns the joined payload.
- Dashboard shows Reorder / Stockout / Dead / All tabs with search and drill-down via `Link` to `/dashboard/product/[id]`.
### Approve / skip pending orders
- Dashboard or detail page POSTs `/api/orders/[id]/approve` or `/api/orders/[id]/skip`.
- Approve sets `status: "approved"`, `approvedAt: now()`, fakes a `shopifyDraftOrderId` (real impl would call `ShopifyClient.createDraftOrder`).
- Skip sets `status: "skipped"` with an optional reason.
### Simulation flows
- `/simulate` page (`app/simulate/page.tsx`) hosts two tools:
## Key Abstractions
- The forecast contract. Pure function: takes `{ productId, productType, vendor, sku, currentStock, abcCategory, history[], leadTimeAvg, leadTimeStd, activePromos[] }`, returns the full `ForecastResult` (layer1Forecast30d, layer1Confidence, layer2Adjustment, finalForecast30d, daysUntilStockout, recommendedQty, safetyStock, reorderPoint, confidence, reasoning string, urgency enum, signals array).
- This is the single seam for the Python sidecar swap. Same JSON shape, replaceable implementation.
- Helpers in `lib/forecast/baseline.ts` (`weightedDailyRate`, `kingsSafetyStock`, `reorderPoint`, `standardDeviation`, `zForServiceLevel`, `urgencyFromDays`, `daysOfStockRemaining`) are the reusable primitives.
- Class-based interface with the methods a real Shopify integration would need: `testConnection`, `fetchProducts`, `fetchOrders`, `fetchInventory`, `createDraftOrder`.
- Currently every method queries Prisma instead of HTTP. Each method has a `// MOCK — real impl: <Shopify endpoint>` comment pinning the future replacement.
- Constructor takes `ShopifyConfig = { domain, accessToken? }`.
- `kenyanHolidays(year)` returns dated holidays with per-category boost multipliers (Christmas: 2.5x ALL, 3.0x FRAGRANCE; Valentine's: 3.0x FRAGRANCE, 2.2x MAKEUP; Mother's/Father's Day computed by Nth-weekday-of-month).
- `isPaydayWeek(date)` — true for days 13-16 and 25-end (mid-month + end-of-month Kenya payday pattern).
- `paydayBoost(date)` → 1.6 in payday weeks, else 1.0.
- `dayOfWeekMultiplier(date)` — Fri 1.35, Sat 1.5, Sun 0.9, Mon 0.85.
- `holidayBoost(date, productType)` — fades multiplier linearly within ±3 days of holiday.
- Used by both the synthetic sales generator AND the forecast Layer-2 signals — so the "real" calendar pattern that's seeded in is the same pattern the forecast tries to detect.
- Every domain table (`Product`, `SalesHistory`, `Supplier`, `Promo`, `Prediction`, `Order`, `MonthlyContext`) has a `tenantId String` FK and a `@@index([tenantId])`.
- Cascade deletes from Tenant on every relation (`onDelete: Cascade`) — wiping a tenant wipes the entire dataset.
- BUT every route handler currently uses `prisma.tenant.findFirst()` — single-tenant in practice. Multi-tenant scaffolding is in place; auth + tenant resolution from request context is the missing piece.
- 7 lines. Stashes the client on `globalThis.prisma` in non-prod to survive Next.js hot reloads without leaking connections.
## Entry Points
- 5 lines. `redirect("/dashboard")`. There is no marketing landing page.
- Primary working surface. Loads `/api/forecast` on mount. Reorder / Stockout / Dead Stock / All tabs. Search box, "Rerun forecast" button (POST `/api/forecast/run`), navigation header linking to Simulate / Reports / Promos / Suppliers / Pricing / Contact / Settings.
- If no predictions exist, prompts user to "Go to Settings" to seed.
- Dynamic route. Loads `GET /api/products/[id]` — returns product + 365d history (by day, by month) + latest prediction + latest order status.
- Shop connect form (name, domain, optional access token). Test-connection button. **Seed catalog** button → `POST /api/seed`. **Generate forecasts** button → `POST /api/forecast/run`. Monthly business context form (marketing budget, promotions narrative, seasonal expectation, cash-flow note).
- List + edit modal. Fields: name, country, currency, leadTimeAvgDays, leadTimeStdDays, moq, notes. Supplier lead-time variability feeds King's safety stock formula in the forecast.
- Promo calendar. Fields: startDate, endDate, scope (`all|sku|category|brand`), scopeValue, discountPct, promoType (`payday|holiday|flash|gwp`), channel (`shopify|whatsapp|instagram|all`). Active promos at forecast-run time inject a lift into Layer 2.
- Budget allocator + demand-shock what-if.
- Monthly trends, by-category, by-brand, by-supplier breakdowns, top/slow movers, ABC counts, lost-sales estimate.
- Static-content marketing pages.
- `npm run seed` → runs `tsx scripts/seed-from-beautysquare.ts && tsx scripts/synth-sales-history.ts` (per `package.json`).
- `tsx scripts/seed-suppliers.ts` — seeds 6 hard-coded suppliers (Guangzhou/Dubai/Nairobi/Eastleigh/EU/Mombasa) and auto-assigns products by vendor/type matching.
- `tsx scripts/backfill-costs.ts` — recomputes `Product.costKes` from supplier-origin-aware margin ranges.
- `tsx scripts/run-forecasts.ts` — same forecast pipeline as `/api/forecast/run` but as CLI.
## Error Handling
- Route handlers wrap risky ops in `try/catch` and return `NextResponse.json({ error: msg }, { status: 4xx/500 })`. See `app/api/seed/route.ts`.
- Zod validation: `schema.safeParse(body)` then early-return `{ error: "Invalid input", details: parsed.error.flatten() }` on failure. Used in `app/api/shop/route.ts`, `app/api/suppliers/route.ts`, `app/api/promos/route.ts`, `app/api/monthly-context/route.ts`, `app/api/simulate/*`.
- Tenant guard: every mutating handler does `const tenant = await prisma.tenant.findFirst(); if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 })`.
- Client pages use plain `alert(err.error || "...failed")` on POST failures — no toast system.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
