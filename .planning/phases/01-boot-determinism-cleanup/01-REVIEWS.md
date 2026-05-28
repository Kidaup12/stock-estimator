---
phase: 1
reviewers: [codex]
reviewer_notes:
  codex: "gpt-5.5 via codex-cli 0.125.0, sandbox=read-only, reasoning=high"
skipped:
  claude: "running inside Claude session — skipped for independence"
  gemini: "not installed on host"
reviewed_at: 2026-05-28
plans_reviewed:
  - 01-01-PLAN.md
  - 01-02-PLAN.md
  - 01-03-PLAN.md
---

# Cross-AI Plan Review — Phase 1: Boot, Determinism & Cleanup

Single-reviewer (Codex) cross-AI review of the three Phase 1 plans against PROJECT.md, ROADMAP.md, REQUIREMENTS.md, CONTEXT.md, and RESEARCH.md.

## Codex Review

**Summary**
These plans are close, but I would not execute them as-is. Confidence: **MEDIUM** after fixes, **LOW-MEDIUM** as written. They cover the Postgres swap, deterministic RNG, ABC extraction, and append-only predictions well, but they miss the actual `onOrder` approval feedback loop required by the phase goal and contain at least one implementation bug that will likely fail TypeScript.

**Strengths**
- Clear phase boundary: no auth, real integrations, tenant routing, or UI redesign creep.
- Good Postgres direction: `DATABASE_URL` / `DIRECT_URL`, two migration concept, Docker Postgres, `.env.example`, and `dev.db` removal are well scoped.
- The `Math.random()` audit is unusually concrete and catches the biased shuffle in `scripts/synth-sales-history.ts`.
- Extracting `assignAbc()` and reorder math into `lib/forecast/abc.ts` and `lib/forecast/reorder.ts` is the right cleanup.
- Vitest plus `scripts/check-determinism.ts` gives Phase 5 a useful model-swap safety net.

**Concerns**
- **HIGH:** `onOrder` is not updated when an order is approved, so success criterion #4 is not actually achieved. The roadmap requires "after running a forecast and approving an order" the next run does not re-recommend the SKU ([`.planning/ROADMAP.md:26`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/ROADMAP.md:26)). Plan 02 only subtracts `p.onOrder` during forecast ([`01-02-PLAN.md:470`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:470), [`01-02-PLAN.md:477`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:477)); Plan 03 then manually bumps `Product.onOrder` in SQL after approval ([`01-03-PLAN.md:388`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-03-PLAN.md:388), [`01-03-PLAN.md:391`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-03-PLAN.md:391)). Current approval code only updates `Order.status` / `approvedAt` ([`app/api/orders/[id]/approve/route.ts:9`](C:/Users/ROY/Documents/wezesha/stock-estimator/app/api/orders/[id]/approve/route.ts:9), [`app/api/orders/[id]/approve/route.ts:12`](C:/Users/ROY/Documents/wezesha/stock-estimator/app/api/orders/[id]/approve/route.ts:12)).
- **HIGH:** The `synth-sales-history.ts` RNG rewrite plan will likely introduce undefined `rng` references. Existing `poissonSample()` and `rankToBaseRate()` are top-level functions ([`scripts/synth-sales-history.ts:6`](C:/Users/ROY/Documents/wezesha/stock-estimator/scripts/synth-sales-history.ts:6), [`scripts/synth-sales-history.ts:18`](C:/Users/ROY/Documents/wezesha/stock-estimator/scripts/synth-sales-history.ts:18)), but Plan 02 creates `const rng = mulberry32(SYNTH_SEED)` inside `synth()` ([`01-02-PLAN.md:320`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:320)) and then says to replace line 13 with `p *= rng();` ([`01-02-PLAN.md:327`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:327)). Those helpers cannot see a function-local `rng`.
- **MEDIUM:** Latest-dashboard query is not batch-safe. Plan 02 writes a new `forecastRunId` ([`01-02-PLAN.md:439`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:439), [`01-02-PLAN.md:453`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:453)) but dashboard selection ignores it and uses max `runDate` per product ([`01-02-PLAN.md:499`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:499), [`01-02-PLAN.md:515`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:515)). Because each prediction gets `runDate: new Date()` independently ([`01-02-PLAN.md:451`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-02-PLAN.md:451)), the dashboard can mix rows across runs after partial failure or overlap.
- **MEDIUM:** FND-01's pre-change baseline is skipped. Requirement says the existing app boots "with no code changes" ([`.planning/REQUIREMENTS.md:12`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/REQUIREMENTS.md:12)); research says this must be the first plan task before any change ([`01-RESEARCH.md:48`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-RESEARCH.md:48)). Plan 01 starts by editing compose/env/gitignore ([`01-01-PLAN.md:173`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-01-PLAN.md:173)) and only runs boot after migration work ([`01-01-PLAN.md:335`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-01-PLAN.md:335)).
- **MEDIUM:** `Prediction.forecastRunId String` with no default is migration-fragile for any non-empty Postgres database. The plan explicitly adds a required field ([`01-01-PLAN.md:309`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-01-PLAN.md:309)) and expects `ALTER TABLE ... ADD COLUMN "forecastRunId"` ([`01-01-PLAN.md:322`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-01-PLAN.md:322)). Fresh DB is fine; any existing predictions will fail unless nullable/backfilled/defaulted.
- **LOW:** Verification commands are Bash-heavy in a Windows/PowerShell repo context: `test`, `grep`, command substitution, `wc` ([`01-03-PLAN.md:418`](C:/Users/ROY/Documents/wezesha/stock-estimator/.planning/phases/01-boot-determinism-cleanup/01-03-PLAN.md:418)). Expect friction unless the executor always runs under Git Bash/WSL.

**Suggestions**
- Add a Plan 02 task for `app/api/orders/[id]/approve/route.ts`: in a transaction, load order + prediction + product, guard idempotency if already approved, update order, and increment `Product.onOrder` by `ceil(prediction.recommendedQty)`.
- Replace the manual `psql UPDATE Product SET onOrder = 9999` verification with an API/UI approval verification that proves approval itself updates `onOrder`.
- Fix RNG helpers by passing `rng` into `poissonSample(lambda, rng)` and `rankToBaseRate(rank, total, rng)`, or use a resettable module-scope RNG intentionally.
- Use `forecastRunId` for dashboard consistency. Minimal version: determine the latest completed `forecastRunId` for the tenant and fetch only that batch. Better version: add a `ForecastRun` table with status and only show `completed` runs.
- Add a true Task 0: run current SQLite app before edits, seed, generate forecasts, dashboard screenshot/log. Then start Postgres changes.
- Make `forecastRunId` migration safe: nullable + backfill + make required later, or `@default(uuid())` if route-supplied IDs are not mandatory for old rows.
- Convert verification to `npm` scripts or PowerShell-compatible commands.

**Risk Assessment**
**MEDIUM-HIGH**: the core architecture is sound, but the approval/on-order gap means the phase's most business-critical correctness criterion is not met.

**Go / No-Go**
**Execute with changes.** Do not send back for full replan; patch the specific issues above first, especially approval updating `Product.onOrder` and the `synth-sales-history.ts` RNG scoping bug.

---

## Consensus Summary

Single reviewer (Codex) — no consensus calculation possible. Both Claude (current runtime, skipped for independence) and Gemini (not installed) were unavailable. The findings below are Codex's solo verdict; treat them as a strong second opinion, not a triangulated one.

### Headline (must fix before execute)

1. **`onOrder` never goes up.** Plan 02 subtracts `p.onOrder` during forecast and Plan 03's "verification" manually bumps the column via `psql UPDATE`, but **no plan wires the increment into `app/api/orders/[id]/approve/route.ts`**. Success criterion #4 ("approving an order causes the next forecast to NOT re-recommend") is therefore not satisfied by the code the plans actually produce — only by the `psql` cheat in the verify step. *(HIGH)*

2. **`synth-sales-history.ts` RNG scoping is broken.** Plan 02 introduces `const rng = mulberry32(SYNTH_SEED)` *inside* `synth()`, then instructs to replace `Math.random()` calls in top-level helpers `poissonSample()` and `rankToBaseRate()` — which cannot see the function-local variable. Will fail TypeScript or run on `undefined`. *(HIGH)*

### Worth fixing before execute

3. **Dashboard "latest per product" query uses `max(runDate)` instead of `forecastRunId`.** Each prediction in a run gets a fresh `new Date()`, so a partial-failure or overlapping run can interleave rows on the dashboard. Pin to the latest completed `forecastRunId` per tenant. *(MEDIUM)*

4. **`Prediction.forecastRunId String` (required, no default) is migration-fragile.** Fresh DB is fine; an existing one with predictions will hit a NOT-NULL violation. Make nullable + backfill, OR add `@default(cuid())` at the schema level. *(MEDIUM)*

5. **No pre-change baseline run.** FND-01 says "no code changes" — but Plan 01 starts editing compose/env/gitignore before any verification that the current SQLite app boots. Add a Task 0 that captures the as-is state first. *(MEDIUM)*

### Nit but worth knowing

6. **Bash verification commands** (`test`, `grep`, `wc`, command substitution) on a Windows host. Either commit to Git Bash/WSL execution or convert to npm scripts. *(LOW)*

### Codex's bottom line

**Execute with changes** — not a full replan. Patch the 6 issues above (especially #1 and #2 which are real bugs), then run Phase 1.

### Divergent views

None — only one reviewer ran.

---

## Status — patches applied inline (2026-05-28)

Plans patched by hand instead of `--reviews` rerun. Specific edits:

| Finding | Patched in | Change |
|---|---|---|
| HIGH #1 — onOrder never goes up | `01-02-PLAN.md` new Task 2.5 | `app/api/orders/[id]/approve/route.ts` rewritten in `prisma.$transaction` with `onOrder: { increment }` and idempotency guard via `alreadyApproved` |
| HIGH #2 — synth RNG scoping | `01-02-PLAN.md` Task 2.B | `poissonSample(lambda, rng)` and `rankToBaseRate(rank, total, rng)` signatures take `rng` as a parameter; all call sites inside `synth()` updated |
| MED #3 — dashboard query mixes runs | `01-02-PLAN.md` Task 3.B | Two-step `findFirst({forecastRunId}) → findMany({forecastRunId})` replaces `groupBy + max(runDate)` |
| MED #4 — forecastRunId migration | `01-01-PLAN.md` Task 2.E + must_haves | `forecastRunId String @default(cuid())` |
| MED #5 — no pre-change baseline | `01-01-PLAN.md` new Task 0 | Read-only boot of SQLite app + mock flow to capture as-is state before any edit |
| LOW #6 — Bash verifications | Deferred | Plan 03 verify still uses Bash blocks; acceptable for Roy's Git Bash setup |

Re-verification path: run `/gsd:execute-phase 1` directly. The plans now match what gets shipped.
