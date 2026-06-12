# Shopify Product — Trust & Checklist Gaps Plan

**Date:** 2026-06-12
**Source:** Dave's definition-of-done checklist (Beauty Square / Shopify product).
**Goal:** Close the 8 gaps found in the 2026-06-12 audit so the app fully satisfies Dave's DoD — "a non-tech owner can answer *what do I order this week + cost* in 5 min, cold, with traceable numbers."

Branch: `feat/shopify-trust-gaps` off `main`. (Separate from `feat/odoo-connector`.)

## Audit verdict
Core works (run rate, days-left, order-by dates, Buy List, budget moat, full order loop). 8 gaps remain — mostly trust-UX + self-checking automation.

## Gaps, prioritized

### Quick wins (UI / data already present)
**G2 — "Synced X min ago" on the main screen.** Data exists: `GET /api/shop/status` → `shopify.lastSyncAt`. Add a `<SyncStatus>` in `app/shop/[slug]/nav.tsx` footer: relative time, amber when stale (> 2h). *(This plan implements it.)*

**G3a — "Capped" label on the Buy List.** Data exists: forecast payload already ships `signals` incl. `✂️ Capped at 3× best month` (`lib/forecast/simulate-layers.ts:225`). Surface a small ✂️ chip on reorder rows in `app/shop/[slug]/dashboard/page.tsx` (and/or restock-planner) when a prediction's `signals` contains a "Capped" entry. UI-only.

**G3b — Tap qty → see the math.** Per reorder line, add an expand/tooltip showing the components: `run rate × cover days + safety − stock − incoming = qty`. The pieces are in the payload (`runRate`, `recommendedQty`, `safetyStock`, `currentStock`, `onOrder`, `leadTimeDays`). Render the equation; no new compute. `dashboard/page.tsx` + `restock-planner/page.tsx`.

### Security / correctness
**G4 — MEMBER cannot see costs/budgets.** `requireTenant()` returns `membership.role`. Today `GET /api/forecast` (and `/api/products`, `/api/reports`, restock-planner budget routes) send `costKes`, `stockValueKes`, `reorderCostKes`, margins to every role. Fix **server-side**: when `role === "MEMBER"`, omit/null all cost+margin fields in those routes (never ship to the browser). Then hide cost columns + the Restock Planner (budget) nav item for MEMBER. Files: `app/api/forecast/route.ts`, `app/api/products/route.ts`, `app/api/reports/route.ts`, `app/api/restock-planner|simulate/*`, `nav.tsx` (hide planner+settings for MEMBER), the cost-rendering pages. Add a 2-tenant/2-role test asserting a MEMBER payload carries no cost.

**G1 — Sync-fail visible warning.** Today only `lastSyncAt` is surfaced (no failure signal). Add: persist last sync outcome (extend the reconcile cron to write `lastSyncError` + `lastSyncAt` — store on `ShopifyConnection` via 2 new nullable columns, migration additive). `/api/shop/status` returns it; `<SyncStatus>` shows a red "Sync failed — last ok Xh ago" when error set or `lastSyncAt` older than 2× the sync interval. Files: schema (additive migration), `lib/shopify/reconcile.ts` (record outcome), `app/api/cron/reconcile/route.ts` (catch→persist), `status` route, `nav.tsx`.

### Forecast logic (needs backtest discipline)
**G6promo — Exclude past promo spikes from run rate.** Today run rate is recency-weighted, so a recent promo/Black-Friday spike inflates the baseline. Fix: when computing the baseline daily rate, down-weight or drop days that fall inside a recorded `Promo` window (scope-matched) for that product. Implement in `lib/forecast/simulate-layers.ts` / `baseline.ts`; gate behind a flag; **re-run the walk-forward backtest** (`scripts/walkforward-backtest.ts`) to confirm it doesn't worsen accuracy before enabling. Add unit tests for the spike-exclusion helper.

### Self-checking automation (internal)
**G6 — Auto monthly backtest + accuracy log.** Wrap `scripts/walkforward-backtest.ts` logic into a callable, add `app/api/cron/backtest/route.ts` (CRON_SECRET), `vercel.json` monthly cron (`0 2 1 * *`), and persist results to a new `BacktestRun` model (date, MAE, bias, MAPE, sampleSize per tenant). Surface latest on an internal page or Settings (RK-only).

**G7 — Accuracy-drop / May-hole alert.** After each backtest + each sync: detect (a) MAE worsening > X% vs prior run, (b) a gap in `SalesHistory` days (the "May-hole"). On trigger, send a Resend email to RK/Roy (needs `RESEND_API_KEY`). New `lib/monitor/` + hook into the backtest + reconcile crons.

**G8 — Spot-check prompt.** Weekly, pick 5 high-value/uncertain SKUs and prompt the owner to physically count them; capture the count, compare to system on-hand, flag drift. New `lib/spotcheck/` + a dashboard card + a small `SpotCheck` model. Lowest priority (nice-to-have per Dave's "ensure most").

## Sequencing
1. **This PR:** G2 (synced badge) — shipped here. 
2. Next: G3a + G3b (Buy List trust UX), G4 (MEMBER cost-hiding — security).
3. Then: G1 (sync-fail), G6promo (with backtest).
4. Then internal: G6, G7, G8.

## Gates (every task)
tsc clean · eslint 0 · vitest green (add tests for G4, G6promo, G6). Deploy is **manual Vercel CLI** — nothing live until deployed.
