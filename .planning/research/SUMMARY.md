# Research Synthesis — Wezesha Restock OS

**Synthesized:** 2026-05-28
**Audience:** the roadmapper that will turn this into a 3-5 phase coarse-grained ROADMAP.md
**Confidence:** HIGH on phase ordering and pitfalls. MEDIUM-HIGH on stack choices (with SOW overrides applied). MEDIUM on per-SKU model regime calibration (data-dependent).

## 1. Headline

- **Phase 1 is fixed and tiny.** Boot the existing app locally, walk the mock onboarding → seed → forecast → dashboard flow, then ship the cheap prerequisites every later phase depends on: mulberry32 determinism, Postgres swap (provider flip + `env("DATABASE_URL")` + scrub the 45 MB committed `prisma/dev.db`), add `Product.onOrder + expectedArrivalAt + receivedAt`, dedupe `assignAbc()` into `lib/forecast/abc.ts`, and kill `prisma.prediction.deleteMany()` from `app/api/forecast/run/route.ts` (append-only by `forecastRunId`). No external integrations. No auth yet. Goal: a deterministic, reproducible, Postgres-backed baseline every later phase can diff against.
- **All four research streams converge on the same Phase 2-5 ordering:** Phase 2 = multi-tenant + Supabase auth + path-based routing (precondition for any external integration), Phase 3 = real Shopify ingest (OAuth + webhooks-primary + nightly reconcile + the `on_hand` contract), Phase 4 = QuickBooks (OAuth with atomic refresh-rotation + CDC polling-primary + outbound PO push + Resend email) AND the per-field source-of-truth merge layer + `SourceClaim` ledger, Phase 5 = Python FastAPI sidecar on Railway (four regimes: SARIMA + Croston/TSB + cold-start + XGBoost adjustment) with the shared JSON contract. Odoo connector lands inside Phase 3 or as a tail of Phase 4 — same pattern as Shopify, second instance.
- **The SOW overrides three stack-research recommendations.** Auth = **Supabase** (not Better Auth — SOW mandate). QuickBooks role = **outbound PO push** to QBO `PurchaseOrder` with vendor reconciliation + PDF/XLSX fallback when not connected (not inbound sales source-of-truth — that's Shopify-webhook + POS-into-QB territory). Forecast regimes = **four explicit** (SARIMA, Croston/TSB, cold-start, XGBoost adjustment) — not just SARIMA + XGBoost residual. PO delivery = **PDF + XLSX grouped by supplier via Resend**.
- **Six pitfalls cut across every phase and must be designed against starting in Phase 2:** plaintext OAuth tokens (encrypt at rest), the 12 `prisma.tenant.findFirst()` calls (single `requireTenant()` chokepoint + lint rule), cache keys missing `tenantId`, prediction history wiped on every forecast run (`deleteMany` → append-only), `Math.random()` in the forecast simulator (mulberry32 seeded by `productId + runDate`), missing `onOrder` field (every approved PO silently double-orders next run).
- **Beauty Square's data shape will not match the synthetic seed.** Real Shopify `product_type` values won't match the hardcoded `FRAGRANCE | MAKEUP | SKINCARE | HAIRCARE | LIP CARE | BODY` uppercase set in `kenya-calendar.ts`. Real catalog will have many SKUs with <90 days of history. Real lead times will be bimodal around Chinese New Year. The architecture handles all three (per-field merge, four regimes, lead-time learning from actuals) but the relevant phase plans must flag them as calibration items, not bugs.

## 2. Stack Additions (SOW Overrides Applied)

| Layer | Decision | Override? |
|-------|----------|-----------|
| Auth | **Supabase Auth** — email + magic link primary, optional Google OAuth, session middleware for App Router | YES — STACK.md proposed Better Auth; SOW overrides |
| Tenancy | Path-based `/shop/[slug]/...` routing, middleware-injected tenant context, single `requireTenant()` chokepoint, `Membership` table; subdomain deferred to Milestone 2 | No |
| Shopify ingest | `@shopify/shopify-api` v11+ + `@shopify/shopify-app-session-storage-prisma`, pin `ApiVersion.January26` (NOT `LATEST_API_VERSION`), Bulk Operations for 365d order backfill, offline tokens encrypted at rest | No |
| QuickBooks | `intuit-oauth` (official) + thin custom Accounting API client + zod response validation; **avoid `node-quickbooks`**; refresh-token rotation wrapped in single Prisma transaction + per-tenant advisory lock; proactive refresh at access-token-age 50 min; CDC polling primary, webhooks opportunistic | Role override only — outbound PO push per SOW, inbound is supporting cast |
| Odoo | Same OAuth + ingest pattern as Shopify; in scope per SOW | YES — not in STACK.md; treat as Shopify-pattern second instance |
| Python sidecar | FastAPI 0.115 + uvicorn + Pydantic v2; statsmodels SARIMAX 0.15 + XGBoost 2.1 + scikit-learn + pandas 2.2 + numpy 2.0; **stateless per request**, no DB access, history sent inline; Railway deploy via Dockerfile (NOT Vercel Python); JWT shared secret; `tenant_id` is opaque body field for logs only | No |
| Forecast regimes | **SARIMA** + **Croston/TSB** + **cold-start heuristic** + **XGBoost adjustment layer**. Regime selected per SKU by ADI/CV² classification + history length | YES — STACK.md proposed SARIMA + XGBoost residual only; SOW adds Croston/TSB + cold-start explicitly |
| PO delivery | **PDF + XLSX grouped by supplier**, localized to tenant timezone + supplier currency, via **Resend**; supplier currency on `Supplier.currency`, FX-at-creation snapshot on PO line; KES display in dashboard, supplier currency in exports | YES — not in STACK.md |
| Determinism | Inline `mulberry32` (6 lines, no dep), seeded by `productId + runDate` hash | No |
| Database | Postgres (Supabase Postgres a strong candidate given auth = Supabase, else Vercel Postgres / Neon), `provider = "postgresql"`, `url = env("DATABASE_URL")`, `prisma/dev.db` scrubbed from git history, real `prisma migrate` workflow | No |
| Observability | Sentry on Next.js + Python sidecar with tenant tag on every event; OpenTelemetry FastAPI auto-instrumentation; structlog JSON to stdout on Railway | No |
| Email | Resend | No |
| Background jobs | Vercel Cron for nightly Shopify reconcile + QB CDC poll (15-60 min) + FX rate fetch + drift report; `IngestCursor` table for resumability; `JobRun` table or advisory lock for concurrent-rerun protection | No |
| Encryption | Field-level encryption for `shopifyAccessToken`, `qbAccessToken`, `qbRefreshToken` — single app-level KMS key in env (32 bytes base64) | No |

## 3. Feature Scope (v1)

### Must-have (SOW-mandated table stakes)
- Multi-tenant auth (Supabase) + path-based tenant routing + `requireTenant()` chokepoint.
- Forecast determinism (mulberry32) + prediction history retention (`forecastRunId`, append-only).
- Postgres migration + `.env.example` + scrub committed `dev.db`.
- Real Shopify OAuth + Admin API ingest — products/variants/inventory_levels (`on_hand` not `available`) + 365d order backfill via Bulk Operations + webhooks (`products/*`, `inventory_levels/update`, `orders/*`, `app/uninstalled`) with HMAC verification via `request.text()` first + nightly reconcile cron.
- Real QuickBooks Online OAuth — atomic refresh-token rotation, per-tenant lock, `CompanyInfo` fetched first (capture home currency), CDC polling every 15-60 min, opportunistic webhooks. Outbound PO push to QBO `PurchaseOrder` with vendor reconciliation, ambiguous-match prompt.
- Odoo connector — second commerce platform per SOW; pattern-mirrors Shopify.
- `Product.onOrder + expectedArrivalAt + receivedAt` — fixes double-order bug; reorder math becomes `ceil(finalForecast + safety - currentStock - onOrder)`.
- Per-field source-of-truth merge layer — `lib/integrations/merge.ts` with per-tenant `sourcePriorities: Json` + append-only `SourceClaim` ledger. NOT last-write-wins.
- Python FastAPI sidecar (Railway) — four regime selection by ADI/CV² + history length. Stateless. JSON contract matches `ForecastResult` shape exactly + `contract_version` + Zod validation + 5xx fallback to mock with warning signal.
- PO generation (PDF + XLSX) grouped by supplier + Resend email delivery with bounce routing to dashboard.
- PO approval flow — owner reviews, edits quantities, approves; approval triggers email + QBO push (or PDF/XLSX-only when QBO not connected).
- Audit log — append-only `AuditLog` table.
- Per-tenant timezone (`Africa/Nairobi`) + per-supplier currency + FX-at-creation snapshot on PO line + encrypted-at-rest tokens.
- Sentry on Next.js + Python sidecar with tenant tag.
- A/B/C tiering hardening — extract `assignAbc()` to `lib/forecast/abc.ts`; add `abcOverride` + `lifecycleStage: NEW|MATURE|EOL`.
- CSV exports (reorder recommendations, current stock snapshot, sales history).
- Concurrent-rerun protection.
- Handover documentation — architecture diagram, deployment runbook, known edge cases, day-2 playbook.

### Cheap differentiators worth including in v1
- Kenya payday-aware reorder timing (bias reorder dates ±3-5d to land before payday week) — small math change; distinctive moat.
- Cash-flow budget allocator promoted to main nav — already built, just elevate.
- Lost-sales estimate per SKU as a dedicated dashboard card — top "aha" metric for SMB owners.
- Forecast explanation panel — `Signal[]` already shaped, just surface it with Kenyan-localized holiday labels.
- Promo lift driven by real `Promo` rows (sidecar reads `active_promos` from request payload, not hardcoded calendar).

### Deferred (v1.x or v2)
- M-Pesa billing, multi-channel sales aggregation, real-time inventory broadcast, standalone test framework phase, standalone Python deployment, full UI redesign, OTB budgeting, scenario planner, BOM, public API, forecast-model UI, real-time webhook→forecast retrigger.
- Lead-time auto-tuning, supplier scorecard, slow-mover liquidation, landed-cost — all v1.x after 30 days of real PO flow.
- Google Trends, weather signal, multi-warehouse — v2+ on demand.

## 4. Architecture Decisions Locked In

| Decision | Rationale | Where Enforced |
|----------|-----------|----------------|
| **Per-field source-of-truth priority + `SourceClaim` audit ledger** (NOT last-write-wins) | LWW reverts Mary's Shopify price edits when QB invoice carries old price; LWW oversells on POS-only sales when Shopify hasn't seen them | `lib/integrations/merge.ts` + `Tenant.sourcePriorities: Json` (per-tenant flippable) + `SourceClaim` model (append-only) |
| **Hybrid ingest: Shopify webhook-primary + nightly reconcile; QB CDC-poll-primary + opportunistic webhooks** | Shopify webhooks reliable (sub-10s, 48h retry, auto-removal at 19 failures). QB webhooks lag hours and only tell you *what* changed — you still call the API. CDC with cursor is what Intuit recommends. | `app/api/webhooks/shopify/route.ts` + cron reconcile + `app/api/cron/qb-poll/route.ts` + `IngestCursor` |
| **Stateless Python sidecar, history sent inline, no DB access** | Tenant isolation by construction; pure-function contract preserved (the "one-file swap" promise); no schema duplication; scales independently on Railway; ~30MB per forecast-run payload is acceptable | FastAPI `POST /v1/forecast` accepts full history + signals; returns `ForecastResult`; JWT in `FORECAST_SIDECAR_SECRET`; `tenant_id` for logs/metrics only |
| **Path-based tenant routing `/shop/[slug]/...` for v1** (subdomain deferred to M2) | ~2h middleware + AsyncLocalStorage vs ~1d + DNS; subdomain is slick-but-not-essential; 301 migration later is trivial | `middleware.ts` + `lib/tenant/resolve.ts` + `app/shop/[slug]/...` page tree |
| **Mulberry32 determinism keyed on `(productId, runDate)`** | `Math.random()` is non-reproducible; can't tell model improvements from noise; hard prerequisite for the Phase 5 swap test | `lib/forecast/rng.ts` exports `mulberry32` + `seedFor`; replaces every `Math.random()` in `simulate-layers.ts` + seed scripts |
| **Single `requireTenant()` chokepoint + lint rule banning bare `prisma.tenant.findFirst()` and bare `prisma.*.findMany()` without `tenantId`** | Retrofit will leave landmines without enforcement; only honest acceptance test is "seed second tenant, verify isolation manually" | `lib/auth/context.ts::requireTenant()`; ESLint custom rule; PR template checkbox; 2-tenant integration test |
| **Webhook tenant resolver is the ONE legitimate `findUnique` survivor** | Webhooks have no session — source domain or `realmId` IS the tenant key; narrowly scoped resolver, not a global fallback | Separate resolver in `app/api/webhooks/*/route.ts`, documented as such |
| **Prediction history append-only with `forecastRunId`** | Current `deleteMany` makes drift detection impossible; observability requires history; dashboards read "latest run per product" | Remove `prisma.prediction.deleteMany()` from `app/api/forecast/run/route.ts:70`; add `Prediction.forecastRunId`; query change |
| **Encrypted-at-rest tokens** with a single app-level KMS key | Repo or DB leak = full access to every connected Shopify and QB account | Field-level encryption wrapper or Prisma extension; `*_TOKEN_ENCRYPTION_KEY` env vars |
| **`Location` first-class entity from day one** (even though Beauty Square is single-location) | Schema-only cost is tiny; retrofitting multi-location with live data is a migration emergency the day Anjay's second client lands | `Tenant 1—n Location`, `Location 1—n InventoryLevel`, `Location.isPrimary`; forecast against primary in Phase 3, multi-location UI deferred |

## 5. Pitfalls to Design AGAINST in the Roadmap

| # | Pitfall | Phase to Prevent | Designed-In Mitigation |
|---|---------|------------------|-------------------------|
| 1 | **`Math.random()` + no prediction history → unreproducible forecasts + invisible drift** | **Phase 1** | Mulberry32; delete `deleteMany`; add `forecastRunId` and read latest per product |
| 2 | **12× `findFirst()` + zero auth → cross-tenant leak the moment a second tenant exists** | **Phase 2** | Supabase + middleware + `requireTenant()` chokepoint + ESLint rule + Prisma extension; acceptance test = seed 2nd tenant, verify isolation |
| 3 | **Cache keys missing `tenantId` → cross-tenant cache leak** | **Phase 2 (preventive)** | `lib/cache/tenant-cache.ts` as the only sanctioned cache; `tenantScopedCacheKey()`; tenant-scoped tags |
| 4 | **Plaintext OAuth tokens + no webhook HMAC verify → repo/DB leak = full account access; spoofed webhooks** | **Phase 3** (Shopify), **Phase 4** (QB) | Field-level encryption; `request.text()` BEFORE HMAC verify; base64 + `timingSafeEqual`; contract test with known fixture |
| 5 | **`available` vs `on_hand` confusion + missing `onOrder` field → double-orders every cycle** | **Phase 1 (schema) + Phase 3 (correct contract)** | Schema fields in Phase 1; Phase 3 pulls `on_hand` not `available`; reorder math subtracts `onOrder` |
| 6 | **QB refresh-token rotation race → tenant locked out** + **`realmId` mixed across tenants → financial leak** | **Phase 4 (entry criteria)** | Single `getValidQuickBooksToken(tenantId)` with per-tenant advisory lock; atomic transaction; `invalid_grant` → terminal `needs_reauth`; `QuickBooksConnection.tenantId @unique`; `CompanyInfo` fetched FIRST. Must follow #2. |
| 7 | **Sidecar contract drift (snake_case/camelCase, float/int, null confidence)** + **SARIMA on <90d garbage** + **MAPE explodes on intermittent SKUs** | **Phase 5** | Shared JSON Schema → generate TS + Python types; Zod at TS boundary; `contract_version`; **per-SKU regime selection** by ADI/CV² + history length (this is *why* SOW lists four regimes); MAE/RMSSE for intermittent class; confidence capped by data length |

**Additional pitfalls covered by design, worth flagging in phase plans:**
- Shopify scope under-request → Phase 3 requests full PROJECT.md Active scope set on day-1 OAuth.
- Multi-location flattening → Phase 3 schema includes `Location` even though UI defers.
- QB sandbox vs prod currency → Anjay creates Kenya-configured sandbox; `CompanyInfo` first call.
- Kenya 2-day outage → forecast page always renders from local DB with "Last synced N hours ago" banner.
- Moveable holidays / Eid → `python-holidays` library; surface to owner for confirmation.
- Supplier lead-time variance + CNY → Phase 1 schema adds `expectedArrivalDate` + `receivedAt`; CNY multiplier per China supplier in Phase 4 reorder math.
- Cold-start sidecar latency → Railway always-on tier OR async + polling; preload models on container startup; warmup cron.

## 6. Phase Ordering Rationale

All four research streams converge independently on the same 5-phase order — that convergence is the strongest signal.

```
Phase 1: Boot + Determinism + Cleanup ("verify mocks") — FIXED
   │
   └──→ Phase 2: Multi-Tenant + Supabase Auth + Tenant Routing
           │
           └──→ Phase 3: Real Shopify Ingest (OAuth + Admin GraphQL + webhooks + reconcile)
                       (Odoo as tail of Phase 3 OR head of Phase 4 — same pattern)
                   │
                   └──→ Phase 4: QuickBooks Outbound PO + Source-of-Truth Merge + Resend
                           │
                           └──→ Phase 5: Python Forecast Sidecar (Railway, 4 regimes)
                                   + handover documentation
```

**Why this exact order:**
- **Phase 1 → all:** non-determinism blocks any test asking "did the model swap change anything?"; SQLite + committed `dev.db` blocks Vercel deploy; missing `onOrder` schema makes Phase 3 correctness un-verifiable; `assignAbc()` duplication is a drift bomb. Phase 1 ships prerequisites for everything later.
- **Phase 2 → Phase 3:** the current `app/api/shop` upsert via `findFirst()` will silently overwrite Beauty Square's row the moment Anjay's second tenant connects. Auth + tenant routing must land before any second-tenant onboarding is possible.
- **Phase 2 → Phase 4:** QuickBooks `realmId` binding inherits and amplifies `findFirst()` — and the resulting leak crosses external financial data. Cannot ship QB without Phase 2 done.
- **Phase 3 before Phase 4:** Shopify is the simpler integration (one mature SDK, well-documented webhooks); builds the OAuth + webhook + ingest cursor pattern QB then copies. Beauty Square's Shopify is live *now*; Anjay is still fetching QB sandbox. Merge layer needs at least one real source to merge against.
- **Phase 4 before Phase 5:** the forecast quality story only matters once the sidecar sees real, reconciled inventory + sales. Sidecar against mock data is testable but pointless; sidecar against Shopify-only without QB merge forecasts on wrong stock numbers (Beauty Square POS bypasses Shopify).
- **Phase 5 is the swap, not from-scratch:** `simulateLayeredForecast()` contract preserved; one file changes in `app/api/forecast/run/route.ts`. Sidecar can be developed in parallel with Phase 4 once the contract is locked, but ships only after Phase 4 provides real merged data.

**Why NOT alternative orderings:**
- "Python sidecar first" — testable but pointless; no real data → can't tell SARIMA from naive baseline.
- "Skip Phase 1, do auth first" — non-determinism makes auth-testing flaky; SQLite blocks the Vercel deploy auth needs.
- "QB before Shopify" — QB is the harder integration; Beauty Square's Shopify is production-ready today, QB sandbox is pending.
- "Subdomain routing in v1" — ~1d + DNS vs ~2h for path-based; 301 to subdomain in M2 is trivial.

## 7. Open Questions for Phase-Time Research

The roadmapper should NOT decide these now. They need data, a credential, or a small spike inside the relevant phase.

| # | Question | Phase to Resolve |
|---|----------|------------------|
| Q1 | Exact pinned versions: `@shopify/shopify-api`, `intuit-oauth`, Supabase JS client, FastAPI + numpy + statsmodels + xgboost compatibility matrix | Phase 2/3/4/5 entries (run `npm view` / `pip index versions` at phase start) |
| Q2 | Postgres host: Supabase Postgres (now strong candidate since auth = Supabase) vs Vercel Postgres vs Neon | Phase 1 (30-min comparison at phase entry) |
| Q3 | Shopify API version: which `ApiVersion.YYYYMM` is the current STABLE quarter at Phase 3 start | Phase 3 |
| Q4 | QuickBooks Kenya-configured sandbox: who creates it + KES home currency confirmed in `CompanyInfo`? | Phase 4 entry criteria (depends on Anjay) |
| Q5 | Token encryption: Prisma field-level extension vs app-level AES-256 vs Supabase column encryption | Phase 2 or 3 (1-hour spike) |
| Q6 | Beauty Square's real Shopify `product_type` distribution — will it match the hardcoded `FRAGRANCE \| MAKEUP \| SKINCARE \| HAIRCARE \| LIP CARE \| BODY` set? | Phase 3 data audit on first ingest; normalize map if not |
| Q7 | ADI/CV² thresholds (1.32 / 0.49 are standard but tenant-specific) + which percentage of Beauty Square's SKUs fall in each demand class | Phase 5 calibration |
| Q8 | SARIMA vs Prophet vs NeuralProphet head-to-head on first 60d of real Beauty Square data | Phase 5 A/B harness |
| Q9 | Async-job pattern vs always-on Railway tier for sidecar cold-start handling | Phase 5 host decision |
| Q10 | Odoo integration scope — version (Online vs Community), modules (Sales/Inventory/Purchase/Accounting), OAuth vs API-key | Phase 3 tail or Phase 4; default = Shopify-pattern OAuth + Sales/Inventory, defer Accounting/Purchase to v1.x |
| Q11 | Drift report cron cadence + alert thresholds (e.g. "MAE doubles MoM, signed bias >20%") | Phase 5 tail; ship default, tune after 30d real predictions vs actuals |
| Q12 | POS→QB sync cleanup n8n workflow location + triggers + dashboard surface | Out of this milestone (Anjay-flagged "~1d casual work"); tracked in PROJECT.md Adjacent |

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack additions (Shopify SDK, intuit-oauth, FastAPI/statsmodels/XGBoost, mulberry32) | HIGH | Official packages, well-documented, Roy has shipped most patterns before |
| Stack overrides (Supabase, Resend, Odoo, 4-regime forecast) | HIGH | SOW explicit; no ambiguity |
| Per-field merge + `SourceClaim` ledger | MEDIUM-HIGH | 2026 industry consensus + Beauty Square specifics; risk is config table being right, not the pattern |
| Hybrid ingest (Shopify webhook-primary, QB CDC-poll-primary) | HIGH | Official docs from both vendors converge |
| Stateless Python sidecar + JWT + history-inline | HIGH | Matches existing pure-function contract; aligns with Roy's Railway operational model |
| Path-based tenant routing for v1 | HIGH | Lowest-cost path; Next.js team's own guide recommends this for v1 |
| Phase ordering (1 → 2 → 3 → 4 → 5) | HIGH | All four research streams converge independently |
| Pitfall coverage (top 7) | HIGH | Each cited in at least 2 of {PITFALLS, ARCHITECTURE, CONCERNS}; well-documented in official sources |
| Four-regime forecast selection | MEDIUM-HIGH | SOW-mandated regimes are standard SMB retail practice; specific thresholds need calibration |
| Kenya-specific signals (payday, Eid, CNY lead-time) | MEDIUM | Reasonable starter heuristics; must be replaced by data-learned values once 60+ days accumulate |

**Gaps that couldn't be resolved in research:**
- Beauty Square's actual catalog shape — won't be known until Phase 3 ingests real data; Phase 3 must include a data-audit task.
- Real lead-time variance per supplier — `expectedArrivalDate vs receivedAt` data doesn't exist yet; Phase 1 schema adds fields; community defaults ship as placeholders; auto-tuning is v1.x.
- QuickBooks sandbox availability + Anjay's timing — gating Phase 4 entry per PROJECT.md Constraints.
- Pricing tier / GTM for SimplyDone customers beyond Beauty Square — affects Phase 5 calibration but not v1 launch.
- The exact moment "Phase 5 done" — depends on MAPE thresholds validated against ≥30d real Beauty Square actuals; flag as milestone-completion-gate, not within-Phase-5 task.

---

## Ready for Roadmapper

**Suggested phases:** 5

1. **Phase 1 — Boot + Determinism + Cleanup** (FIXED per orchestrator): local boot, mulberry32, Postgres swap, `onOrder` schema, `assignAbc` dedupe, kill `deleteMany`
2. **Phase 2 — Multi-Tenant + Supabase Auth + Path Routing**: `requireTenant()` chokepoint, lint rule, `Membership`, encrypted token columns, tenant-scoped cache helper
3. **Phase 3 — Real Shopify Ingest**: OAuth (full Active scope set), Admin GraphQL, Bulk Operations backfill, webhooks (HMAC-via-`request.text()`), nightly reconcile, `Location` schema, `on_hand` contract, optional Odoo tail
4. **Phase 4 — QuickBooks Outbound + Source-of-Truth Merge + PO Delivery**: `intuit-oauth` with atomic refresh-rotation, per-tenant lock, `CompanyInfo`-first, CDC polling, opportunistic webhooks, `lib/integrations/merge.ts` + `SourceClaim`, PDF+XLSX PO generation, Resend email, QBO `PurchaseOrder` push with vendor reconciliation
5. **Phase 5 — Python Forecast Sidecar + Handover**: Railway FastAPI, 4 regimes (SARIMA + Croston/TSB + cold-start + XGBoost adjustment), shared JSON contract + Zod, `forecastRunId` drift observability, async-or-always-on cold-start strategy, handover documentation

**Research flags:** Phase 3 (Shopify data audit), Phase 4 (QB sandbox + currency + merge config), Phase 5 (regime calibration + A/B harness + cold-start strategy) need deeper research at phase-planning time. Phase 1 and Phase 2 follow well-documented patterns — standard planning depth is sufficient.

**Overall confidence:** HIGH on scope + ordering. MEDIUM on phase-5 calibration (data-dependent).
