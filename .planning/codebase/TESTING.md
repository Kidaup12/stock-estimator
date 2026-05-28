# Testing Patterns

**Analysis Date:** 2026-05-28

## Headline: There Are No Tests

**No test framework is installed or configured.** This is not "tests exist but coverage is low" — it is "the testing layer does not exist at all". Document this honestly so future phases plan accordingly.

### What does NOT exist

Verified absent via Glob + package.json inspection:

- **No test runner in dependencies.** `package.json` has zero entries for `jest`, `vitest`, `mocha`, `ava`, `node:test`, `@testing-library/*`, `playwright`, `cypress`, `webdriverio`, `chai`, `sinon`.
- **No config files.** `jest.config.*`, `vitest.config.*`, `playwright.config.*`, `cypress.config.*` — none found.
- **No test files.** Glob for `**/*.{test,spec}.{ts,tsx,js,jsx,mjs}` returns zero results. No `__tests__/` directory exists anywhere.
- **No `test` script in `package.json`.** The `scripts` block (`package.json:5-15`) contains: `dev`, `build`, `postinstall`, `start`, `lint`, `db:push`, `db:studio`, `db:generate`, `seed`. There is no `test`, `test:unit`, `test:e2e`, or coverage entry.
- **No CI workflow.** No `.github/workflows/` directory at repo root.
- **No `error.tsx` / `not-found.tsx` route safety nets.** Even runtime error UI is absent.

### What DOES exist (manual verification harnesses, sort of)

These aren't tests, but they're the closest thing the codebase has to verifying behavior:

1. **`app/api/shop/test/route.ts`** — Despite the URL segment `test`, this is a production endpoint that pings `ShopifyClient.testConnection()` for a given domain/token. It's a Shopify connectivity probe, not a test runner. Useful as a smoke check after wiring credentials but does not cover application logic.

2. **`app/api/seed/route.ts`** — Re-runs `seed-from-beautysquare` + `synth-sales-history` and returns `{ ok: true, productsSeeded: N }`. After invoking this, the dashboard rendering against the seeded data is the only "did it work?" signal.

3. **`scripts/run-forecasts.ts`** — Standalone forecast runner (mirrors `app/api/forecast/run/route.ts`) that logs progress. Running it after changes to `lib/forecast/*.ts` lets you eyeball whether numbers look sane. This is the closest thing to a forecast regression check.

4. **`scripts/backfill-costs.ts`** — One-shot data migration utility. Re-runnable; verification is "look at the DB after".

5. **The `lint` script.** `npm run lint` (next lint) is the only automated check that ever runs. It will not catch logic regressions.

**Manual verification loop in practice:**
```bash
npm run seed              # rebuild SQLite from seed
npm run dev               # start Next at :3000
# open browser, click through /dashboard, /simulate, /reports
# verify numbers look right by eye
```

## Test Framework

**Runner:** None.

**Assertion Library:** None.

**Run Commands:**
```bash
# Not applicable — no test runner configured.
npm run lint              # closest thing to an automated check
```

## Test File Organization

Not applicable. No conventions to follow because no files exist yet. If/when tests are introduced, the existing `@/*` path alias (`tsconfig.json:25-28`) and Next.js conventions suggest:

- **Vitest is the natural fit** (works with Next 16, ESM, supports `@/` paths via `vite-tsconfig-paths`, and matches the lightweight tone of this codebase).
- Co-located `*.test.ts` next to source (e.g. `lib/forecast/baseline.test.ts`) is more consistent with the codebase's flat, non-barreled structure than a separate `__tests__/` root.

But these are guesses — no convention has been established by prior work.

## Coverage

**Current:** 0%. Not measured.

**Targets:** None defined.

## Implications for Upcoming Phases

**We are flying blind on regressions.** Every code change ships to production validated only by:

1. TypeScript compile (`strict: true` in `tsconfig.json:11` — catches type errors only, not logic errors).
2. ESLint (`next lint` — catches style/imports, not behavior).
3. `next build` succeeding (catches static rendering errors, not runtime correctness).
4. Manual click-through after `npm run dev`.

**Concrete risks for upcoming phases:**

- **Forecast math (`lib/forecast/baseline.ts`, `lib/forecast/simulate-layers.ts`):** These are pure functions with numeric outputs — exactly the kind of code that benefits most from unit tests, and exactly where silent regressions hurt most. Changing `weightedDailyRate`, `kingsSafetyStock`, or `urgencyFromDays` without tests means an off-by-one or wrong weight can ship without anyone noticing until a customer complains the reorder numbers look wrong.

- **Budget allocator (`app/api/simulate/budget/route.ts`):** The greedy fill + critical-overflow logic has multiple branches (critical always selected, deferred-at-risk filtering, score composite). Easy to break.

- **API contract drift:** Pages consume `/api/forecast`, `/api/forecast/run`, etc. via untyped `fetch` + `await res.json()` (`app/dashboard/page.tsx:78-82`). If a route changes its response shape, client pages will silently render `undefined` fields. There is no contract test, no shared TypeScript type between route and consumer, no OpenAPI schema.

- **Prisma schema migrations:** No data-migration tests. `scripts/backfill-costs.ts` style backfills run once with no rollback path.

- **Shopify integration (`lib/shopify/client.ts`):** Currently all-mock — methods are commented `// MOCK — real impl: ...`. When real Shopify API calls replace the mocks, there is no recorded-fixture test setup to validate request/response shape.

**Recommended minimum before risky phases land:**

1. Add Vitest + a handful of unit tests for `lib/forecast/baseline.ts` pure functions. Even 5 assertions per function would catch most numeric regressions.
2. Add a smoke test that hits each `app/api/*` route's `GET` handler and asserts the response envelope keys exist (`predictions`, `summary`, `products`, `promos`, etc.) — this catches contract drift cheaply.
3. Add an `npm test` script and wire it into a GitHub Actions check before `main` merges.

Until then, treat every PR as a manual-verification PR: spin up dev, click through the pages whose API responses changed, eyeball the numbers.

## Test Types

**Unit Tests:** None.

**Integration Tests:** None.

**E2E Tests:** None. Playwright/Cypress not installed.

**Manual Smoke:** `npm run seed && npm run dev` then walk `/dashboard`, `/simulate`, `/reports`, `/promos`, `/suppliers`, `/settings` is the de facto release check.

## Common Patterns

Not applicable — no patterns to copy. When the first test is written, that file becomes the template.

---

*Testing analysis: 2026-05-28*
