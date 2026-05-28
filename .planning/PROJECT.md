# Stock Estimator

## What This Is

A multi-tenant inventory demand-forecasting app for Kenyan retail businesses (starting with beauty/skincare shops). It connects to a shop's source-of-truth systems (Shopify and/or QuickBooks), learns the rhythm of their sales, and tells them what to reorder and when — accounting for payday weeks, holidays, promos, and supplier lead times from places like Guangzhou or Dubai. First real client is Beauty Square (beautysquareke.co), a Shopify + QuickBooks beauty retailer in Nairobi.

## Core Value

**Tell a shop owner exactly what to reorder this week, with enough confidence that they trust the number.** Forecast quality and explainability beat every other feature — if the predictions are wrong or unexplainable, nobody uses the app no matter how polished it looks.

## Requirements

### Validated

<!-- Inferred from existing code in `Kidaup12/stock-estimator` main branch. These ship as the v0 baseline. -->

- ✓ **Multi-tenant Prisma schema** — `Tenant`, `Product`, `SalesHistory`, `Supplier`, `Promo`, `MonthlyContext`, `Prediction`, `Order`, all tenant-scoped with cascade deletes. Source: `prisma/schema.prisma`. — existing
- ✓ **Shopify catalog ingest (mock)** — Mock client at `lib/shopify/client.ts` reads seeded Products; scrape script at `scripts/seed-from-beautysquare.ts` pulls real product/variant data from beautysquareke.co's public Shopify JSON. — existing
- ✓ **Synthetic 365-day sales history** — `scripts/synth-sales-history.ts` generates sales calibrated to Kenya patterns (payday weeks, Jamhuri, Christmas, V-Day, Eid). — existing
- ✓ **Two-layer forecast contract** — `lib/forecast/simulate-layers.ts::simulateLayeredForecast()` is a pure function returning `{layer1Value, layer2Value, signals[]}`. Today it's `Math.random()` math; this is the single swap point for the real Python sidecar. — existing
- ✓ **Reorder math** — Safety stock via King's formula (accounts for variable lead times). Auto-creates pending `Order` rows when urgency is `critical` or `high`. Lives in `app/api/forecast/run/route.ts`. — existing
- ✓ **Dashboard with Urgent / Review / All tabs + product drill-down** — `app/dashboard/`. — existing
- ✓ **Shop onboarding flow** — Lives at `app/settings/page.tsx` (NOT `app/onboarding/` despite the README claim): Shopify connect → Seed catalog → Generate forecasts. — existing
- ✓ **Supplier CRUD with lead-time + MOQ** — `app/suppliers/` + `app/api/suppliers/`. — existing
- ✓ **Promo calendar CRUD** — `app/promos/` + `app/api/promos/` (payday, holiday, flash, GWP). — existing
- ✓ **A/B/C tiering (partial)** — `assignAbc()` heuristic exists, but copy-pasted between `app/api/forecast/run/route.ts` and `scripts/run-forecasts.ts` (drift risk) and no override field. — existing

### Active

<!-- Hypotheses until shipped and validated. Building toward these. -->

#### Trust & ground truth
- [ ] **Existing app boots locally and the mock onboarding → seed → forecast → dashboard flow works end-to-end.** No code changes; establish ground truth before touching anything.
- [ ] **Forecast determinism** — replace `Math.random()` in `lib/forecast/simulate-layers.ts` so the same inputs produce the same outputs. Required before swapping in the real model.

#### Real data sources
- [ ] **Real Shopify OAuth + Admin API ingest** — replace the mock client at `lib/shopify/client.ts` with a real OAuth-installed app that pulls products, variants, inventory levels, and historical orders.
- [ ] **QuickBooks Online connector** — for Beauty Square, QuickBooks is the actual source of truth (Shopify is the storefront, but POS sales land in QB and inventory truth lives there). Pull sales + inventory; merge with Shopify where they overlap.

#### Forecast accuracy
- [ ] **Python FastAPI forecast sidecar** — real SARIMA (statsmodels) + XGBoost residual; drop in behind the `simulateLayeredForecast()` contract. Hosted separately (Railway or similar).
- [ ] **Layer-2 signals beyond mock** — payday, holiday, promo, plus Google Trends Kenya and weather (per README roadmap; defer if scope tightens).

#### Reorder correctness
- [ ] **`onOrder` / incoming-quantity tracking** — current schema has no field for "stock already en route." Reorders double-count today. Add to `Product` schema, surface in dashboard, deduct from reorder math.
- [ ] **A/B/C tiering hardening** — extract `assignAbc()` to `lib/forecast/abc.ts` (kill the duplicate), add `abcOverride` field so owners can pin categories manually.

#### Multi-tenant correctness
- [ ] **Real tenant scoping** — replace 12 occurrences of `prisma.tenant.findFirst()` with session-bound tenant resolution. Today the app silently runs single-tenant; second onboarding overwrites the first.
- [ ] **Auth on every `app/api/*` route** — currently zero auth checks. Add session middleware + per-tenant data isolation.

#### Production readiness
- [ ] **Postgres swap + Vercel deploy** — Prisma provider flip (`sqlite` → `postgresql`), connection string, dev.db scrubbed from git (45MB binary committed today), Vercel env configured.
- [ ] **POS → QuickBooks sync cleanup automation** — separate workflow (likely n8n) that watches the client's POS for sales the QB sync misses and patches them in. ~1 day of work per Anjay; runs independently of the forecasting app.

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Odoo connector** — Anjay flagged it as a future general-purpose target but Beauty Square is Shopify+QuickBooks. Defer until a second client actually needs it.
- **M-Pesa billing** — Roadmap notes it as Milestone 3. Beyond initial scope; revisit after first client is paying outside the app.
- **Multi-channel sales aggregation (WhatsApp / IG / retail)** — README Milestone 3. Out for now; Shopify + QuickBooks is the v1 surface.
- **Real-time inventory sync** — Daily / hourly batched pulls are fine for forecasting cadence. Live webhooks add complexity without a forecasting win.
- **Test framework setup as a phase goal** — No test framework exists today; we'll add light vitest coverage opportunistically inside relevant phases, but standing up CI + a full test suite is not a v1 deliverable.
- **A standalone Python-only deployment** — The TS layer stays the orchestrator; Python is a sidecar called via HTTP, not a replacement.
- **Replacing the existing UI** — The dashboard is good enough for v1. UI polish ships incrementally inside feature phases, not as its own phase.

## Context

**Client + commercial structure.** Roy is subcontracted by Anjay (Simply Done Africa, `simplydoneafrica@gmail.com`) — same arrangement as the LPO automation project for Melvin's Tea. Anjay handles design and client relationships; Roy builds. Standing rule from Anjay: **build everything multi-tenant from day one**; only customize per client at the leaf. The codebase has the schema for this but the runtime breaks it (see "Real tenant scoping" above).

**Target customer.** Beauty Square is the first paying tenant — a Nairobi beauty/skincare/fragrance shop on Shopify with QuickBooks as their accounting + inventory source of truth. They sell via Shopify online, POS in-store, and walk-ins. Owner is Mary; she currently manages ordering by intuition + Excel exports from QuickBooks. The forecasting app is meant to replace the gut-feel restocking with explainable numbers.

**Tech foundation already in place.** Next.js 16 App Router (React 19, server-first), Prisma 6 (SQLite locally, Postgres in prod), Tailwind v4, TypeScript strict, zod for validation. No test framework, no CI. The forecast layers are simulated in TypeScript — `lib/forecast/simulate-layers.ts` returns the same JSON shape the real Python service will produce, so the swap is genuinely one file.

**Codebase map ground truth.** `.planning/codebase/` (committed at `a2b8fe4`) captures the as-built state. Key surprises a fresh reader needs to know:
- The README claims `app/onboarding/` exists. It doesn't. The actual onboarding lives at `app/settings/page.tsx`.
- `lib/forecast/simulate-layers.ts` uses `Math.random()`, so forecasts are non-deterministic — this will bite us in testing.
- Twelve `app/api/*` routes call `prisma.tenant.findFirst()` to resolve "the tenant," so multi-tenancy is broken in practice.
- Zero auth checks anywhere in `app/api/`. Anyone with the URL can hit any route.
- `prisma/dev.db` (45MB) is committed to git — needs to come out before Postgres swap.
- `assignAbc()` is copy-pasted between `app/api/forecast/run/route.ts` and `scripts/run-forecasts.ts`. Drift bomb.
- Hardcoded `"beautysquareke.co"` in the seed script and settings page.

**Forecast methodology.** Two layers. Layer 1 is SARIMA — captures the base seasonal pattern from historical sales. Layer 2 is XGBoost over residuals — accounts for the signals Layer 1 can't model (paydays, holidays, promos, weather, trends). The Python sidecar will run both; the TS app stores the outputs and surfaces them with explanations.

## Constraints

- **Timeline**: Anjay said "today/tomorrow" for kickoff (2026-05-28 call). Phase 1 is intentionally minimal so we move fast. — Client expectation; he uses urgency-style "casual work" framing.
- **Tech stack**: Next.js 16 + Prisma + TypeScript for the app; Python FastAPI + statsmodels + xgboost for the forecast sidecar (must be separate service, not in-process). — Inherited from existing repo + README roadmap.
- **Multi-tenant from day one**: Every new feature must respect tenant isolation. — Anjay's standing rule for all Simply Done builds.
- **Forecast contract**: `simulateLayeredForecast()` JSON shape is the API boundary. The Python service must match it exactly so the swap is a one-file change. — Repo design intent.
- **Source of truth conflict**: For Beauty Square, QuickBooks beats Shopify for sales and inventory truth. Designs that assume Shopify is canonical will break. — Per call.
- **Hosting**: Vercel for the Next.js app, Postgres (Vercel/Neon) for the DB, separate host (Railway likely) for the Python sidecar. — README + standard Roy stack.
- **Dependency**: Anjay is fetching Shopify and QuickBooks sandbox/test credentials. Real-data phases can't start without them. — Stated in call.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use the existing `Kidaup12/stock-estimator` repo as the v0 baseline rather than starting fresh | Schema, dashboard, mock harness, and forecast contract are already designed thoughtfully — rebuilding would burn days for no win | — Pending |
| `wezesha/stock-estimator/` is the working folder; planning artifacts live inside that repo so they push back to upstream | Roy has direct collaborator access; one repo is simpler than a fork + planning sidecar | — Pending |
| Coarse granularity (3-5 broad phases) over fine | Anjay wants speed; each phase still meaningful but tighter than a typical greenfield decomposition | — Pending |
| QuickBooks is the source of truth for Beauty Square, Shopify is secondary | Confirmed in call — POS sales bypass Shopify and land in QB, inventory truth lives in QB | — Pending |
| Forecast layers stay in a Python sidecar called via HTTP, not embedded in Next.js | statsmodels + xgboost ergonomics; lets the data team iterate on models without touching the app | — Pending |
| POS→QuickBooks sync cleanup is a separate workflow (likely n8n), not part of the main app | Anjay framed it as ~1 day "casual" work; coupling it to the forecasting app would slow both | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-28 after initialization*
