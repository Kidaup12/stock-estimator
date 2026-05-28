# Requirements: Wezesha Restock OS

**Defined:** 2026-05-28
**Core Value:** Tell a shop owner exactly what to reorder this week, generate the PO, and email it to the right supplier — with enough confidence that they trust the number.

## v1 Requirements

Requirements for the production v1 release. Each maps to roadmap phases.

### Foundations

- [ ] **FND-01**: Existing app boots locally and the mock onboarding → seed → forecast → dashboard flow works end-to-end with no code changes.
- [ ] **FND-02**: Forecast outputs are deterministic — same `(productId, runDate)` produces the same `layer1Value`/`layer2Value`/`signals[]` on every run. (mulberry32 replaces `Math.random()`.)
- [x] **FND-03**: Database is Postgres. Prisma `provider = "postgresql"`, real migration history (`prisma migrate`), `DATABASE_URL` via env, `prisma/dev.db` scrubbed from git.
- [ ] **FND-04**: `Product.onOrder`, `Product.expectedArrivalAt`, `Product.receivedAt` schema fields exist; reorder math subtracts on-order stock so approved POs don't double-recommend on the next forecast run.
- [ ] **FND-05**: `assignAbc()` lives in exactly one place (`lib/forecast/abc.ts`); the API route and the script import the same implementation.
- [ ] **FND-06**: Prediction history is append-only — `prisma.prediction.deleteMany()` is gone from the forecast run route; predictions are tagged with `forecastRunId`; dashboards query latest-per-product.
- [x] **FND-07**: `.env.example` documents every required environment variable.

### Authentication

- [ ] **AUTH-01**: User can sign up and log in via Supabase email + magic link.
- [ ] **AUTH-02**: User can optionally log in via Google OAuth.
- [ ] **AUTH-03**: User session persists across browser refresh.
- [ ] **AUTH-04**: User can log out from any page.
- [ ] **AUTH-05**: Every `app/api/*` route requires a valid session — unauthenticated requests get 401.

### Multi-Tenancy

- [ ] **TNT-01**: Path-based tenant routing — every authenticated user accesses their tenant under `/shop/[slug]/...`; cross-tenant URL access returns 403.
- [ ] **TNT-02**: A single `requireTenant()` helper is the only sanctioned way to resolve the current tenant in app routes; all 12 existing `prisma.tenant.findFirst()` calls are removed.
- [ ] **TNT-03**: Webhook routes use a separate domain/realmId-keyed resolver, not the session-based helper.
- [ ] **TNT-04**: A `Membership` table links users to tenants with a role enum (`OWNER` | `MEMBER`).
- [ ] **TNT-05**: Two-tenant integration test verifies a request from Tenant A cannot read or mutate Tenant B's `Product`, `SalesHistory`, `Supplier`, `Promo`, `Prediction`, or `Order` rows.
- [ ] **TNT-06**: An ESLint rule (or Prisma extension) bans bare `prisma.*.findMany()` / `findFirst()` calls that omit `tenantId` outside the resolver layer.
- [ ] **TNT-07**: Caching helper `lib/cache/tenant-cache.ts` automatically scopes keys + tags by `tenantId`.
- [ ] **TNT-08**: `Tenant.timezone` (default `Africa/Nairobi`) stored; all date bucketing in the forecast + reorder windows respects it.

### Shopify Integration

- [ ] **SHOP-01**: Per-tenant Shopify OAuth installation flow — owner clicks "Connect Shopify," is redirected to Shopify, returns with an offline access token stored encrypted on `ShopifyConnection`.
- [ ] **SHOP-02**: Shopify access tokens are encrypted at rest (field-level encryption with a single app-level key).
- [ ] **SHOP-03**: 365-day historical orders are backfilled via Shopify Bulk Operations on first connect.
- [ ] **SHOP-04**: Products, variants, and inventory levels (`on_hand`, not `available`) ingest into the tenant's tables on first connect.
- [ ] **SHOP-05**: Real-time webhooks ingest for `products/create|update|delete`, `inventory_levels/update`, `orders/create|updated|cancelled`, `app/uninstalled`. HMAC signature verified via `request.text()` before `request.json()`; signature comparison uses `timingSafeEqual` with base64 digest.
- [ ] **SHOP-06**: Webhook handlers are idempotent on replay — `X-Shopify-Webhook-Id` dedupes processed events.
- [ ] **SHOP-07**: Nightly reconcile cron runs a delta sweep to catch missed webhooks; uses `IngestCursor` for resumability.
- [ ] **SHOP-08**: `Location` is a first-class entity (`Tenant 1—n Location`, `Location 1—n InventoryLevel`); `Location.isPrimary` is set on first connect; forecast runs against primary location in v1.
- [ ] **SHOP-09**: `app/uninstalled` webhook cleans up tokens but preserves tenant data.

### QuickBooks Online Integration

- [ ] **QB-01**: Per-tenant QuickBooks Online OAuth via `intuit-oauth`; owner connects from settings and returns with realmId + access + refresh tokens encrypted on `QuickBooksConnection`.
- [ ] **QB-02**: `QuickBooksConnection.tenantId @unique` — one QB realm cannot bind to two tenants.
- [ ] **QB-03**: Refresh-token rotation happens inside a single Prisma transaction with a per-tenant advisory lock; concurrent refresh attempts wait.
- [ ] **QB-04**: Access tokens are proactively refreshed at ~50 minutes of age; reactive refresh only as fallback.
- [ ] **QB-05**: An `invalid_grant` response moves the connection to `needs_reauth` state and surfaces a banner to the tenant.
- [ ] **QB-06**: `CompanyInfo` is fetched first on connect; `Tenant.baseCurrency` (default KES) is set from `CompanyInfo.Country`/`HomeCurrency` and surfaced in settings for confirmation.
- [ ] **QB-07**: CDC polling job runs every 15-60 minutes per connected tenant, advances `IngestCursor`, ingests changed vendors / items / inventory adjustments / purchases.

### Source-of-Truth Merge

- [ ] **MRG-01**: `Tenant.sourcePriorities` (JSON) holds per-field priority (e.g., `{ "inventory": ["quickbooks", "shopify"], "price": ["shopify", "quickbooks"] }`); defaults match the Beauty Square map (QB wins inventory/cost/POS-sales, Shopify wins catalog/price/online-sales).
- [ ] **MRG-02**: All writes from ingest pipelines route through `lib/integrations/merge.ts::applyClaim()`; direct upserts from Shopify/QB clients are removed.
- [ ] **MRG-03**: Every claim is recorded in an append-only `SourceClaim` ledger with source, field, value, timestamp; conflicts are auditable.
- [ ] **MRG-04**: Tenant settings UI surfaces the source-priority table and lets the owner flip per-field winners.

### Odoo Integration

- [ ] **ODOO-01**: Per-tenant Odoo connection (OAuth where supported, API key fallback), same Connection-pattern as Shopify.
- [ ] **ODOO-02**: Products + variants + inventory ingest into the tenant's `Product` + `InventoryLevel` via the merge layer.
- [ ] **ODOO-03**: Sales orders ingest into `SalesHistory` via the merge layer.
- [ ] **ODOO-04**: Polling cadence matches QuickBooks (15-60 min) with `IngestCursor` resumability.
- [ ] **ODOO-05**: Owner can disconnect Odoo from settings; tenant data preserved.

### Forecasting

- [ ] **FCT-01**: Python FastAPI sidecar deployed (Railway) exposing `POST /v1/forecast` that accepts `tenant_id`, product, history, signals, and `contract_version`; returns `ForecastResult` matching the existing `simulateLayeredForecast()` JSON shape.
- [ ] **FCT-02**: Sidecar is stateless per request — receives full history inline, never touches the application database.
- [ ] **FCT-03**: Sidecar request is authenticated via shared JWT (`FORECAST_SIDECAR_SECRET`).
- [ ] **FCT-04**: Per-SKU regime selection by `(ADI, CV²)` classification + history length: SARIMA for long-history smooth-demand SKUs, Croston/TSB for intermittent/sparse-sales SKUs, cold-start heuristic for SKUs with under 30 days of data.
- [ ] **FCT-05**: XGBoost adjustment layer applies promo, payday, and holiday lift on top of whichever baseline ran.
- [ ] **FCT-06**: TS application falls back to the deterministic mock simulator on sidecar 5xx with a warning signal appended to `signals[]`.
- [ ] **FCT-07**: Forecast runs are concurrency-protected per tenant — a second run for the same tenant is rejected or queued, never double-fired.
- [ ] **FCT-08**: Forecast outputs are persisted with `forecastRunId`, `regime`, and `confidence`; drift detection has the history it needs.
- [ ] **FCT-09**: Cold-start latency strategy chosen (Railway always-on tier OR async-with-polling) and documented; warmup cron pings the sidecar on a schedule.

### Purchase Orders + Supplier Handoff

- [ ] **PO-01**: Owner can review reorder recommendations and approve/edit/skip per supplier from the dashboard.
- [ ] **PO-02**: On approval, the system generates a PO grouped by supplier as a PDF (email-attachable) and an XLSX, localized to tenant timezone and supplier currency, with KES totals shown for the owner.
- [ ] **PO-03**: PO PDF/XLSX is emailed to the supplier via Resend with the tenant cc'd; a confirmation surfaces on the tenant dashboard.
- [ ] **PO-04**: Resend bounces / errors are caught and surfaced as actionable banners on the dashboard.
- [ ] **PO-05**: If the tenant has a connected QuickBooks Online account, the approved PO is pushed as a `PurchaseOrder` object to QBO; if not, the PDF/XLSX delivery is the entire output.
- [ ] **PO-06**: Vendor reconciliation by name happens before QBO push; on ambiguous match, the owner is prompted to pick the correct QBO vendor (and the mapping is remembered).
- [ ] **PO-07**: Per-supplier currency stored on `Supplier.currency`; FX rate at PO creation captured on the PO line in KES and original currency.
- [ ] **PO-08**: MOQ rounding applied per supplier (existing field) before PO generation; rounded-up quantity captured separately from forecast-recommended quantity.

### A/B/C Tiering

- [ ] **ABC-01**: `Product.abcOverride` field exists; if set, overrides the heuristic.
- [ ] **ABC-02**: Owner can pin a product's ABC class from the product drill-down.
- [ ] **ABC-03**: `Product.lifecycleStage` (`NEW` | `MATURE` | `EOL`) field exists and feeds into the forecast regime selection.

### CSV Exports

- [ ] **CSV-01**: Owner can download a CSV of current reorder recommendations.
- [ ] **CSV-02**: Owner can download a CSV of the current stock snapshot per location.
- [ ] **CSV-03**: Owner can download a CSV of sales history within a chosen date range.

### Operations

- [ ] **OPS-01**: `AuditLog` table records who-did-what-when for PO approvals, supplier edits, ABC overrides, tenant-settings changes, and integration connect/disconnect events.
- [ ] **OPS-02**: Sentry is wired into the Next.js app and the Python sidecar; every event carries a `tenant_id` tag.
- [ ] **OPS-03**: A `JobRun` table (or advisory locks) prevents concurrent reruns of forecasts and ingest jobs per tenant.
- [ ] **OPS-04**: Forecast page always renders from local DB with a "Last synced N hours ago" banner so a transient connectivity outage does not break the UI.

### Handover

- [ ] **HND-01**: `docs/architecture.md` captures the system diagram (Next.js ↔ Postgres ↔ Python sidecar ↔ Shopify/QB/Odoo/Resend/Supabase) and per-component responsibilities.
- [ ] **HND-02**: `docs/deployment.md` is a runbook for deploying Next.js → Vercel, Postgres provisioning, Python → Railway, Supabase project setup, environment variables, and rotating the encryption key.
- [ ] **HND-03**: `docs/edge-cases.md` documents the known landmines (QB rotation, webhook HMAC, source-of-truth conflicts, multi-location, currency, cold-start) with mitigations.
- [ ] **HND-04**: `docs/operations.md` is a day-2 playbook: token rotation, webhook backfill, forecast rerun, tenant onboarding, drift report review.

## v2 Requirements

Deferred to a later milestone. Tracked but not in current roadmap.

### Multi-Channel + Billing
- **V2-01**: M-Pesa billing for tenant subscriptions.
- **V2-02**: Multi-channel sales aggregation (WhatsApp, Instagram, retail walk-ins beyond POS-into-QB).
- **V2-03**: POS → QuickBooks sync cleanup automation as an n8n workflow Anjay runs separately (~1 day; tracked in PROJECT.md Adjacent).

### Forecast Polish
- **V2-04**: Lead-time auto-tuning learned from PO `expectedArrivalDate` vs `receivedAt`.
- **V2-05**: Supplier scorecard (on-time %, fill rate, lead-time variance).
- **V2-06**: Slow-mover / dead-stock liquidation recommendations.
- **V2-07**: Landed-cost (FX + freight + duties) on PO lines.

### Tenant Experience
- **V2-08**: Subdomain-based tenant routing (`acme.wezesha.app`).
- **V2-09**: Multi-location forecasting + per-location reorder windows.
- **V2-10**: Google Trends Kenya as a layer-2 signal.
- **V2-11**: Weather signal as a layer-2 signal.

### Extras
- **V2-12**: Real-time webhook → forecast retrigger (event-driven re-forecast).

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Standalone test framework / CI as its own phase | Vitest gets added inside the phases that need it (FND, FCT, MRG); standing up CI is not a v1 deliverable |
| Standalone Python-only deployment | The TS app stays the orchestrator and writer; Python is a sidecar called via HTTP, not a replacement |
| Replacing the existing UI shell | Dashboard layout is adequate for v1; UI work ships inside feature phases, not as a redesign |
| Open-to-Buy budgeting | SMB scope-creep trap per Features research |
| Scenario planner / what-if modeling | SMB owners abandon these tools (Features research) |
| BOM / manufacturing modules | Out of domain — Beauty Square is retail, not manufacturing |
| Public API | Not in SOW; revisit when third-party integrators ask |
| Forecast-model-selection UI | Owners shouldn't pick models; the regime selector does |
| Real-time inventory broadcast to suppliers | POs are emailed/pushed-to-QBO at approval time; live stock broadcast adds zero owner value |

## Traceability

Which phases cover which requirements. Populated by the roadmapper.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Pending |
| FND-02 | Phase 1 | Pending |
| FND-03 | Phase 1 | Complete |
| FND-04 | Phase 1 | Pending |
| FND-05 | Phase 1 | Pending |
| FND-06 | Phase 1 | Pending |
| FND-07 | Phase 1 | Complete |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| AUTH-05 | Phase 2 | Pending |
| TNT-01 | Phase 2 | Pending |
| TNT-02 | Phase 2 | Pending |
| TNT-03 | Phase 2 | Pending |
| TNT-04 | Phase 2 | Pending |
| TNT-05 | Phase 2 | Pending |
| TNT-06 | Phase 2 | Pending |
| TNT-07 | Phase 2 | Pending |
| TNT-08 | Phase 2 | Pending |
| SHOP-01 | Phase 3 | Pending |
| SHOP-02 | Phase 3 | Pending |
| SHOP-03 | Phase 3 | Pending |
| SHOP-04 | Phase 3 | Pending |
| SHOP-05 | Phase 3 | Pending |
| SHOP-06 | Phase 3 | Pending |
| SHOP-07 | Phase 3 | Pending |
| SHOP-08 | Phase 3 | Pending |
| SHOP-09 | Phase 3 | Pending |
| ODOO-01 | Phase 3 | Pending |
| ODOO-02 | Phase 3 | Pending |
| ODOO-03 | Phase 3 | Pending |
| ODOO-04 | Phase 3 | Pending |
| ODOO-05 | Phase 3 | Pending |
| QB-01 | Phase 4 | Pending |
| QB-02 | Phase 4 | Pending |
| QB-03 | Phase 4 | Pending |
| QB-04 | Phase 4 | Pending |
| QB-05 | Phase 4 | Pending |
| QB-06 | Phase 4 | Pending |
| QB-07 | Phase 4 | Pending |
| MRG-01 | Phase 4 | Pending |
| MRG-02 | Phase 4 | Pending |
| MRG-03 | Phase 4 | Pending |
| MRG-04 | Phase 4 | Pending |
| PO-01 | Phase 4 | Pending |
| PO-02 | Phase 4 | Pending |
| PO-03 | Phase 4 | Pending |
| PO-04 | Phase 4 | Pending |
| PO-05 | Phase 4 | Pending |
| PO-06 | Phase 4 | Pending |
| PO-07 | Phase 4 | Pending |
| PO-08 | Phase 4 | Pending |
| CSV-01 | Phase 4 | Pending |
| CSV-02 | Phase 4 | Pending |
| CSV-03 | Phase 4 | Pending |
| FCT-01 | Phase 5 | Pending |
| FCT-02 | Phase 5 | Pending |
| FCT-03 | Phase 5 | Pending |
| FCT-04 | Phase 5 | Pending |
| FCT-05 | Phase 5 | Pending |
| FCT-06 | Phase 5 | Pending |
| FCT-07 | Phase 5 | Pending |
| FCT-08 | Phase 5 | Pending |
| FCT-09 | Phase 5 | Pending |
| ABC-01 | Phase 5 | Pending |
| ABC-02 | Phase 5 | Pending |
| ABC-03 | Phase 5 | Pending |
| OPS-01 | Phase 5 | Pending |
| OPS-02 | Phase 5 | Pending |
| OPS-03 | Phase 5 | Pending |
| OPS-04 | Phase 5 | Pending |
| HND-01 | Phase 5 | Pending |
| HND-02 | Phase 5 | Pending |
| HND-03 | Phase 5 | Pending |
| HND-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 67 total
- Mapped to phases: 67
- Unmapped: 0

---
*Requirements defined: 2026-05-28*
*Last updated: 2026-05-28 after roadmap creation (traceability populated)*
