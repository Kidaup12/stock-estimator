---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-28T18:09:07.519Z"
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 3
  completed_plans: 1
  percent: 33
---

# STATE: Wezesha Restock OS

**Last updated:** 2026-05-28 (roadmap created)

## Project Reference

**Core Value:** Tell a shop owner exactly what to reorder this week, generate the PO, and email it to the right supplier — with enough confidence that they trust the number.

**Current Focus:** Phase 01 — boot-determinism-cleanup

**Client + Commercial:** Subcontracted by Anjay (SimplyDone Africa). First paying tenant = Beauty Square (Nairobi beauty retailer). Roy = builder; Anjay = client relationships + design + credential fetching.

## Current Position

Phase: 01 (boot-determinism-cleanup) — EXECUTING
Plan: 1 of 3
**Phase:** 1 of 5 — Boot, Determinism & Cleanup
**Plan:** Not yet planned (next: `/gsd:plan-phase 1`)
**Status:** Executing Phase 01
**Progress:** [███░░░░░░░] 33%

## Phase Pipeline

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Boot, Determinism & Cleanup | Pending plan | Fixed-and-tiny scope; same-day ship target |
| 2 | Multi-Tenant Auth & Tenant Routing | Not started | Precondition for any external integration |
| 3 | Real Shopify Ingest + Odoo | Not started | Anjay fetching Shopify credentials |
| 4 | QuickBooks + Source-of-Truth Merge + PO Delivery | Not started | Anjay fetching QB sandbox + KES home currency |
| 5 | Python Forecast Sidecar + Operations + Handover | Not started | Regime calibration needs ≥30d real Beauty Square data |

## Performance Metrics

**Velocity:**

- Phases shipped: 0
- Plans shipped: 0
- Avg plan duration: n/a

**Quality:**

- Reverts / hotfixes: 0
- Acceptance criteria pass rate: n/a

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

- [ ] `/gsd:plan-phase 1` to break Phase 1 into plans.
- [ ] Confirm Postgres host choice (Supabase Postgres vs Vercel Postgres vs Neon) at Phase 1 entry — 30-min comparison.
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

**Last session focus:** New-project initialization — PROJECT.md, REQUIREMENTS.md, research synthesis, codebase audit, roadmap creation.

**Next session should:**

1. Open this STATE.md
2. Read `.planning/ROADMAP.md` Phase 1 detail
3. Run `/gsd:plan-phase 1`

**Files of record:**

- `.planning/PROJECT.md` — what we're building + why + decisions
- `.planning/REQUIREMENTS.md` — 67 v1 REQ-IDs with phase traceability
- `.planning/ROADMAP.md` — phases, success criteria, dependencies
- `.planning/research/SUMMARY.md` — research convergence + open questions
- `.planning/codebase/CONCERNS.md` — existing-app gaps Phase 1 addresses
- `.planning/STATE.md` — this file (project memory)

---
*State initialized: 2026-05-28*
