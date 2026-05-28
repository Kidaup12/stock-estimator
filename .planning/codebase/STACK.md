# Technology Stack

**Analysis Date:** 2026-05-28

## Languages

**Primary:**
- TypeScript ^5 — All app code (`app/`, `lib/`, `scripts/`). `strict: true` enabled in `tsconfig.json`.

**Secondary:**
- Not applicable — single-language repo. No Python sidecar yet (README notes it as next milestone).

## Runtime

**Environment:**
- Node.js (version not pinned via `.nvmrc` or `engines`). Required by Next.js 16 / React 19 (typically Node 20+).

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present at repo root.

## Frameworks

**Core:**
- Next.js ^16.2.6 — App Router (`app/` directory). API routes under `app/api/`. Configured in `next.config.ts`.
- React ^19.0.0 + React DOM ^19.0.0 — UI framework.

**Testing:**
- Not detected — no Jest, Vitest, Playwright, or test files found in repo.

**Build/Dev:**
- Prisma ^6.1.0 (devDependencies) + `@prisma/client` ^6.1.0 (dependencies) — ORM. Schema at `prisma/schema.prisma`.
- tsx ^4.19.2 — Used to run TypeScript scripts directly (seed/synth/run-forecasts scripts).
- Tailwind CSS ^4.0.0 with `@tailwindcss/postcss` ^4.0.0 — Styling. PostCSS pipeline configured in `postcss.config.mjs`.
- PostCSS ^8 — CSS toolchain.
- ESLint ^9 + `eslint-config-next` ^16.2.6 + `@eslint/eslintrc` ^3 — Lint. Flat config in `eslint.config.mjs`.

## Key Dependencies

**Critical:**
- `@prisma/client` ^6.1.0 — Database ORM client. Singleton instantiated in `lib/prisma.ts`.
- `next` ^16.2.6 — Server, routing, build.
- `react` / `react-dom` ^19.0.0 — UI.
- `zod` ^3.24.1 — Runtime input validation. Used in API routes (e.g. `app/api/shop/route.ts`, `app/api/shop/test/route.ts`) to validate request bodies.

**Infrastructure:**
- `prisma` ^6.1.0 — CLI for migrations / generate / studio.
- `tsx` ^4.19.2 — TS execution for `scripts/`.

## Configuration

**Environment:**
- `DATABASE_URL` — Referenced in `README.md` as the env var to set when switching to Postgres on Vercel. Not currently read in code (Prisma schema hardcodes `url = "file:./dev.db"` for SQLite dev).
- `NODE_ENV` — Used in `lib/prisma.ts` to attach the Prisma client to `globalThis` outside production (prevents hot-reload connection leaks).
- No `.env` file detected in repo root.

**Build:**
- `next.config.ts` — Includes `prisma/dev.db` in serverless function output via `outputFileTracingIncludes` (read-only demo data bundle for Vercel). Whitelists `**.shopify.com` and `cdn.shopify.com` for `next/image` remote patterns.
- `tsconfig.json` — `target: ES2017`, `moduleResolution: bundler`, `jsx: preserve`, path alias `@/*` → `./*`. Excludes `app inspo`, `app/(app)`, `app/login`, `app/showroom` (legacy/scratch directories).
- `postcss.config.mjs` — Single `@tailwindcss/postcss` plugin.
- `eslint.config.mjs` — Composes `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript` flat configs; explicitly re-applies default ignores (`.next/**`, `out/**`, `build/**`, `next-env.d.ts`).

## Prisma Schema Overview

**File:** `prisma/schema.prisma`

**Generator:** `prisma-client-js`

**Datasource:** SQLite (`provider = "sqlite"`, `url = "file:./dev.db"`). README documents switching to `postgresql` for production.

**Models (8):**
- `Tenant` — Single-shop record holding `name`, `shopifyDomain`, optional `shopifyAccessToken`, `currency` (default `KES`). Parent of all other tenant-scoped tables.
- `Product` — Catalog row with Shopify IDs, `sku`, `title`, `vendor`, `productType`, `priceKes`, `costKes`, `imageUrl`, `currentStock`, `abcCategory`, `dailySalesRate`, optional `supplierId`. Unique `(tenantId, shopifyProductId)`.
- `SalesHistory` — Daily per-product sales rows: `date`, `quantity`, `revenueKes`, `channel` (default `shopify`). Unique `(productId, date, channel)`.
- `Supplier` — `name`, `country`, `currency`, `leadTimeAvgDays`, `leadTimeStdDays`, `moq`, `notes`.
- `Promo` — `startDate`, `endDate`, `scope` (`all|sku|category|brand`), `scopeValue`, `discountPct`, `promoType` (`flash` default), `channel`.
- `MonthlyContext` — `month`, `marketingBudget`, `promotions`, `seasonalExpectation`, `cashFlow`, `notes`. Unique `(tenantId, month)`.
- `Prediction` — Forecast snapshot per `productId` + `runDate`: `layer1Forecast30d`, `layer1Confidence`, `layer2Adjustment`, `finalForecast30d`, `daysUntilStockout`, `recommendedQty`, `safetyStock`, `reorderPoint`, `confidence`, `reasoning` (string), `urgency`, `signals` (JSON-encoded string).
- `Order` — Reorder proposal tied to a `Prediction`: `status` (default `pending`), optional `shopifyDraftOrderId`, `approvedAt`, `skipReason`.

**Cascading deletes:** All child relations to `Tenant` use `onDelete: Cascade`. `Product.supplier` uses `onDelete: SetNull`.

## Platform Requirements

**Development:**
- Node.js (Next 16 / React 19 compatible — Node 20+ recommended).
- npm install, then `npx prisma db push` to create local SQLite file at `prisma/dev.db`.
- `npm run dev` to start Next.js dev server.

**Production:**
- Vercel (referenced in `README.md`). The bundled `prisma/dev.db` is included via `outputFileTracingIncludes` but is read-only at runtime; any seed/forecast/promo write requires switching `prisma/schema.prisma` to `postgresql` and setting `DATABASE_URL` (e.g., Vercel Postgres or Neon).

## Scripts

**Defined in `package.json`:**

```bash
npm run dev          # next dev
npm run build        # prisma generate && next build
npm run start        # next start
npm run lint         # next lint
npm run db:push      # prisma db push (sync schema → db)
npm run db:studio    # prisma studio (DB GUI)
npm run db:generate  # prisma generate
npm run seed         # tsx scripts/seed-from-beautysquare.ts && tsx scripts/synth-sales-history.ts
```

**Lifecycle:**
- `postinstall` runs `prisma generate` automatically after `npm install`.

**Ad-hoc scripts (run via `npx tsx`):**
- `scripts/seed-from-beautysquare.ts` — Scrape products from `beautysquareke.co/products.json`.
- `scripts/synth-sales-history.ts` — Generate 365 days of Kenya-calibrated synthetic sales (Poisson).
- `scripts/seed-suppliers.ts` — Seed 6 suppliers and assign products via vendor/type matching.
- `scripts/backfill-costs.ts` — Recalculate `costKes` per supplier-specific margin band.
- `scripts/run-forecasts.ts` — Compute ABC class + run layered forecast for every product; create pending `Order` rows for critical/high urgency.

---

*Stack analysis: 2026-05-28*
