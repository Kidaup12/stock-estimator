---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 3 Plan 03-03 complete (real Shopify ingest live)
last_updated: "2026-06-04T00:00:00.000Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 11
  completed_plans: 11
  percent: 60
---

# STATE: Wezesha Restock OS

**Last updated:** 2026-06-04 (Phase 3 — Plan 03-03 shipped: real Beauty Square data live)

## Project Reference

**Core Value:** Tell a shop owner exactly what to reorder this week, generate the PO, and email it to the right supplier — with enough confidence that they trust the number.

**Current Focus:** Phase 03 — real-shopify-ingest-odoo (Plan 03-03 done; 03-04 webhooks + 03-05 reconcile remain)

**Client + Commercial:** Subcontracted by Anjay (SimplyDone Africa). First paying tenant = Beauty Square (Nairobi beauty retailer). Roy = builder; Anjay = client relationships + design + credential fetching.

## Current Position

**Phase:** 3 of 5 (real shopify ingest + odoo) — EXECUTING
**Plan:** 03-03 COMPLETE (03-01, 03-03 done; 03-02 re-sequenced to custom-app token; 03-04 + 03-05 remain)
**Status:** Real Beauty Square data live — 1100 products, 2936 sales, 4 locations, 3920 on_hand, 719 predictions, 98 reorder orders
**Progress:** [██████░░░░] 60%

## Phase Pipeline

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Boot, Determinism & Cleanup | ✅ COMPLETE (3/3 plans) | Postgres + determinism + cleanup; vitest green |
| 2 | Multi-Tenant Auth & Tenant Routing | ✅ COMPLETE (6/6 plans) | Supabase auth, requireTenant, /shop/[slug], tenant isolation verified live |
| 3 | Real Shopify Ingest + Odoo | 🔵 IN PROGRESS | 03-01 schema+encryption ✅, 03-03 ingest+cutover ✅ (REAL data live). 03-04 webhooks + 03-05 reconcile remain. Odoo deferred to later milestone (D). |
| 4 | QuickBooks + Source-of-Truth Merge + PO Delivery | Not started | Anjay fetching QB sandbox + KES home currency |
| 5 | Python Forecast Sidecar + Operations + Handover | Not started | Regime calibration needs ≥30d real Beauty Square data |

## Performance Metrics

**Velocity:**

- Phases shipped: 0 (Phase 1 complete, awaiting transition)
- Plans shipped: 3 (01-01, 01-02, 01-03)
- Avg plan duration: ~19 min (01-01 ~25 min, 01-02 ~20 min, 01-03 ~12 min)

**Quality:**

- Reverts / hotfixes: 0
- Acceptance criteria pass rate: 7/7 FND-* requirements verified (live + mechanical)

| Phase-Plan | Duration | Tasks | Files | Date |
|---|---|---|---|---|
| 01-01 | ~25 min | 4 | 5 created / 5 modified / 1 deleted | 2026-05-28 |
| 01-02 | ~20 min | 4 | 4 created / 9 modified | 2026-05-30 |
| 01-03 | ~12 min | 2 | 6 created / 2 modified | 2026-05-30 |

## Accumulated Context

### Key Decisions (locked in PROJECT.md)

- Repo: continue on `Kidaup12/stock-estimator` (working folder: `wezesha/stock-estimator/`); planning artifacts live in this repo so they push upstream.
- Granularity: coarse (5 broad phases) — Anjay wants speed.
- Auth: Supabase email + magic link + optional Google OAuth (SOW mandate; overrides Better Auth recommendation).
- QuickBooks role: OUTBOUND PO push to QBO `PurchaseOrder` with vendor reconciliation + PDF/XLSX fallback. NOT inbound sales source-of-truth.
- Odoo connector: in scope (SOW), Shopify-pattern second instance.
- Forecast regimes: SARIMA + Croston/TSB + cold-start + XGBoost adjustment (four explicit, per SOW).
- PO delivery: PDF + XLSX grouped by supplier, via Resend.
- Tenant routing: path-based `/shop/[slug]/` for v1; subdomain deferred to Milestone 2.
- Source-of-truth: per-field priority + append-only `SourceClaim` ledger (NOT last-write-wins).
- Python sidecar: stateless per request, no DB access, JWT-authed, history sent inline.
- Determinism: mulberry32 seeded on `(productId, runDate)` — Phase 1 prerequisite for every later test.
- POS→QB sync cleanup: out of this milestone (n8n workflow Anjay runs separately).

### Active Todos

- [x] `/gsd:plan-phase 1` — Phase 1 broken into 3 plans, all shipped.
- [x] Confirm Postgres host choice — Supabase Postgres (Roy's personal project, eu-central-1 Frankfurt, Session Pooler for IPv4).
- [ ] `/gsd:transition` Phase 1 → Phase 2 (Multi-Tenant Auth & Tenant Routing).
- [ ] Anjay to fetch Shopify production credentials before Phase 3 start.
- [ ] Anjay to fetch QuickBooks sandbox (KES home currency configured) before Phase 4 start.

### Blockers

None active. Phase 1 is fully unblocked.

### Risks Tracked

- **Beauty Square's real Shopify `product_type` won't match hardcoded category set** (`kenya-calendar.ts`) — Phase 3 must include a data-audit + normalisation map task.
- **Real lead-time variance per supplier** is unknown until ≥30 days of `expectedArrivalDate` vs `receivedAt` data accumulate — Phase 1 ships the schema fields; auto-tuning is v1.x.
- **QB sandbox availability gates Phase 4 start** — depends on Anjay.
- **Sidecar cold-start latency on Railway** — Phase 5 decides between always-on tier and async-with-polling.

## Session Continuity

**Last session focus:** Phase 3 Plan 03-03 — real Shopify ingest made live. client-credentials grant verified (shop.json 200), Bulk Ops backfill (1100 products / 4 locations / 2128 orders), guarded synthetic→real cutover ran, sales finished via resumable helper (2936 rows), forecasts re-run on real data (719 predictions, 98 reorder orders). Mock client deleted. jsonl 8/8, tsc clean, lint 0 errors. Committed `1c09fec`.

**Stopped at:** Plan 03-03 complete + committed (local main, not pushed upstream).

**Next session should:**

1. Open this STATE.md + `.planning/phases/03-real-shopify-ingest-odoo/03-03-SUMMARY.md`
2. Plan/execute **Plan 03-04** (webhooks — HMAC + idempotency; SHOPIFY_API_SECRET present; live delivery deferred to deploy) and **Plan 03-05** (nightly reconcile cron + uninstall handler)
3. Calibration backlog (Phase 5): productType normalization (Beauty Square product_type is empty), confirm desired primary location (currently Lavington vs online New Stanley CBD)
4. Push local main → Kidaup12/stock-estimator upstream when ready (pending; ask Roy)

**Files of record:**

- `.planning/PROJECT.md` — what we're building + why + decisions
- `.planning/REQUIREMENTS.md` — 67 v1 REQ-IDs with phase traceability
- `.planning/ROADMAP.md` — phases, success criteria, dependencies
- `.planning/research/SUMMARY.md` — research convergence + open questions
- `.planning/codebase/CONCERNS.md` — existing-app gaps Phase 1 addresses
- `.planning/STATE.md` — this file (project memory)

---
*State initialized: 2026-05-28*
