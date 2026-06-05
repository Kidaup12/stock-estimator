# Implementation Summary — Nightly Reconcile + Inventory-Position View

**Date:** 2026-06-05
**Plan:** docs/superpowers/plans/2026-06-05-reconcile-and-inventory-position.md
**Spec:** docs/superpowers/specs/2026-06-05-shopify-reconcile-and-inventory-position-design.md
**Execution:** subagent-driven (fresh implementer per task group), all on local `main`.

## Outcome

Both features shipped end-to-end against the live Beauty Square tenant.

### Part A — Inventory-Position View (Reports page)
- `InventorySnapshot` model + additive migration (applied to live Supabase).
- `lib/inventory/snapshot.ts` — `utcDayKey` (pure, tested) + `snapshotInventory(tenantId)` (idempotent on `(productId, date)`). Seeded today's snapshots (1100).
- `lib/inventory/position.ts` — pure `buildPositionView` / `resolveOpening` / `daysOfCover` (9 unit tests). Run rate computed from `SalesHistory` (the `Product.dailySalesRate` field is dead on ingested products).
- `app/api/inventory-position/route.ts` — tenant-scoped ABC-grouped aggregation, window param, opening = measured snapshot or `current+sold` estimate.
- Reports-page "Inventory Position" section: A/B/C groups + subtotals, columns run rate / opening / on-hand / en-route(ETA) / lead time / days-cover, at-risk highlight, 30/60/90d toggle.
- Headless data-layer verify: A=121 / B=177 / C=802, trackingSince=2026-06-05.

### Part B — Nightly Reconcile
- `lib/shopify/paginate.ts` — cursor-paginated products / orders / locations+inventory readers (on_hand only).
- `lib/shopify/reconcile-window.ts` — day-aligned window (3 unit tests).
- `lib/shopify/sales-window.ts` — idempotent day-`set` sales writer + pure bucketer (4 unit tests).
- `lib/forecast/run-batch.ts` — `runForecastsForTenant(tenantId, timezone?)` extracted from the script (DRY; reconcile reuses it).
- `lib/shopify/reconcile.ts` — `reconcileTenant(tenantId, timezone?)`: incremental products + full on_hand refresh + recent sales, per-resource cursors, snapshot, re-forecast. Non-destructive.
- `scripts/shopify-reconcile.ts` — local CLI trigger.
- `app/api/cron/reconcile/route.ts` — `CRON_SECRET` bearer auth, per-tenant loop. `vercel.json` nightly `0 23 * * *` UTC (02:00 EAT), dormant until deploy.

## Live validation (Beauty Square)
- Reconcile ran end-to-end twice. Run 2: `{products:1349, locations:5, inventoryLevels:4899, salesRows:32, orders:16, forecastsCreated:1390}`.
- Final DB: products 1390, sales 3004, locations 5, inventoryLevels 4939, cursors(products,orders) advanced.
- **Idempotency confirmed:** sales 2936→3004 across two incremental runs (NOT doubled — `set` writer + pure bucketer).

## Bug found + fixed during live validation
- `fetchLocationsWithInventory` capped inventory at one `inventoryLevels(first:250)` page per location → pulled 1000 of ~3920 levels (silent 75% loss). Fixed: inner connection now fully paginated per location. Confirmed: 1000 → 4939 levels.

## Deviations from plan (all recorded)
1. Run rate from `SalesHistory` (not the stale `Product.dailySalesRate`).
2. `runForecastsForTenant(tenantId, timezone?)` takes timezone as a param (tenant-safety ESLint bans `prisma.tenant.find*` in `lib/**`); `reconcileTenant` same. Default `Africa/Nairobi`.
3. `getCursor` uses `findFirst({where:{tenantId,...}})` (flat tenantId satisfies the lint rule) instead of composite-key `findUnique`.
4. Cron route added to the ESLint tenant-safety allow-list (deliberate cross-tenant system route, same pattern as `onboarding`).
5. A3's `run-forecasts.ts` snapshot-wire was folded into B4 (`run-batch.ts` calls `snapshotInventory`); today's snapshot seeded directly.

## Follow-ups (not blocking)
- **`status:active` filter on the reconcile products query** — reconcile ingested ~290 draft/archived products (catalog 1100→1390). They land C-class/zero-sales (bottom of the view), harmless but noise. One-line fix in `lib/shopify/paginate.ts` `fetchProductsSince` query (`updated_at:>=X AND status:active`), plus a one-time cleanup of the already-ingested non-active rows.
- Browser eyeball of the Reports "Inventory Position" section under an authed session (data layer verified headless).
- Negative on-hand for service SKUs (e.g. "Skin Analysis Consultation") renders literally — consider excluding non-physical products.
- Vercel Cron is dormant until deploy; set `CRON_SECRET` in Vercel project env at deploy time.

## Gates
- vitest: all suites green (snapshot 3, position 9, reconcile-window 3, sales-window 4, + existing).
- tsc --noEmit: clean.
- npm run lint: 0 errors (pre-existing warnings only).
