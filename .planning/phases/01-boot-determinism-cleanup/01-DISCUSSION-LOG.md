# Phase 1: Boot, Determinism & Cleanup — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 01-boot-determinism-cleanup
**Mode:** auto (recommended option auto-selected per gray area)
**Areas discussed:** Postgres host, mulberry32 seed strategy, onOrder schema shape, dev.db scrub method, assignAbc landing location, prediction-history query pattern, .env.example scope, vitest harness inclusion

---

## Postgres Host

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase Postgres | Bundles with Phase 2 Supabase Auth — one project, one billing line, RLS available if ever wanted | ✓ |
| Vercel Postgres | Tight Vercel integration; would mean two providers (Supabase for auth + Vercel for DB) | |
| Neon | Decoupled, branch-friendly; minor mental overhead vs Supabase | |

**Auto rationale:** Phase 2 already mandates Supabase. Co-locating DB removes a moving part and a credential. Vercel/Neon stay viable fallbacks if Supabase Postgres pricing or perf becomes an issue.

---

## Local Database Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres everywhere (Docker locally) | Same DB engine local and prod; no Prisma-feature drift | ✓ |
| Keep SQLite for local dev | Lighter footprint but reintroduces JSON/default/transaction divergence | |

**Auto rationale:** SQLite-vs-Postgres bugs are silent and show up in prod; not worth the footprint saving.

---

## Migration Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| `prisma migrate` with versioned migrations | Real history; CI runs `migrate deploy` | ✓ |
| Keep `prisma db push` | No history; risky once Phase 2+ ships schema changes | |

**Auto rationale:** REQ FND-03 says "real migration history."

---

## dev.db Scrub Method

| Option | Description | Selected |
|--------|-------------|----------|
| `git rm` + `.gitignore`, keep history | Forward-only; no clone breaks | ✓ |
| `git filter-repo` history rewrite | Removes 45 MB from history but breaks every existing clone + force-push to upstream | |

**Auto rationale:** History rewrite is destructive across a shared repo. The 45 MB is in history only; shallow clones and new dev setups are unaffected. Demo data does not warrant the cost.

---

## mulberry32 Seed Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Hash `(productId, runDate ISO date)` via FNV-1a | Same product on same calendar day → same forecast; multiple runs/day match | ✓ |
| Include timestamp in seed | Forecasts diverge by hour even with same inputs; can't compare reruns | |
| Hash `(productId, runDate, tenantId)` | Adds tenant scoping but creates noise across tenants for same product (none today; Phase 2 problem) | |

**Auto rationale:** The phase invariant is "same input → same output"; date-of-day is the right grain.

---

## onOrder Schema Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Scalar fields on `Product` (`onOrder`, `expectedArrivalAt`, `receivedAt`) | Minimal; matches what reorder math reads | ✓ |
| New `IncomingShipment` table | Supports multi-shipment per product; overkill until supplier scorecards |   |

**Auto rationale:** REQ FND-04 specifies exactly these fields. Multi-shipment can land in v1.x.

---

## assignAbc Landing Location

| Option | Description | Selected |
|--------|-------------|----------|
| `lib/forecast/abc.ts` | Sibling to `simulate-layers.ts` and `baseline.ts`; matches existing layout | ✓ |
| `lib/abc.ts` | Top-level lib; loses domain grouping | |
| Inline in `lib/forecast/simulate-layers.ts` | Bloats the contract module | |

**Auto rationale:** Follows the existing `lib/forecast/*` grouping.

---

## Prediction History Query Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Latest `runDate` per `productId` query | Dashboard stays identical from owner's POV; history accumulates underneath | ✓ |
| Filter by `forecastRunId == latestRunId` | Cleaner conceptually but requires propagating run id to dashboard | |

**Auto rationale:** Existing dashboard code reads "latest prediction per product" semantically; preserving that with `ORDER BY runDate DESC LIMIT 1 per product` is the minimal change.

---

## .env.example Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All v1 vars listed with phase TODO markers | One file to audit; Phase 2-5 see what's needed | ✓ |
| Only Phase 1 vars now, add later | Smaller now but creates a moving target across phases | |

**Auto rationale:** REQ FND-07 says "every required environment variable" — interpret broadly; phase markers make it self-documenting.

---

## Vitest Harness Inclusion

| Option | Description | Selected |
|--------|-------------|----------|
| Tiny harness for `rng.ts` + `abc.ts` + `reorder.ts` | ~30 LOC; Phase 2 tenant-isolation test reuses it | ✓ (Claude's Discretion) |
| Defer all testing setup to a later phase | Honors "no test framework phase" out-of-scope rule strictly | |

**Auto rationale:** REQUIREMENTS.md excludes "standalone test framework phase" but explicitly says Vitest gets added inside phases that need it. Phase 1 is the natural beachhead — three pure functions, the determinism acceptance test (`check:determinism`) needs an assertion harness anyway.

---

## Claude's Discretion (auto-resolved)

- Pin Postgres 16.x to match Supabase prod major version.
- Commit cadence: one commit per logical change (RNG, schema, abc, postgres swap, dev.db, env, README).
- No new admin UI for forecast-runs in Phase 1; surface in Phase 5 when drift detection lands.

---

## Deferred Ideas (noted for later)

- Per-supplier shipping mode (sea/air) — Phase 3+ when real PO data flows.
- `Location` entity — Phase 3 with Shopify ingest (per research).
- Token encryption columns — Phase 2/3 when `ShopifyConnection`/`QuickBooksConnection` tables land.
- Multi-shipment tracking — v1.x with supplier scorecards.
- Cleaning `prisma/dev.db` from git history — only if real secret found.
- CI workflow — out of milestone scope.
