# Design — Nightly Shopify Reconcile + Inventory-Position View

**Date:** 2026-06-05
**Status:** Approved (brainstorming) — pending implementation plan
**Phase context:** Phase 3 (real Shopify ingest). Builds on Plan 03-03 (live ingest + cutover). Replaces/refines the original Plan 03-05 (nightly reconcile) and adds an inventory-position reporting view.

## Summary

Two features in one spec, built in this order:

1. **Inventory-position view** (build first) — a Reports-page section that, per product grouped by ABC class, shows run rate, opening stock, current on-hand, en-route quantity (+ETA), supplier lead time, and days-of-cover. Uses data already modeled; the only new storage is a lightweight inventory snapshot.
2. **Nightly Shopify reconcile** (build second) — a tenant-scoped, idempotent, non-destructive job that keeps `Product`/inventory/sales fresh from Shopify on a nightly cadence, advances per-resource cursors, snapshots inventory, and re-runs forecasts.

The two features share one primitive: `snapshotInventory(tenantId)`. The view seeds and reads snapshots; the reconcile writes one every night. This lets the view ship standalone (today's snapshot as a baseline) while the reconcile enriches the opening-stock history over time — no rework.

## Goals / Non-goals

**Goals**
- Owner can see, per product (A/B/C grouped), the full reorder picture in one table: how fast it sells, how much is on the shelf, how much is incoming and when, how long the supplier takes, and how many days of cover remain.
- App data (catalog, on-hand inventory, sales) stays current automatically each night without manual backfills.
- Both features respect multi-tenant isolation (every query carries `tenantId`; the tenant-safety ESLint rule applies).

**Non-goals**
- Real-time inventory (webhooks, Plan 03-04) — nightly is sufficient; webhooks remain a future option if intra-day freshness is later required.
- Receipts/goods-in tracking model — out of scope; opening stock is measured via snapshots, not back-derived from receipts.
- QuickBooks source-of-truth merge (Phase 4).
- Odoo (deferred).

## Existing data (no schema change for these)

| Concept | Source |
|---|---|
| Run rate | `Product.dailySalesRate` |
| ABC class | `Product.abcCategory` ("A"/"B"/"C") |
| Current on-hand | `Product.currentStock` (sum of on_hand across locations, set by ingest/reconcile) |
| En-route quantity | `Product.onOrder` (incremented on PO approve; subtracted in reorder math, FND-04) |
| En-route ETA | `Product.expectedArrivalAt` |
| Lead time | `Supplier.leadTimeAvgDays`, `Supplier.leadTimeStdDays` |
| Cursors for incremental sync | `IngestCursor (tenantId, source, resource, cursor: DateTime?)` |

New storage (one model): `InventorySnapshot`.

---

## Feature 1 — Inventory-Position View

### New model

```prisma
model InventorySnapshot {
  id        String   @id @default(cuid())
  tenantId  String
  productId String
  date      DateTime // UTC midnight of the snapshot day
  onHand    Float

  tenant  Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, date])
  @@index([tenantId, date])
}
```

Additive migration via `prisma migrate diff --script` + `migrate deploy` (the Supabase-safe, non-interactive path — `migrate dev` blocks on data-loss prompts; dev server must be stopped for the pooler connection cap). Add the back-relations on `Tenant` and `Product`.

### Snapshot primitive (shared seam)

`lib/inventory/snapshot.ts`:

```
snapshotInventory(tenantId: string): Promise<{ count: number }>
```

- Upserts one row per product for **today** (UTC midnight key) with `onHand = Product.currentStock`.
- Idempotent on `(productId, date)` — re-running the same day overwrites, never duplicates.
- Tenant-scoped (carries `tenantId`).
- Called by: `run-forecasts` / `/api/forecast/run` (now) and the nightly reconcile (Feature 2).

This primitive is built as part of Feature 1 so the view works immediately. On first run it seeds today's snapshot; the Opening column is meaningful from day one (opening == current until depletion accrues) and becomes a true measured opening as days pass.

### Aggregation endpoint

`app/api/inventory-position/route.ts` (GET, tenant-scoped via `requireTenantOrResponse`):

Query param: `window` (days, default 30).

Per product, returns:
- `runRate` = `dailySalesRate`
- `currentOnHand` = `currentStock`
- `openingOnHand` = on-hand at the start of the window:
  - **Measured:** the `InventorySnapshot.onHand` for the snapshot on/just-before `today - window`.
  - **Fallback** (no snapshot that old — window predates tracking): estimate `currentStock + soldInWindow`, where `soldInWindow = sum(SalesHistory.quantity)` over the window. Flagged `openingEstimated: true` so the UI can mark it.
- `enRoute` = `onOrder`; `enRouteEta` = `expectedArrivalAt`
- `leadTimeAvgDays`, `leadTimeStdDays` (from the product's supplier; null if unassigned)
- `daysOfCover` = `currentStock / dailySalesRate` (null/∞-guard when `dailySalesRate == 0`)
- `abc` = `abcCategory` (null → treated as "C")

Response groups rows under `A`, `B`, `C`, each with subtotals: count, total opening, total current, total en-route, and a weighted/representative lead time. Also a top-level `trackingSince` (earliest snapshot date) so the UI can show "opening measured since <date>."

Follows the existing reports-route pattern: `Promise.all` the products + supplier + sales-window + snapshot queries, assemble maps, compute in memory, return JSON. No Prisma access from the page component.

### UI

New section/tab on the existing Reports page (`app/shop/[slug]/reports/page.tsx`): an "Inventory Position" block.
- Three collapsible groups (A / B / C) with a subtotal header row each.
- Columns: Product | Run rate (/day) | Opening | Current | En route (qty + ETA) | Lead time (avg ± std) | Days cover.
- Days-of-cover cell color-coded against lead time (cover < lead time ⇒ at-risk highlight) — reuses the dashboard's urgency color tokens.
- A window selector (30 / 60 / 90d). Estimated-opening rows show a small "~" / tooltip ("measured from <trackingSince>").
- Client component fetching `/api/inventory-position?window=…` on mount (matches existing page pattern).

### Error / edge handling
- Product with no supplier ⇒ lead-time cells render "—".
- `dailySalesRate == 0` ⇒ days-cover "—" (not ∞), opening estimate still valid.
- No snapshots yet ⇒ all openings use the fallback estimate; banner: "Opening stock tracking starts today."

---

## Feature 2 — Nightly Shopify Reconcile

One orchestrator, two triggers, non-destructive.

### Orchestrator

`lib/shopify/reconcile.ts`:

```
reconcileTenant(tenantId: string): Promise<ReconcileResult>
```

Steps (per tenant), each resource advancing its own cursor only after its upserts succeed:

1. **Window:** read `IngestCursor` for `orders` and `products`. Window start = `cursor` rounded **down to UTC midnight**, minus a 6h safety overlap. First run (no cursor) = `now - 48h` (backfill already loaded 365d).
2. **Products** changed since window (`products(query: "updated_at:>=<start>")`, paginated GraphQL) → `upsertProductFromShopify` (reuses Plan 03-03 mapper). Advance products cursor = run start.
3. **Inventory full refresh:** paginated `locations { inventoryLevels { quantities(names:["on_hand"]) … } }` → `upsertLocationFromShopify` (first active = primary) + `upsertInventoryLevel`; recompute each `Product.currentStock` = summed on_hand. (No cheap "changed-since" filter for inventory, so refresh in full; ~3920 levels ≈ 16 pages, cheap.)
4. **Orders** changed since window (`orders(query: "updated_at:>=<start>")`, paginated) → **idempotent sales writer** (below). Advance orders cursor = run start.
5. **Snapshot:** call `snapshotInventory(tenantId)`.
6. **Re-forecast:** run the tenant's forecast (reuse the forecast-run path).

Returns counts per resource.

### Paginated query helpers

Bulk Operations stay for the one-time backfill only (minutes-long, one-op-per-shop, inline polling — a bad fit for a scheduled serverless function). Reconcile adds regular **cursor-paginated** GraphQL helpers (`pageInfo { hasNextPage endCursor }` loops) for products / orders / inventory. Nightly delta volume is small, so this stays well within the function timeout and the cost-based rate limit.

### Idempotent sales writer (the one real trap)

The Plan 03-03 mapper `upsertOrderAsSales` uses `quantity: { increment }` — correct for the clean-slate cutover, **wrong for reconcile** (re-processing an order inside the 6h/day overlap would double-count).

Reconcile uses a **different writer**: `applySalesForWindow(tenantId, orders, fromDayInclusive)`:
- Bucket the window's order line items by `(localProductId, dayUTC)`, summing quantity and revenue in memory.
- Because the window re-pulls **whole days** (start rounded to midnight), each affected day is pulled in full.
- Upsert each `(product, day)` `SalesHistory` with **`set`** (overwrite), not increment.
- Result: running it twice over the same window yields identical totals — idempotent.

Lines whose product isn't in the catalog are skipped (same as 03-03). This writer lives next to the mappers and is unit-tested.

### Triggers

- `scripts/shopify-reconcile.ts` — CLI for now (run locally with the dev server stopped). Prints the per-resource counts.
- `app/api/cron/reconcile/route.ts` — GET, authorized by `Authorization: Bearer <CRON_SECRET>` (no user session; reject otherwise). Loops every tenant with a live `ShopifyConnection` (`uninstalledAt == null`) and calls `reconcileTenant`, per-tenant try/catch so one failure doesn't abort the rest. `maxDuration` set for the paginated work.
- `vercel.json` cron entry: `{ "path": "/api/cron/reconcile", "schedule": "0 23 * * *" }` (23:00 UTC = 02:00 EAT, low traffic; nightly fits Vercel Hobby's daily-cron limit). Added now, dormant until deploy. `CRON_SECRET` added to env.

### Error handling
- Per-tenant isolation in the cron loop (one tenant's failure is logged, others proceed).
- Per-resource cursor advance only on that resource's success ⇒ a mid-run crash re-pulls just the unfinished resource next night; nothing is lost or double-applied (writer is idempotent).
- Shopify transport already retried in `shopifyGraphql` (3× backoff for the flaky Kenya↔EU link).

---

## Module boundaries

| Unit | Purpose | Depends on |
|---|---|---|
| `lib/inventory/snapshot.ts` | Upsert today's on-hand per product (idempotent) | prisma |
| `app/api/inventory-position/route.ts` | Aggregate the ABC-grouped position table | prisma, requireTenant |
| Reports page "Inventory Position" section | Render groups + columns | `/api/inventory-position` |
| `lib/shopify/reconcile.ts` | Orchestrate nightly incremental sync | shopify.ts (paginated helpers), ingest.ts mappers, sales writer, snapshot.ts, forecast path |
| paginated query helpers | Cursor-paginated products/orders/inventory reads | shopify.ts `shopifyGraphql` |
| `applySalesForWindow` | Idempotent day-aligned sales upsert | prisma, ingest types |
| `app/api/cron/reconcile/route.ts` | Auth + per-tenant loop | reconcile.ts, CRON_SECRET |
| `scripts/shopify-reconcile.ts` | Local trigger | reconcile.ts |

## Testing

**Unit (vitest):**
- `applySalesForWindow`: fixture orders → expected `(product, day)` totals; **idempotency** — run twice, totals unchanged (no doubling). The core correctness test.
- Window computation: day-alignment, 6h overlap, first-run 48h fallback.
- `snapshotInventory`: upsert idempotency on `(productId, date)`.
- Opening-stock resolution in the position endpoint: measured (snapshot present) vs estimated (snapshot absent) branch.

**Live:**
- Inventory-position endpoint vs beauty-square: counts sane, A/B/C subtotals add up, days-cover sensible.
- `scripts/shopify-reconcile.ts` against beauty-square: products/inventory/sales counts plausible; run **twice** and confirm SalesHistory totals do not change (idempotent); a snapshot row written for today.

**Gates:** `npx tsc --noEmit` clean; `npm run lint` 0 errors (tenant-safety passes — all new queries carry `tenantId`); `npx vitest run` green.

## Build order

1. `InventorySnapshot` model + additive migration.
2. `snapshotInventory` primitive + wire into forecast-run; seed today's snapshot.
3. `/api/inventory-position` endpoint + unit tests.
4. Reports "Inventory Position" section (UI).
5. Paginated GraphQL helpers + `applySalesForWindow` + unit tests.
6. `reconcileTenant` orchestrator.
7. `scripts/shopify-reconcile.ts`; run live twice (idempotency check).
8. `app/api/cron/reconcile/route.ts` + `CRON_SECRET` + `vercel.json` (dormant until deploy).

## Open questions (none blocking)
- Exact days-of-cover risk threshold for color-coding (cover < lead time is the default; tune with Roy on real data).
- Whether to retain snapshots indefinitely or prune > 1y (defer; volume is tiny).
