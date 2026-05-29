# Roadmap: Wezesha Restock OS

**Created:** 2026-05-28
**Granularity:** coarse (5 phases)
**Coverage:** 67/67 v1 requirements mapped
**Source of phase ordering:** research/SUMMARY.md §6 (all 4 research streams converged)

## Phases

- [ ] **Phase 1: Boot, Determinism & Cleanup** — Make the existing app deterministic and Postgres-backed so every later phase has a stable, reproducible baseline.
- [ ] **Phase 2: Multi-Tenant Auth & Tenant Routing** — Supabase Auth + path-based `/shop/[slug]/` routing + `requireTenant()` chokepoint so cross-tenant leak becomes impossible.
- [ ] **Phase 3: Real Shopify Ingest + Odoo** — Replace mock Shopify client with real OAuth + Bulk Operations backfill + HMAC-verified webhooks + nightly reconcile; second commerce connector (Odoo) mirrors the pattern.
- [ ] **Phase 4: QuickBooks + Source-of-Truth Merge + PO Delivery** — QBO OAuth + atomic refresh-rotation + CDC polling, per-field source-of-truth merge layer with `SourceClaim` ledger, PDF/XLSX PO generation, Resend email, QBO `PurchaseOrder` push with vendor reconciliation.
- [ ] **Phase 5: Python Forecast Sidecar + Operations + Handover** — Railway FastAPI sidecar with 4 regimes (SARIMA + Croston/TSB + cold-start + XGBoost adjustment), drift observability, A/B/C lifecycle hardening, audit log, and handover documentation.

## Phase Details

### Phase 1: Boot, Determinism & Cleanup
**Goal**: Existing app boots locally on Postgres with deterministic forecast output and the schema fields every later phase needs.
**Depends on**: Nothing
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07
**Success Criteria** (what must be TRUE):
  1. Running `npm install && npx prisma migrate dev && npm run db:seed && npm run dev` against a fresh Postgres database opens the dashboard with seeded Beauty Square products visible.
  2. Clicking "Generate forecasts" twice in a row produces identical `layer1Value`, `layer2Value`, and `signals[]` for every product (mulberry32 deterministic, no `Math.random()`).
  3. `git log -- prisma/dev.db` shows the SQLite file removed from history; `prisma/schema.prisma` uses `provider = "postgresql"` and `url = env("DATABASE_URL")`; `.env.example` lists every variable a fresh clone needs.
  4. After running a forecast and approving an order, the next forecast run does NOT re-recommend the same SKU — because `Product.onOrder` is subtracted from the reorder math.
  5. Predictions from two consecutive runs both exist in the DB (no `deleteMany`), tagged with distinct `forecastRunId`; dashboard shows the latest per product; `assignAbc()` is imported from `lib/forecast/abc.ts` by both the API route and the script.
**Plans**: 3 plans
- [x] 01-01-PLAN.md — Postgres migration + schema deltas + dev.db scrub + env.example + README
- [x] 01-02-PLAN.md — Forecast determinism (mulberry32) + abc/reorder extraction + append-only predictions
- [x] 01-03-PLAN.md — Vitest harness + check-determinism + Phase 1 sanity boot (human verification)
**UI hint**: no

### Phase 2: Multi-Tenant Auth & Tenant Routing
**Goal**: Two real tenants can coexist in the same Postgres database with zero cross-contamination, accessed via authenticated `/shop/[slug]/` URLs.
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, TNT-01, TNT-02, TNT-03, TNT-04, TNT-05, TNT-06, TNT-07, TNT-08
**Success Criteria** (what must be TRUE):
  1. A new user signs up via Supabase email + magic link (or Google OAuth), lands on their tenant dashboard at `/shop/[slug]/`, and the session survives a browser refresh and a logout/login cycle.
  2. Hitting any `app/api/*` route without a valid Supabase session returns 401; hitting `/shop/tenant-a/` while logged in as Tenant B returns 403.
  3. Seeding a second tenant (`beauty-square-2`) and running the two-tenant integration test confirms Tenant A cannot read or mutate Tenant B's `Product`, `SalesHistory`, `Supplier`, `Promo`, `Prediction`, or `Order` rows.
  4. `grep -r "prisma.tenant.findFirst" app/api/` returns zero matches; all 12 original callsites now route through `requireTenant()`, and the ESLint rule blocks bare `prisma.*.findMany()` without `tenantId` in CI.
  5. The cache helper at `lib/cache/tenant-cache.ts` automatically scopes keys + tags by `tenantId`; forecasts run in the tenant's `Tenant.timezone` (default `Africa/Nairobi`).
**Plans**: 6 plans
- [ ] 02-01-PLAN.md — Schema: Tenant.slug + timezone + Membership + Role enum (2-step migration) + slugify
- [ ] 02-02-PLAN.md — Supabase Auth wiring: 3 cookie clients + middleware session refresh + /login + auth callback + signout
- [ ] 02-03-PLAN.md — requireTenant() chokepoint + middleware header injection + 16 findFirst migrations + move pages under /shop/[slug] + webhook resolver
- [ ] 02-04-PLAN.md — Tenant timezone date helper + thread runDateKey through seed/bucket (determinism-safe) + tz determinism test
- [ ] 02-05-PLAN.md — Beauty Square backfill + Create-your-shop onboarding + root membership redirect
- [ ] 02-06-PLAN.md — tenant-safety ESLint rule + 2-tenant isolation test + tenant-scoped cache helper
**UI hint**: yes

### Phase 3: Real Shopify Ingest + Odoo
**Goal**: Beauty Square's real Shopify store is the source of catalog, inventory, and 365 days of order history — kept in sync by webhooks + nightly reconcile. Odoo connector ships in the same pattern.
**Depends on**: Phase 2
**Requirements**: SHOP-01, SHOP-02, SHOP-03, SHOP-04, SHOP-05, SHOP-06, SHOP-07, SHOP-08, SHOP-09, ODOO-01, ODOO-02, ODOO-03, ODOO-04, ODOO-05
**Success Criteria** (what must be TRUE):
  1. Owner clicks "Connect Shopify" from `/shop/[slug]/settings`, completes the Shopify OAuth installation flow, and returns to the dashboard with the offline access token encrypted at rest on `ShopifyConnection`.
  2. On first connect, 365 days of historical orders + all products/variants + `on_hand` inventory levels (not `available`) are backfilled via Bulk Operations and visible in the dashboard within the documented backfill window.
  3. Editing a product price in Shopify Admin propagates to the dashboard within seconds via webhook; deleting a product in Shopify removes it from the local catalog; `X-Shopify-Webhook-Id` replay is a no-op.
  4. Forcing a webhook miss (kill the handler, edit in Shopify, restart) and running the nightly reconcile cron catches the delta via `IngestCursor`; uninstalling the Shopify app from the merchant side clears tokens but preserves tenant data.
  5. The same OAuth → ingest → polling pattern works for Odoo: owner connects from settings, products + inventory + sales orders ingest and stay synced via the same `IngestCursor` resumability model.
**Plans**: TBD
**UI hint**: yes

### Phase 4: QuickBooks + Source-of-Truth Merge + PO Delivery
**Goal**: Approved POs land in the supplier's inbox (PDF + XLSX via Resend) and in QuickBooks Online as a `PurchaseOrder`. Per-field source-of-truth merge resolves Shopify vs QB conflicts auditably.
**Depends on**: Phase 3
**Requirements**: QB-01, QB-02, QB-03, QB-04, QB-05, QB-06, QB-07, MRG-01, MRG-02, MRG-03, MRG-04, PO-01, PO-02, PO-03, PO-04, PO-05, PO-06, PO-07, PO-08, CSV-01, CSV-02, CSV-03
**Success Criteria** (what must be TRUE):
  1. Owner connects QuickBooks Online from settings; `CompanyInfo` is fetched first and surfaces the detected `Tenant.baseCurrency` for confirmation; refresh-token rotation under concurrent requests never produces an `invalid_grant`.
  2. Owner reviews reorder recommendations grouped by supplier, edits quantities, hits Approve — a supplier-specific PDF + XLSX PO is generated (tenant timezone, supplier currency, KES totals) and emailed via Resend with the tenant cc'd; Resend bounces appear as actionable banners on the dashboard.
  3. With QBO connected, the same approval pushes a `PurchaseOrder` to QBO; vendor reconciliation by name prompts the owner once on ambiguous match and remembers the mapping; without QBO, the email-only delivery is the entire output.
  4. Inventory updates from both Shopify and QuickBooks land via `applyClaim()` and produce `SourceClaim` ledger rows; flipping `Tenant.sourcePriorities` in the settings UI changes which source wins per field; direct upserts from ingest clients no longer exist.
  5. Owner can download three CSVs from the dashboard — reorder recommendations, current stock snapshot per location, and sales history within a date range — all tenant-scoped.
**Plans**: TBD
**UI hint**: yes

### Phase 5: Python Forecast Sidecar + Operations + Handover
**Goal**: The TS forecast simulator is replaced by a Railway-hosted Python sidecar running four real regimes against merged Shopify+QB data, with audit + drift observability + handover docs that let Anjay's team operate it day-2.
**Depends on**: Phase 4
**Requirements**: FCT-01, FCT-02, FCT-03, FCT-04, FCT-05, FCT-06, FCT-07, FCT-08, FCT-09, ABC-01, ABC-02, ABC-03, OPS-01, OPS-02, OPS-03, OPS-04, HND-01, HND-02, HND-03, HND-04
**Success Criteria** (what must be TRUE):
  1. The forecast run route POSTs to the Python sidecar on Railway, the sidecar selects SARIMA / Croston-TSB / cold-start per SKU by ADI/CV² + history length, applies the XGBoost adjustment layer for promo/payday/holiday lift, and returns a `ForecastResult` that matches the TS `simulateLayeredForecast()` JSON shape (validated by Zod at the TS boundary with `contract_version`).
  2. Killing the sidecar mid-run causes the TS app to fall back to the deterministic mock with a warning signal appended to `signals[]`; a second forecast for the same tenant while one is in flight is rejected or queued via `JobRun`; `forecastRunId`, `regime`, and `confidence` are persisted on every prediction.
  3. Owner can pin a product's ABC class from the product drill-down (`abcOverride` wins over the heuristic) and tag its lifecycle stage (`NEW` / `MATURE` / `EOL`), which feeds into the regime selection.
  4. Every PO approval, supplier edit, ABC override, tenant-settings change, and integration connect/disconnect appears in `AuditLog`; Sentry events from both the Next.js app and the Python sidecar carry a `tenant_id` tag; the forecast page renders from local DB with a "Last synced N hours ago" banner when sidecar or upstream APIs are unreachable.
  5. `docs/architecture.md`, `docs/deployment.md`, `docs/edge-cases.md`, and `docs/operations.md` exist and a fresh engineer can follow the deployment runbook to stand up Next.js → Vercel + Postgres + Python → Railway + Supabase from scratch.
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Boot, Determinism & Cleanup | 2/3 | In Progress|  |
| 2. Multi-Tenant Auth & Tenant Routing | 0/6 | Not started | - |
| 3. Real Shopify Ingest + Odoo | 0/TBD | Not started | - |
| 4. QuickBooks + Source-of-Truth Merge + PO Delivery | 0/TBD | Not started | - |
| 5. Python Forecast Sidecar + Operations + Handover | 0/TBD | Not started | - |

## Coverage Validation

**Requirements mapped:** 67/67 v1 requirements
**Orphaned:** 0
**Duplicated across phases:** 0

| Category | Count | Phase |
|----------|-------|-------|
| Foundations (FND) | 7 | Phase 1 |
| Authentication (AUTH) | 5 | Phase 2 |
| Multi-Tenancy (TNT) | 8 | Phase 2 |
| Shopify (SHOP) | 9 | Phase 3 |
| Odoo (ODOO) | 5 | Phase 3 |
| QuickBooks (QB) | 7 | Phase 4 |
| Source-of-Truth Merge (MRG) | 4 | Phase 4 |
| Purchase Orders (PO) | 8 | Phase 4 |
| CSV Exports (CSV) | 3 | Phase 4 |
| Forecasting (FCT) | 9 | Phase 5 |
| A/B/C Tiering (ABC) | 3 | Phase 5 |
| Operations (OPS) | 4 | Phase 5 |
| Handover (HND) | 4 | Phase 5 |

---
*Roadmap created: 2026-05-28*
