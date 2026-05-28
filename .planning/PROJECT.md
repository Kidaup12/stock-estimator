# Wezesha Restock OS

## What This Is

A multi-tenant stock-replenishment intelligence platform for Kenyan beauty retailers on Shopify. It forecasts demand, recommends reorder quantities, and emails ready-to-send Purchase Orders to suppliers — accounting for payday weeks, public holidays, promos, and supplier lead times from places like Guangzhou or Dubai. SimplyDone Africa is the vendor; Beauty Square (beautysquareke.co), a Shopify + QuickBooks beauty retailer in Nairobi, is the first paying customer. A working single-tenant demo lives in this repo; the engagement converts it into a multi-tenant SaaS production system.

## Core Value

**Tell a shop owner exactly what to reorder this week, generate the PO, and email it to the right supplier — with enough confidence that they trust the number.** Forecast quality + reorder correctness + the supplier handoff are the trio that earns the seat. If the predictions are wrong, the on-order math double-counts, or the PO bounces in the supplier's inbox, the product fails no matter how polished the UI looks.

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

<!-- Hypotheses until shipped and validated. Building toward these. Driven by the SimplyDone SOW (2026-05-28). -->

#### Foundations
- [ ] **Existing app boots locally and the mock onboarding → seed → forecast → dashboard flow works end-to-end.** No code changes; establish ground truth before touching anything.
- [ ] **Forecast determinism** — replace `Math.random()` in `lib/forecast/simulate-layers.ts` with a seeded RNG (mulberry32, keyed on `(productId, runDate)`). Required so model swap tests have a stable baseline.
- [ ] **Postgres migration** — Prisma `provider = "postgresql"`, real migration history (`prisma migrate`), `prisma/dev.db` (45MB) removed from git, connection string via env, Vercel-ready.
- [ ] **Supabase Auth integration** — email + magic link primary, optional Google OAuth, session middleware for the App Router, replaces the absent auth layer on every `app/api/*` route.
- [ ] **Multi-tenant tenant resolution** — path-based `/shop/[slug]/...` routing, middleware-injected tenant context, `getTenantId()` helper, eliminate all 12 `prisma.tenant.findFirst()` calls. Webhooks get a narrow domain/realmId resolver.
- [ ] **A/B/C tiering hardening** — extract `assignAbc()` to `lib/forecast/abc.ts` (kill the API-vs-script duplicate), add `abcOverride` field so owners can pin categories.
- [ ] **`onOrder` / incoming-quantity tracking** — schema fields on `Product` (and/or PO line items): `quantityOrdered`, `expectedArrivalAt`, `receivedAt`. Surface in dashboard. Reorder math deducts from recommended quantity.
- [ ] **Per-tenant timezone** (default `Africa/Nairobi`) stored on `Tenant`, applied to all date-bucketing in forecast + reorder windows.
- [ ] **Per-supplier currency + KES conversion** — `Supplier.currency` field, FX rate at PO creation captured on the PO line, display in KES for the dashboard.
- [ ] **Concurrent-rerun protection** — forecast runs and webhook batch jobs can't double-fire for the same tenant; advisory lock or `JobRun` table with status enum.
- [ ] **Audit log** — append-only table capturing who-did-what-when (PO approvals, supplier edits, override changes, tenant settings).
- [ ] **Sentry monitoring** wired into both the Next.js app and the Python sidecar, with tenant tag on every event.

#### Real data ingest
- [ ] **Real Shopify integration** — public-app OAuth installation flow (per-tenant), Admin API ingest for products/variants/inventory_levels/historical orders (Bulk Operations for backfill), real-time webhook sync for `products/*`, `inventory_levels/update`, `orders/*`, HMAC signature verification, idempotency on replay (dedupe on `X-Shopify-Webhook-Id`), nightly reconcile cron.
- [ ] **QuickBooks Online integration** — per-tenant OAuth, refresh-token rotation handled in a single Prisma transaction (rotation-on-refresh is destructive in QBO), push approved PO as a `PurchaseOrder` object to QBO, vendor reconciliation by name with a user prompt on ambiguous matches, graceful fallback to PDF/XLSX delivery when QBO is not connected.
- [ ] **Odoo integration** — second commerce-platform connector, same OAuth + ingest pattern as Shopify; required by SOW for SimplyDone's broader customer base even though Beauty Square is Shopify-only.

#### Forecast engine
- [ ] **Python FastAPI forecast sidecar** — separate service hosted on Railway, JWT-authed, stateless per request, called via HTTP behind the existing `simulateLayeredForecast()` contract. TS fallback to the mock simulator on 5xx with a warning surfaced in `signals[]`.
- [ ] **SARIMA baseline** (statsmodels SARIMAX) for SKUs with sufficient sales history.
- [ ] **Croston / TSB** for intermittent/sparse-sales SKUs.
- [ ] **Cold-start heuristic** for SKUs with under 30 days of data (category mean + tier blending).
- [ ] **XGBoost adjustment layer** for promo lift, payday spikes, and holidays — residual-style.

#### Purchase orders + supplier handoff
- [ ] **Purchase Order generation — PDF (email-attachable) and XLSX, grouped by supplier.** Localized to tenant timezone and supplier currency.
- [ ] **PO approval flow** — owner reviews, edits quantities, approves; approval triggers email + (if connected) QBO push.
- [ ] **Email delivery via Resend** — supplier receives the PO email with PDF/XLSX attached, tenant gets a confirmation. Bounce/error handling routes back to the dashboard.
- [ ] **CSV exports** — reorder recommendations, current stock snapshot, sales history. Per-tenant, downloadable from the dashboard.

#### Operations
- [ ] **Handover documentation** — architecture diagram, deployment runbook (Next.js → Vercel, Postgres → Vercel/Neon, Python → Railway, Supabase project), known edge cases, day-2 operational playbook (token rotation, webhook backfill, forecast rerun, tenant onboarding).

#### Adjacent (Anjay-flagged, separate scope but tracked)
- [ ] **POS → QuickBooks sync cleanup automation** — Beauty Square's POS sales sometimes bypass QB. n8n workflow (separate from this app) detects gaps and patches them. Anjay framed it as ~1 day of "casual" work; runs independently.

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **M-Pesa billing** — SOW does not include it; tenant billing happens outside the app for v1.
- **Multi-channel sales aggregation (WhatsApp / IG / retail walk-ins beyond POS-into-QB)** — README Milestone 3. Out for v1; Shopify + QuickBooks + Odoo is the v1 surface.
- **Real-time inventory sync to suppliers** — POs are emailed/pushed-to-QBO at approval time; we don't broadcast live stock levels outward.
- **Test framework setup as a standalone phase** — Vitest gets added inside the phases that need it (especially forecast math and tenant scoping); no separate "set up testing" phase.
- **Standalone Python-only deployment** — TS app stays the orchestrator and writer; Python is a sidecar called via HTTP, not a replacement.
- **Replacing the existing UI shell** — Dashboard layout is good enough for v1. UI work ships inside feature phases (PO viewer, approval flow, supplier table), not as a redesign.
- **Open-to-Buy budgeting, scenario planning, BOM/manufacturing, public API, forecast-model-selection UI** — per Features research, these are scope-creep traps for SMB forecasting tools; explicitly excluded.
- **Real-time webhook → forecast retrigger** — forecasts re-run on a schedule (and on-demand). Per-event re-forecast is overkill.

## Context

**Client + commercial structure.** Roy is subcontracted by Anjay (Simply Done Africa, `simplydoneafrica@gmail.com`) — same arrangement as the LPO automation project for Melvin's Tea. Anjay handles design and client relationships; Roy builds. The product brand is **Wezesha Restock OS**. Standing rule from Anjay: build everything multi-tenant from day one; only customize per client at the leaf. The repo has the schema for this but the runtime breaks it (12 `prisma.tenant.findFirst()` calls); fixing that is a Phase 2 prerequisite.

**Target customer (first paying tenant).** Beauty Square is a Nairobi beauty/skincare/fragrance shop. Owner is Mary. They sell via Shopify online, Vend/Shopify POS in-store, and walk-ins. Inventory + accounting truth lives in QuickBooks Online; Shopify is the storefront. Mary currently manages ordering by intuition + Excel exports from QB. The platform replaces gut-feel restocking with explainable numbers + ready-to-send POs.

**Tech foundation already in place.** Next.js 16 App Router (React 19, server-first), Prisma 6 (SQLite locally — must move to Postgres), Tailwind v4, TypeScript strict, zod for validation. No test framework, no CI. The forecast layers are simulated in TypeScript — `lib/forecast/simulate-layers.ts` returns the same JSON shape the real Python service will produce, so the swap is genuinely one file.

**Codebase map ground truth.** `.planning/codebase/` (committed at `a2b8fe4`) captures the as-built state. Surprises a fresh reader needs to know:
- The README claims `app/onboarding/` exists. It doesn't. Onboarding lives at `app/settings/page.tsx`.
- `lib/forecast/simulate-layers.ts` uses `Math.random()`, so forecasts are non-deterministic — bites in testing.
- Twelve `app/api/*` routes call `prisma.tenant.findFirst()`. Multi-tenancy is broken in practice.
- Zero auth checks anywhere in `app/api/`. Anyone with the URL can hit any route.
- `prisma/dev.db` (45MB) is committed to git — needs to come out before Postgres swap.
- `assignAbc()` is copy-pasted between `app/api/forecast/run/route.ts` and `scripts/run-forecasts.ts`. Drift bomb.
- Hardcoded `"beautysquareke.co"` in the seed script and settings page.
- No `onOrder` / incoming-quantity field — reorders systematically double-count stock already en route from Guangzhou/Dubai.

**Forecast methodology.** Four model regimes selected per SKU based on history shape:
- **SARIMA (SARIMAX)** for SKUs with enough seasonal history.
- **Croston / TSB** for intermittent / sparse-sales SKUs.
- **Cold-start heuristic** (category mean + ABC-tier blending) for SKUs with under 30 days of data.
- **XGBoost adjustment layer** layered over whichever baseline ran, modelling promo lift, payday spikes, and holiday effects.
The Python sidecar runs all four; the TS app stores outputs and surfaces the per-SKU regime + signals in the dashboard.

**Source-of-truth strategy.** Per-field priority + append-only `SourceClaim` ledger (Architecture research). For Beauty Square: QB wins on cost / on-hand inventory / POS-sales / suppliers; Shopify wins on catalog / price / online-sales. Last-write-wins is rejected (revert hazard). Conflicts are auditable, not silent.

**Ingest strategy.** Shopify: webhooks primary, nightly reconcile. QuickBooks: CDC polling every 15-60min primary, webhooks only as a latency shortener (QB webhooks are flaky). `IngestCursor` table for resumability.

**Tenant routing.** Path-based `/shop/[slug]/...` for v1 (~2 hours of middleware work). Subdomain routing is a future Milestone 2 thing — DNS round-trip not worth it now.

## Constraints

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

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use the existing `Kidaup12/stock-estimator` repo as the v0 baseline rather than starting fresh | Schema, dashboard, mock harness, and forecast contract are already designed thoughtfully — rebuilding would burn days for no win | — Pending |
| `wezesha/stock-estimator/` is the working folder; planning artifacts live inside that repo so they push back to upstream | Roy has direct collaborator access; one repo is simpler than a fork + planning sidecar | — Pending |
| Coarse granularity (3-5 broad phases) over fine | Anjay wants speed; each phase still meaningful but tighter than typical greenfield decomposition | — Pending |
| **Auth = Supabase**, NOT Better Auth | SOW mandates Supabase (email/magic-link + optional Google). Better Auth was Stack-research recco; SOW overrides | — Pending |
| **QuickBooks role = OUTBOUND PO push** (not inbound sales source-of-truth) | SOW is clear: push approved POs into QBO as `PurchaseOrder`, with vendor name reconciliation; fall back to PDF/XLSX if QBO not connected. Inbound QB sales-truth was my inference, not the SOW | — Pending |
| **Odoo connector IS in scope** | SOW lists it as a deliverable; serves SimplyDone's broader customer base even though Beauty Square is Shopify-only | — Pending |
| **Four forecast regimes**: SARIMA + Croston/TSB + cold-start + XGBoost adjustment | SOW specifies exactly these four. Per-SKU regime selection based on history shape | — Pending |
| **PO format = PDF + XLSX, grouped by supplier**, delivered via Resend | SOW mandate. PDF for human reading + email; XLSX for supplier systems | — Pending |
| Path-based `/shop/[slug]/...` tenant routing for v1, subdomain deferred | ~2h of middleware vs ~1d + DNS; subdomain is a Milestone 2 nice-to-have | — Pending |
| Per-field source-of-truth priority + append-only `SourceClaim` ledger (not last-write-wins) | LWW reverts legitimate Mary edits + can oversell on POS-only sales (Architecture research) | — Pending |
| Python sidecar = stateless per-request, no DB access; Next.js POSTs history inline | Feature store is premature for v1 batch forecasting; revisit if real-time per-SKU re-forecast becomes a requirement | — Pending |
| Forecast determinism via `mulberry32` keyed on `(productId, runDate)` before any model swap | Math.random outputs are non-reproducible; can't tell model improvements from noise without a stable baseline | — Pending |
| POS→QuickBooks sync cleanup runs as n8n workflow outside this app | Anjay framed it as ~1 day "casual" work; coupling to the main app would slow both | — Pending |

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
*Last updated: 2026-05-28 after SOW integration*
