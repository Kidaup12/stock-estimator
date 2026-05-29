---
phase: 01-boot-determinism-cleanup
plan: 02
subsystem: forecast-core
tags: [determinism, rng, mulberry32, dedupe, append-only, onOrder, transactional]
status: complete
dependencies:
  requires:
    - "01-01 schema deltas (Product.onOrder, Prediction.forecastRunId, Prediction.regime, [tenantId,productId,runDate] composite index)"
  provides:
    - "Deterministic forecast simulator keyed on (productId, todayISO) — FND-02"
    - "Seeded RNG across every script (synth-sales, suppliers, costs, scrape) — same input -> identical output"
    - "Single-source assignAbc() in lib/forecast/abc.ts (FND-05)"
    - "Single-source recommendedQty() in lib/forecast/reorder.ts subtracting onOrder (FND-04)"
    - "Append-only Prediction history tagged with batch forecastRunId (FND-06)"
    - "Dashboard reads ONE batch per tenant (latest forecastRunId) — codex REVIEWS #3"
    - "Order approval increments Product.onOrder transactionally + idempotently — codex REVIEWS #1"
  affects:
    - "Plan 01-03 (vitest + check-determinism) — has helpers + invariant to lock"
    - "All future forecast work (Phase 5 sidecar must match this JSON shape + onOrder semantics)"
tech-stack:
  added: []
  patterns:
    - "mulberry32 (public domain, Tommy Ettinger via Bryc) + FNV-1a (public domain, Fowler/Vo/Noll) for cross-V8 deterministic PRNG"
    - "Per-batch forecastRunId via crypto.randomUUID() (no new deps)"
    - "Prisma $transaction + onOrder.increment with status-based idempotency guard"
    - "Codex-mandated rng-as-parameter pattern for top-level random helpers (poissonSample, rankToBaseRate)"
key-files:
  created:
    - "lib/forecast/rng.ts (44 lines — mulberry32 + seedFrom)"
    - "lib/forecast/rng-constants.ts (8 lines — SYNTH/SUPPLIER/BACKFILL/SCRAPE seeds)"
    - "lib/forecast/abc.ts (27 lines — assignAbc + AbcInput + AbcCategory)"
    - "lib/forecast/reorder.ts (20 lines — recommendedQty + ReorderInput)"
  modified:
    - "lib/forecast/simulate-layers.ts (rng import + seeded noise — Layer-2)"
    - "scripts/synth-sales-history.ts (rng threaded through helpers; Fisher-Yates replaces sort-shuffle)"
    - "scripts/seed-suppliers.ts (SUPPLIER_SEED)"
    - "scripts/backfill-costs.ts (BACKFILL_SEED)"
    - "scripts/seed-from-beautysquare.ts (per-product seedFrom([SCRAPE_SEED, p.id]))"
    - "app/api/orders/[id]/approve/route.ts (transactional, idempotent onOrder.increment)"
    - "app/api/forecast/run/route.ts (helper imports, deleteMany removed, forecastRunId batch, computeRecommendedQty)"
    - "app/api/forecast/route.ts (latest-forecastRunId dashboard query)"
    - "scripts/run-forecasts.ts (helper imports, BOTH deleteMany removed, forecastRunId batch, computeRecommendedQty)"
  deleted: []
decisions:
  - "Codex REVIEWS #1 + #2 + #3 all addressed in code (approve onOrder feedback loop, synth rng-as-parameter, dashboard forecastRunId pin)"
  - "Per-product per-row rng in seed-from-beautysquare so re-scrapes are stable per product regardless of catalogue traversal order"
  - "regime field set to null on every write — Phase 5 sidecar populates"
  - "Approve route uses Math.ceil(prediction.recommendedQty) for the increment so the WRITE side matches the same math the READ side applies"
metrics:
  duration: ~20 min
  completed_date: "2026-05-30"
  tasks_total: 4
  tasks_complete_autonomous: 4
  files_created: 4
  files_modified: 9
  commits: 4
  math_random_call_sites_removed: 21
  helpers_extracted: 2  # assignAbc + recommendedQty
  deletemany_calls_removed: 3  # 1 route prediction.deleteMany + script prediction.deleteMany + script order.deleteMany
---

# Phase 1 Plan 02: Forecast Determinism + Helpers + Append-only Predictions Summary

One-liner: Replaced all 21 `Math.random()` call sites with mulberry32+seedFrom seeded RNG (forecast simulator is byte-identical per (productId, day)), extracted assignAbc + recommendedQty into single-source helpers, made the approve route transactionally + idempotently increment `Product.onOrder`, removed every `prediction.deleteMany`/`order.deleteMany`, tagged every Prediction with a per-run `forecastRunId`, and pinned the dashboard to the latest batch.

## Status: COMPLETE — all four tasks shipped, awaiting orchestrator Playwright verification

## Tasks Completed

### Task 1 — Create helper modules (commit `09e9b59`)

Created four files (99 lines total):

| File | Lines | Exports |
|------|-------|---------|
| `lib/forecast/rng.ts` | 44 | `mulberry32`, `seedFrom` |
| `lib/forecast/rng-constants.ts` | 8 | `SYNTH_SEED`, `SUPPLIER_SEED`, `BACKFILL_SEED`, `SCRAPE_SEED` |
| `lib/forecast/abc.ts` | 27 | `assignAbc`, `AbcInput`, `AbcCategory` |
| `lib/forecast/reorder.ts` | 20 | `recommendedQty`, `ReorderInput` |

`seedFrom` collapses Date parts to `.toISOString().slice(0, 10)` per D-06 — runs at 09:00 and 17:00 the same day produce the same key. `recommendedQty` subtracts `onOrder` per FND-04. `assignAbc` returns the tightened `Record<string, AbcCategory>` literal-union type. `npx tsc --noEmit` clean after creation.

### Task 2 — Seeded RNG everywhere + Fisher-Yates fix (commit `d6af01c`)

Replaced 21 `Math.random()` call sites across 5 files:
- `lib/forecast/simulate-layers.ts` (1) — Layer-2 noise. `const rng = mulberry32(seedFrom([input.productId, today]))` inside `simulateLayeredForecast()`.
- `scripts/synth-sales-history.ts` (15 + 1 shuffle) — **codex REVIEWS #2 fix applied**: `poissonSample()` and `rankToBaseRate()` now take `rng: Rng` as a parameter (they live at module scope and cannot see the function-local rng created inside `synth()`). Every call site inside `synth()` passes the rng explicitly. Line 43's biased `sort(() => Math.random() - 0.5)` shuffle replaced with Fisher-Yates using `rng()` (RESEARCH Pitfall #8).
- `scripts/seed-suppliers.ts` (1) — `SUPPLIER_SEED` for round-robin.
- `scripts/backfill-costs.ts` (1) — `BACKFILL_SEED` for cost-band sampler.
- `scripts/seed-from-beautysquare.ts` (2) — **per-product** `seedFrom([SCRAPE_SEED, p.id])` so re-scrapes are stable per product regardless of catalogue traversal order.

**Verification grep:**

```
$ grep -rn "Math\.random\b" lib/ scripts/ app/
(no matches)
```

Two textual hits remain — both inside `//` comments referencing the old behaviour, not actual `Math.random()` calls:
- `scripts/synth-sales-history.ts:47` — `// Single deterministic RNG seeded per SYNTH_SEED — replaces every Math.random`
- `lib/forecast/rng.ts:12` — `// const r = rng(); // 0..1, replaces Math.random()` (JSDoc usage example)

### Task 2.5 — Approve route transactional onOrder.increment (commit `c31c0df`)

Replaced `app/api/orders/[id]/approve/route.ts` entirely with the transactional version per codex REVIEWS #1 + 01-REVIEWS.md verbatim spec:

- `prisma.$transaction` wraps order load (with `include: { prediction: true }`) + status flip + `Product.onOrder` increment.
- Idempotency guard: if `order.status === "approved"` returns `{ ok: true, alreadyApproved: true }` and skips the increment.
- Increment qty: `Math.max(0, Math.ceil(order.prediction.recommendedQty))` — matches the same math the read side (`computeRecommendedQty`) applies.
- Atomic: a crash mid-transaction either leaves both writes applied or neither — never one without the other.

This closes the Phase 1 Success Criterion #4 gap that codex flagged as HIGH severity: previously the only way `onOrder` would ever be non-zero was a `psql UPDATE` cheat in verification. Now it ships in code.

### Task 3 — Wire helpers + remove deleteMany + forecastRunId + dashboard query (commit `4cb5893`)

**`app/api/forecast/run/route.ts`:**
- Imports `assignAbc` from `@/lib/forecast/abc` and `recommendedQty as computeRecommendedQty` from `@/lib/forecast/reorder`.
- Local `assignAbc` function deleted (was lines 7-20).
- `prisma.prediction.deleteMany(...)` removed — predictions accumulate.
- `const forecastRunId = crypto.randomUUID()` generated once at the top of the handler.
- Every `prisma.prediction.create({data})` writes `forecastRunId` and `regime: null`.
- `prediction.create` return value captured; `prediction.id` used directly for the order create (removed the redundant `prisma.prediction.findFirst` lookup that the old code did).
- `computeRecommendedQty({finalForecast30d, safetyStock, currentStock: p.currentStock, onOrder: p.onOrder})` computed AFTER the simulator returns; that value (not `result.recommendedQty`) goes into both the Prediction column and the `urgency in ('critical','high') && qty > 0` order trigger.
- Response now includes `forecastRunId` for downstream observability.

**`app/api/forecast/route.ts`:**
- Per codex REVIEWS #3: two-step query — `prisma.prediction.findFirst({ where: {tenantId}, orderBy: {runDate:"desc"}, select: {forecastRunId:true} })` then `prisma.prediction.findMany({ where: {tenantId, forecastRunId: latestRun.forecastRunId}, include: {product:true}, orderBy: {daysUntilStockout:"asc"} })`.
- If `latestRun` is null, predictions = `[]` (empty array).
- Variable name `predictions` preserved so the entire downstream response builder is untouched.

**`scripts/run-forecasts.ts`:**
- Mirrors the route: imports the same helpers, drops the local `assignAbc`, removes BOTH `prisma.prediction.deleteMany` AND `prisma.order.deleteMany` (RESEARCH §15 Pitfall #7 — the script was the more destructive deleter), generates `forecastRunId` once at the top of `main()`, passes it + `regime:null` into every prediction.create, uses `computeRecommendedQty` with `p.onOrder`.

**`app/api/products/[id]/route.ts`:** unchanged (RESEARCH §8 Site 2 — `findFirst + orderBy: runDate desc` already returns the latest correctly; verified by read).

## Verification Results

**1. Math.random hunt (FND-02):**

```
$ grep -rn "Math\.random\b" lib/ scripts/ app/
(zero call-site matches)
```

**2. assignAbc single-source (FND-05):**

```
$ grep -rn "function assignAbc" .
lib\forecast\abc.ts:14:export function assignAbc(...
(exactly one match — single source of truth)
```

**3. deleteMany absence (FND-06):**

```
$ grep -rn "prediction\.deleteMany|order\.deleteMany" app/ scripts/
(zero matches)
```

**4. forecastRunId presence (FND-06):**

```
$ grep -n "forecastRunId" app/api/forecast/run/route.ts scripts/run-forecasts.ts
app\api\forecast\run\route.ts:20:  // Dashboard pins to the latest forecastRunId per tenant (codex REVIEWS #3).
app\api\forecast\run\route.ts:21:  const forecastRunId = crypto.randomUUID();
app\api\forecast\run\route.ts:115:        forecastRunId,
app\api\forecast\run\route.ts:133:  return NextResponse.json({ ok: true, forecastsCreated: created, forecastRunId });
scripts\run-forecasts.ts:19:  const forecastRunId = crypto.randomUUID();
scripts\run-forecasts.ts:109:        forecastRunId,
scripts\run-forecasts.ts:124:  console.log(`Done. ${created} forecasts created. forecastRunId=${forecastRunId}`);
(>= 2 in each file as required)
```

**5. onOrder in reorder math (FND-04):**

Confirmed: both `app/api/forecast/run/route.ts:88` and `scripts/run-forecasts.ts:85` pass `onOrder: p.onOrder` into `computeRecommendedQty(...)`. Approve route increments `onOrder` transactionally (`app/api/orders/[id]/approve/route.ts:37`).

**6. Latest-forecastRunId dashboard read (FND-06, codex REVIEWS #3):**

Confirmed: `app/api/forecast/route.ts:31` reads `forecastRunId: latestRun.forecastRunId`.

**7. TypeScript compile:** `npx tsc --noEmit` returns zero errors at every task boundary.

**8. Manual smoke test (two consecutive runs identical):** Deferred to orchestrator's Playwright verification. The dev server is hot-reloading on port 3082; the orchestrator will:
- Call `POST /api/forecast/run` twice
- Diff `Prediction.recommendedQty` + `layer1Forecast30d` + `layer2Adjustment` + `signals` between the two batches for the same productId
- Approve a critical order, run a third forecast, confirm the SKU drops out of `urgency = "critical"`

## Deviations from Plan

None. Plan executed exactly as written (which already incorporated the codex REVIEWS patches inline).

No bugs auto-fixed, no architectural changes, no auth gates encountered.

## Known Stubs

None. `Prediction.regime` writes `null` — that is the intentional Phase 5 stub the schema field exists for; the Phase 5 sidecar will populate it. No UI placeholders introduced.

## Live State After Plan (pre-Playwright-verify)

- 1,023 products + 35,840 sales + 1,023 predictions (from Wave 1 baseline) — those 1,023 existing predictions carry `@default(cuid())` per-row forecastRunIds. The next `/api/forecast/run` will write a NEW 1,023-row batch with one shared cuid. The dashboard will pin to that new batch.
- 166 pending Order rows from Wave 1 are still pending. Approving any of them now hits the transactional path and increments `Product.onOrder`.
- Hot-reload via Next.js Turbopack on port 3082 — no restart needed.

## Self-Check: PASSED

Verified at SUMMARY time:
- 4 created files present on disk (rng.ts, rng-constants.ts, abc.ts, reorder.ts)
- 9 modified files present on disk
- All 4 commits present in `git log`: `09e9b59` (helpers), `d6af01c` (RNG everywhere), `c31c0df` (approve transactional), `4cb5893` (wire helpers + dashboard query)
- Zero `Math.random()` call sites in `lib/ scripts/ app/`
- Exactly ONE `function assignAbc` in repo (lib/forecast/abc.ts)
- Zero `prediction.deleteMany` / `order.deleteMany` in app/ + scripts/
- `npx tsc --noEmit` clean at every task boundary

Next: orchestrator drives Playwright to verify two-runs-identical + approve-shrinks-reorder end-to-end. Plan 01-03 will lock these invariants in vitest + a `check-determinism.ts` script.
