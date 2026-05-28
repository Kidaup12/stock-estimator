# Phase 1: Boot, Determinism & Cleanup — Context

**Gathered:** 2026-05-28
**Status:** Ready for planning
**Mode:** auto (recommended option chosen per gray area; rationale logged)

<domain>
## Phase Boundary

Establish a **deterministic, Postgres-backed, reproducible baseline** of the existing app that every later phase can diff against. The mock onboarding → seed → forecast → dashboard flow boots locally with no behavioral surprises, the forecast simulator returns the same output for the same input, the schema carries the `onOrder` fields the reorder math needs, the duplicated `assignAbc()` lives in one place, and prediction history is no longer wiped on each run.

**Explicit non-scope** (these belong to later phases — do not touch in Phase 1):
- Auth — no Supabase wiring (Phase 2)
- Multi-tenant resolution — `prisma.tenant.findFirst()` calls stay as-is (Phase 2)
- Real Shopify / QuickBooks / Odoo — mock client stays (Phases 3-4)
- Python sidecar — TS simulator stays (Phase 5)
- UI changes — dashboard renders exactly as today

**Requirements in scope:** FND-01..07.
</domain>

<decisions>
## Implementation Decisions

### Database & Hosting

- **D-01: Postgres host = Supabase Postgres.** Phase 2 introduces Supabase Auth — running on Supabase Postgres means one project, one dashboard, one billing line, and unlocks Supabase RLS later if we want it (we won't lean on it for tenant scoping — `requireTenant()` chokepoint is the contract — but having it available is free). Vercel Postgres and Neon were the alternatives; both perfectly viable, but bundling with Supabase removes a moving part.
- **D-02: Both local dev and prod use Postgres.** No more SQLite. Local devs run Postgres via Docker Compose (committed `docker-compose.yml`) OR a personal Supabase project — README documents both. Eliminates `sqlite vs postgres` Prisma quirks (e.g. native JSON, default values, transaction semantics) showing up only in prod.
- **D-03: Real migrations via `prisma migrate`.** No more `prisma db push`. Initial migration (`20260528000000_init`) captures the current schema 1:1 from `prisma/schema.prisma`; subsequent FND-* schema changes (onOrder fields, forecastRunId) get their own migrations stacked on top. `npm run db:push` removed from `package.json`; `npm run db:migrate` (dev) and `prisma migrate deploy` (CI/Vercel build) replace it.
- **D-04: `prisma/dev.db` scrub method = `git rm` + `.gitignore` + retain in history.** Tracking removed going forward; the historical commits keep the file. Justification: BFG / `git filter-repo` rewrites history and breaks every existing clone (Anjay's, the GitHub PR refs, anyone Roy has shared the repo with). The 45 MB lives only in git history; it does not bloat the working tree or new clones with `--depth` shallow. If a real secret leaked we'd rewrite; demo data does not warrant it.

### Forecast Determinism

- **D-05: PRNG = mulberry32 inline at `lib/forecast/rng.ts`.** Six-line implementation, no dependency. Exports `mulberry32(seed: number): () => number` + `seedFrom(parts: Array<string | number | Date>): number` (FNV-1a hash returning 32-bit unsigned int).
- **D-06: Seed key = `(productId, runDate ISO date string)`.** Same `productId` on the same calendar day always returns the same forecast — this is the invariant tests will assert. Time-of-day is intentionally dropped (runs at 09:00 and 17:00 the same day should match — otherwise we can't run multiple forecasts in one day for comparison).
- **D-07: Every `Math.random()` call site gets a seeded RNG instance.** Audit: `lib/forecast/simulate-layers.ts`, `scripts/synth-sales-history.ts`, `scripts/seed-suppliers.ts`, `scripts/backfill-costs.ts`, anywhere else `grep` finds them. The synth-history script's RNG seed becomes a documented constant so the synthetic data is also reproducible.
- **D-08: Acceptance test = run the forecast twice in a row, JSON-diff Prediction rows, expect zero changes.** Lightweight script: `scripts/check-determinism.ts`. Failing it blocks the phase.

### Schema Additions

- **D-09: `Product.onOrder: Int @default(0)`, `Product.expectedArrivalAt: DateTime?`, `Product.receivedAt: DateTime?`.** Three nullable/defaulted scalars on `Product`. Rationale for staying on `Product` (not a separate `IncomingShipment` table): we already track open POs as `Order` rows; multi-shipment tracking can come when supplier scorecards land (v1.x). For v1, the sum of pending-but-not-received quantity is what reorder math needs, and it can live on `Product` as a running counter updated by Order approval and (eventually) receipt webhooks.
- **D-10: Reorder math change.** In `app/api/forecast/run/route.ts` AND `scripts/run-forecasts.ts`: `recommendedQty = max(0, ceil(finalForecast30d + safetyStock - currentStock - onOrder))`. Same formula in both call sites; both import from a new helper.
- **D-11: `Prediction.forecastRunId: String` (cuid) + `Prediction.regime: String?` (placeholder, populated by Phase 5).** `prisma.prediction.deleteMany()` is removed from the forecast run route; instead, every run inserts a new batch tagged with one `forecastRunId`. Dashboards query latest-`runDate`-per-`productId`.

### Code Layout

- **D-12: `assignAbc()` moves to `lib/forecast/abc.ts`.** Exported as `export function assignAbc(input: AbcInput): AbcCategory`. Both `app/api/forecast/run/route.ts` AND `scripts/run-forecasts.ts` import it. Original duplicates deleted. Signature stays identical to whichever copy is the better one (auditor noted they're already drift-prone — pick the more correct one and unify).
- **D-13: Reorder-math helper at `lib/forecast/reorder.ts`** — extract the `currentStock - onOrder` math from D-10 into a function used by both call sites. Same DRY rationale as `assignAbc`.

### Configuration & Onboarding

- **D-14: `.env.example` documents every variable v1 will need, even unused-in-Phase-1 ones, with TODO comments.** `DATABASE_URL` (required Phase 1), `NEXTAUTH_*` / `SUPABASE_*` (TODO Phase 2), `SHOPIFY_*` (TODO Phase 3), `QUICKBOOKS_*` (TODO Phase 4), `RESEND_API_KEY` (TODO Phase 4), `FORECAST_SIDECAR_URL` + `FORECAST_SIDECAR_SECRET` (TODO Phase 5), `SENTRY_DSN` (TODO Phase 5), `TOKEN_ENCRYPTION_KEY` (TODO Phase 2/3). Empty values, descriptive comments. Single file owners can grep.
- **D-15: README's "Local dev" + "Deploy to Vercel" sections rewritten** to match the new Postgres-only flow. The current `npx prisma db push` instructions are misleading after this phase.
- **D-16: `next.config.ts:6` `outputFileTracingIncludes` for `prisma/dev.db` is removed** — Postgres deploy doesn't need it; SQLite is gone.

### Claude's Discretion

- Exact Docker Compose Postgres version (Roy can pin a sensible 16.x — match Supabase's prod version).
- Whether to add a tiny vitest harness for `lib/forecast/rng.ts` + `lib/forecast/abc.ts` + `lib/forecast/reorder.ts`. Leaning yes — three pure functions are the perfect first vitest beachhead, and Phase 2's tenant-isolation test will lean on the same harness. Out-of-scope-as-phase-goal per REQUIREMENTS.md, but inlining ~30 LOC of test setup here is a freebie.
- Commit cadence within the phase: one commit per logical change (rng, schema, abc dedupe, postgres swap, dev.db removal, env example, README) so a reverter has handles.
- Whether the `forecast-runs` UI table needs a new admin page in this phase. Default: no — invisible to the owner today; surface in Phase 5 when drift detection lands.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — scope, constraints, SOW integration, source-of-truth strategy
- `.planning/REQUIREMENTS.md` §Foundations — FND-01..07 verbatim
- `.planning/ROADMAP.md` — Phase 1 entry with success criteria

### Codebase map (frozen snapshot at `a2b8fe4`)
- `.planning/codebase/STACK.md` — current deps and configs
- `.planning/codebase/ARCHITECTURE.md` — forecast contract seam at `lib/forecast/simulate-layers.ts::simulateLayeredForecast()`
- `.planning/codebase/STRUCTURE.md` — directory layout
- `.planning/codebase/CONCERNS.md` — names every Phase 1 issue with file:line citations (Math.random, deleteMany, assignAbc duplication, dev.db in git, no .env.example, missing onOrder)

### Research
- `.planning/research/SUMMARY.md` §Headline #1 (Phase 1 fixed-and-tiny) + §4 (determinism + Location-first-class) + §5 pitfalls #1 and #5

### Existing app files Phase 1 will modify
- `prisma/schema.prisma` — provider flip, `Product.onOrder/expectedArrivalAt/receivedAt`, `Prediction.forecastRunId/regime`
- `lib/forecast/simulate-layers.ts` — replace `Math.random()` with seeded RNG instance
- `lib/forecast/baseline.ts` — math primitives, do not touch
- `app/api/forecast/run/route.ts` — remove `prisma.prediction.deleteMany()`, import `assignAbc` from `lib/forecast/abc.ts`, use reorder helper
- `scripts/run-forecasts.ts` — same dedupe + helper change
- `scripts/synth-sales-history.ts` — seeded RNG, documented seed constant
- `scripts/seed-suppliers.ts`, `scripts/backfill-costs.ts` — seeded RNG
- `next.config.ts` — remove dev.db tracing include
- `package.json` — `db:push` → `db:migrate`
- `README.md` — rewrite Local dev + Deploy sections
- `.env.example` — create

### External docs (will be consulted at plan time)
- Prisma Migrate docs — `prisma migrate dev`, `prisma migrate deploy`, baseline migration flow for an existing-schema project
- Supabase Postgres connection-string docs — pooler URL vs direct URL (Vercel needs pooler)
- `mulberry32` reference implementation — single canonical 6-line snippet in `lib/forecast/rng.ts`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/prisma.ts` — singleton client, no changes needed
- `lib/forecast/baseline.ts` — King's formula, safety stock, urgency math — all pure, all stays
- `lib/forecast/simulate-layers.ts` — contract function; mutate internals (RNG) without changing the JSON shape
- `lib/seed/kenya-calendar.ts` — payday + holiday calendar; reused by Phase 5 sidecar, do not break
- Existing zod usage in API routes is the pattern Phase 1 schema migrations should preserve

### Established Patterns
- API routes resolve tenant via `prisma.tenant.findFirst()` — **deliberately untouched** in Phase 1; Phase 2 will replace
- Scripts mirror API routes via shared library functions (e.g. `seed-from-beautysquare.ts` `seed()` is imported by `app/api/seed/route.ts`); Phase 1 follows the same pattern when extracting `assignAbc` and reorder math
- TypeScript strict + `@/*` path alias + zod for inputs — phase 1 helpers stay consistent

### Integration Points
- The new RNG seam (`lib/forecast/rng.ts`) is called by `simulate-layers.ts` + every script that previously used `Math.random()`
- The new `abc.ts` is called by `app/api/forecast/run/route.ts` + `scripts/run-forecasts.ts`
- The new `reorder.ts` is called by the same two files
- Prisma schema changes ripple to: the forecast run route (read `onOrder` for the deduction), the seed/sync code (currently writes nothing to `onOrder` — that's fine until Phase 3 ingests real PO data)
- `outputFileTracingIncludes` removal in `next.config.ts` is the canary that proves `dev.db` is no longer needed in the bundle

### Risk Surface
- Migration baselining an existing schema: must run `prisma migrate resolve --applied <initial>` on environments that already have the SQLite schema, otherwise Postgres migration fails on "schema already exists" — runbook step in README
- Anything seeded by `synth-sales-history.ts` becomes deterministic — if a downstream test (TBD) relied on randomness, it must update; not aware of any today

</code_context>

<specifics>
## Specific Ideas

- Postgres dev experience priority: **same command on every dev machine** (`docker compose up -d db` then `npm run db:migrate dev`). Roy has shipped this pattern on Melvin LPO and Kidaflow LPO; copy that compose file shape.
- The `forecastRunId` field is a cuid generated by the route handler at the start of a forecast run; every Prediction row in that batch gets the same id. Dashboards query `(select latest runId per product) JOIN predictions`.
- For determinism testing: the script `scripts/check-determinism.ts` runs `simulateLayeredForecast()` twice with identical inputs and asserts deep equality. Add to `package.json` as `npm run check:determinism`. Phase 5 will reuse it as the smoke test for the sidecar.
- README rewrite tone: short and direct. Anjay will read it; he doesn't want walls of text.

</specifics>

<deferred>
## Deferred Ideas

- **Vitest harness as a standalone setup** — folding ~30 LOC of vitest bootstrap into Phase 1 to cover `rng.ts`/`abc.ts`/`reorder.ts` is Claude's Discretion (above). A full CI workflow on top is a separate concern; if it lands here, keep it tiny.
- **Per-supplier shipping mode tracking (sea vs air)** for lead-time variance — relevant once real PO data flows (Phase 3+); schema field can land then.
- **`Location` first-class entity** — research said add it in Phase 3 alongside Shopify ingest. Not a Phase 1 task.
- **Token encryption schema columns** — needed in Phase 2/3; Phase 1 does not add `ShopifyConnection` / `QuickBooksConnection` tables.
- **Cleaning the historical `prisma/dev.db` from git history** — only revisit if a real secret is discovered there; otherwise the working-tree-only scrub is sufficient.
- **CI workflow (GitHub Actions)** — out of scope per REQUIREMENTS.md "Out of Scope"; revisit before milestone close.

### Reviewed Todos (not folded)
None — no pre-existing todos in this repo's `.planning/`.

</deferred>

---

*Phase: 01-boot-determinism-cleanup*
*Context gathered: 2026-05-28*
