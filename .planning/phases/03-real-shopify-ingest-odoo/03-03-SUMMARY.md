# Plan 03-03 Summary — Real Shopify ingest + guarded synthetic→real cutover

status: complete-verified
plan: 03-03
phase: 03-real-shopify-ingest-odoo
requirements: [SHOP-03, SHOP-04, SHOP-08]
completed: 2026-06-04

## What was built

- **`lib/shopify/shopify.ts`** — Admin API client over **raw fetch** using the OAuth **client-credentials grant** (D-02 re-sequenced). `getAdminToken(shopDomain)` mints a short-lived `shpat_` token (`expires_in≈86399`, ~24h), caches it in-process with a 60s refresh skew, and re-mints on a 401. No `@shopify/shopify-api` SDK (that exists for authorization-code *sessions*, which client-credentials doesn't use). `shopifyGraphql()` retries 3× on transport blips (Roy's Kenya↔EU link) and surfaces GraphQL `errors`.
- **`lib/shopify/bulk.ts`** — `runBulkQuery()` launches `bulkOperationRunQuery`, polls `currentBulkOperation` every 2s (30-min ceiling), downloads the temporary JSONL URL. Three exported query builders: `ordersBulkQuery(365)`, `productsBulkQuery()`, `inventoryBulkQuery()` (uses `quantities(names:["on_hand"])` — never `available`, D-09). Documents the one-bulk-op-per-shop serialize rule.
- **`lib/shopify/jsonl.ts` + `jsonl.test.ts`** — streaming `parseBulkJsonl()` that reassembles flat `__parentId` children into parents. **8 tests pass** (nesting, orphan buffer, malformed-line tolerance, empty input, `_unknown` bucket regression).
- **`lib/shopify/ingest.ts`** — four reusable tenant-scoped idempotent mappers (the REUSE SEAM for Plans 04/05): `upsertProductFromShopify`, `upsertLocationFromShopify`, `upsertInventoryLevel`, `upsertOrderAsSales`. Real `productType` mapped straight through (D-08, never crashes).
- **`lib/shopify/cutover.ts`** — `cutoverToReal(tenantId, realData, {confirm})`: refuses without `confirm===true`; one `$transaction` doing **child-first tenant-scoped deletes** (Order→Prediction→SalesHistory→Product), then real inserts via the ingest mappers. **Never references Supplier/Promo/MonthlyContext** (owner-entered, preserved). Inserts run outside the txn (per-row upserts; resumable).
- **`app/api/shopify/backfill/route.ts`** — POST: dry-run by default (returns synthetic-vs-real counts, no writes); `?cutover=confirm` invokes `cutoverToReal`. Resolves shopDomain from `ShopifyConnection`; mints token at runtime (does NOT decrypt a stored token).
- **`app/api/shop/test/route.ts`** — rewritten: real tenant-scoped connection status (no mock, no token exposure).
- **Mock deleted** — `lib/shopify/client.ts` removed; its `eslint.config.mjs` tenant-safety allow-list entry removed; no dangling refs.
- **Execution harnesses** (CLI, run with dev server stopped — Supabase pooler cap): `scripts/shopify-setup-connection.ts` (creates ShopifyConnection + sets Tenant.shopifyDomain), `scripts/shopify-backfill.ts` (dry-run/`--confirm` driver, caches the bulk fetch to `.planning/_bulk-cache.json`), `scripts/shopify-finish-sales.ts` (resumable orders→SalesHistory step).

## Verified (live, Beauty Square — beauty-square-ke-3.myshopify.com)

- **client-credentials grant → `shop.json` HTTP 200** with the minted `shpat_` token; the stale `atkn_` env token returns 401 (confirmed dead — runtime mints fresh, so it's irrelevant).
- Backfill via Bulk Operations cached **1100 products / 4 locations / 2128 orders**.
- **Guarded cutover ran**: synthetic 1023 products replaced by real. Post-cutover live DB:
  - products **1100**, salesHistory **2936**, locations **4**, inventoryLevels (on_hand) **3920**.
  - predictions **719**, reorder Orders **98** (93 critical / 5 high / 17 medium / 604 low) after re-running `scripts/run-forecasts.ts` on real data.
  - suppliers unchanged (0 — none existed pre-cutover; preserved, not deleted).
- Spot-check proves real catalog: `ANUA AIRY SUN CREAM` (sku 11356, KES 2800, stock 13), etc.
- `npx vitest run lib/shopify/jsonl.test.ts` → **8 passed**. `npx tsc --noEmit` → no Shopify errors. `npm run lint` → **0 errors** (mock gone, allow-list entry removed).

## Findings / calibration items (for Phase 5)

- **`productType` is empty** on Beauty Square's products (Shopify product_type unset) → kenya-calendar category holiday-boosts won't fire until a vendor/title→category normalization map is added. Forecast tolerates empty type (D-08 confirmed live).
- **462 of 1100 products have zero sales history** (real dead/new SKUs) → 719 predictions, not 1100. Expected for a real long-tail catalog (synthetic gave every SKU history).
- **`isPrimary` landed on Lavington** (first *active* location returned by Shopify), not the online-fulfilment "New Stanley CBD". SHOP-08 (primary = first active) is satisfied; `Product.currentStock` sums on_hand across **all** locations, so forecasts are unaffected. Flagged for Roy if the primary label should be pinned to the online location.

## Variant granularity (Open Question #4)

Products ingested at the **product** level keying on the first variant's sku/price/inventoryItem; InventoryLevel keyed on `(locationId, productId)` with summed on_hand. Beauty Square's catalog is effectively single-sellable-variant per product for forecasting — confirmed adequate. Multi-variant split deferred (not needed for v1 reorder math).

## Reuse contract for Plans 04/05

`lib/shopify/ingest.ts` exports — webhooks (04) and nightly reconcile (05) call these directly:
- `upsertProductFromShopify(tenantId, node, currentStock=0): Promise<string>`
- `upsertLocationFromShopify(tenantId, node, {isPrimary}): Promise<string>`
- `upsertInventoryLevel(tenantId, locationId, productId, onHand): Promise<void>`
- `upsertOrderAsSales(tenantId, orderNode, productIdByShopifyGid): Promise<number>`

`cutoverToReal(tenantId, RealIngest, {confirm}): Promise<CutoverResult>` — Supplier/Promo/MonthlyContext provably preserved.

## Deviations

- **client-credentials mint-on-demand instead of a stored static token** (Plan assumed a Plan-02 OAuth session + decrypted stored token). The granted token is ~24h-lived, so a static store would go stale; the runtime mints from `SHOPIFY_API_KEY`/`SECRET` and caches in-process. `ShopifyConnection.accessToken` still holds an encrypted snapshot (field is required + documents the per-tenant credential model for multi-tenant). Same outcome, more robust.
- **Granted scopes are read-only** (`read_products,read_orders,read_inventory,read_locations`) — sufficient for Phase 3 ingest; PO writes are QuickBooks' job in Phase 4, not Shopify.
- **Sales backfill interrupted at order ~1200/2128** (flaky link) and finished via the resumable `shopify-finish-sales.ts` (928 remaining orders → 1792 sales rows). Bulk JSONL cached so the expensive fetch was never repeated.
- Backfill executed via the **CLI harness**, not the HTTP route, to run with the dev server stopped (pooler cap) and to surface the dry-run counts at the human checkpoint. The route is identical-logic and remains for the deployed multi-tenant path.

## Self-Check: PASSED
