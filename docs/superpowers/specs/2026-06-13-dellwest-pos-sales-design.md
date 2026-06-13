# Dellwest POS physical sales → forecasts (Track B1)

## Context

Wezesha only sees **Shopify (online)** sales. Beauty Square's **physical-shop** sales run through the Dellwest POS and are invisible to Wezesha, so run rates undercount every shop-floor seller → under-forecast → stockouts on in-store bestsellers. B1 closes that blind spot.

Probed live (2026-06-13): the Dellwest API **works from the n8n/Railway IP** (no Imunify360 block, no whitelist needed), and `/sales` is clean — each sale line carries `code` (= the Shopify **SKU**) and each sale has `created_by` (a staff name for physical, `"SHOPIFY"` for online). So we ingest **physical sales only** (`created_by ≠ SHOPIFY`), **matched by SKU** (no name-matching), into `SalesHistory channel="pos"`, which the forecast already sums alongside `channel="shopify"`. Online sales are untouched (they already arrive via the Shopify sync) — so no double-count.

B1 also stores the **raw** Dellwest sales (`PosSale`/`PosSaleLine`) so the later **B3 audit** (who-sold / warehouse / when) is a cheap view over data already captured. **B2 (physical-stock compare)** and **B3 (audit UI)** are separate later specs.

**Outcome:** forecasts and run rates reflect the whole business (online + shop floor), and the raw POS sales are on hand for audit.

## Decisions locked with the user

1. **Live Dellwest API from n8n** — confirmed reachable from Railway. No CSV, no IP whitelist.
2. **Match by SKU** (`line.code` → `Product.sku`). No name-matching.
3. **Physical only:** `created_by ≠ "SHOPIFY"` and `sale_status == "Completed"`.
4. **`channel="pos"`** in `SalesHistory` → forecast sums it with `shopify`. No double-count (online already comes from Shopify).
5. **Idempotent:** set-semantics per `(productId, day)` for the `pos` channel — re-pulling a window overwrites, never doubles.
6. **Store raw** `PosSale`/`PosSaleLine` (powers B3). **No Shopify writes. No forecast-engine change** (it already aggregates all channels).

## Non-goals (separate phases / YAGNI)

- Physical **stock** compare (B2).
- **Audit UI** over the raw data (B3) — B1 only *stores* it.
- Online sales (already via Shopify).
- Deep **returns/refunds** modelling — B1 counts `Completed` sales; returns handling is a follow-up.
- Staff/warehouse analytics — captured in the raw store, surfaced in B3.

## Architecture

```
Dellwest /sales ──(n8n: paginate, physical-only + Completed, since-date)──▶ POST /api/pos/sales
                                                                              (bearer QB_FEED_SECRET)
                                                                                     │
                                   ┌─────────────────────────────────────────────────┴────────┐
                                   │ upsert PosSale by (tenantId, externalId); replace lines;   │
                                   │ match line.sku → Product.id; derive SalesHistory channel=  │
                                   │ "pos" set-per-(product,day); report unmatched SKUs         │
                                   └─────────────────────────────────────────────────┬────────┘
                                                                                     ▼
                       forecast/run + /api/forecast already group SalesHistory by product across
                       ALL channels ⇒ run rate now = shopify + pos (no engine change)
```

## Components

### 1. Schema (Prisma, additive migration)
- `PosSale` — raw Dellwest sale header. Fields: `id`, `tenantId`, `externalId` (Dellwest sale id), `reference`, `date DateTime`, `createdBy`, `salesAgent String?`, `warehouse String?`, `customer String?`, `saleStatus`, `paymentStatus String?`, `grandTotal Float`, `channel` (`"physical"` — B1 only stores physical), `createdAt`. Unique `(tenantId, externalId)`. Index `(tenantId, date)`.
- `PosSaleLine` — `id`, `posSaleId`, `tenantId`, `sku`, `productName`, `qty Float`, `price Float`, `subtotal Float`, `productId String?` (matched Wezesha product, null when unmatched). Index `(tenantId, productId)`, `(posSaleId)`.
- Relations: `PosSale.lines PosSaleLine[]` (cascade), `Tenant.posSales`, `Product.posSaleLines` (`onDelete: SetNull`). Additive + live-safe.

### 2. Ingest endpoint `POST /api/pos/sales`
- Auth: `Authorization: Bearer <QB_FEED_SECRET>` (reuse the existing system-feed secret; middleware exempts `/api/pos/sales` like `/api/qb/catalog`).
- Body (zod): `{ slug, sales: [{ externalId, reference, date, createdBy, salesAgent?, warehouse?, customer?, saleStatus, paymentStatus?, grandTotal, lines: [{ sku, name, qty, price, subtotal }] }] }`. Cap ~10k sales/post (n8n chunks if larger).
- Steps (batched — no per-row loops, the Vercel→Supabase rule):
  1. Resolve tenant by `slug` (system query, eslint-disabled like the QB feed).
  2. Build `sku → productId` map from the tenant's products (one `findMany`).
  3. Upsert `PosSale` by `(tenantId, externalId)`; replace its `PosSaleLine`s (deleteMany + createMany), setting `productId` from the SKU map.
  4. **Derive SalesHistory:** for every line with a matched `productId`, aggregate `(productId, dayUTC)` → `{ qty, revenue=Σsubtotal }`. For the affected `(productId, day)` set, `deleteMany channel="pos"` then `createMany` (set-semantics → idempotent).
  5. Report `{ salesIngested, linesMatched, linesUnmatched, sampleUnmatchedSkus }`.
- Day bucketing uses the tenant timezone (`Africa/Nairobi`) — reuse `lib/time/tenant-date` so a sale at 19:00 EAT lands on the right local day (matches the Shopify/Odoo sales writers).

### 3. Forecast integration
- **None required.** `forecast/run`, `run-batch`, and `/api/forecast` already group `SalesHistory` by product with no channel filter, so `pos` rows are summed into the run rate automatically. (Add a test asserting a `pos` row raises the computed run rate.)

### 4. n8n "Dellwest → Wezesha POS sales feed" (built via MCP, mirrors the QB feed)
- Schedule (hourly or daily) + manual trigger.
- Code node: paginate `GET /api/sales?page=N` (Laravel pagination, newest-first) until `date < sinceDate` (e.g. last 120 days for the first load, then incremental). Keep sales where `created_by !== "SHOPIFY"` and `sale_status === "Completed"`. Map each → `{ externalId:id, reference:reference_no, date, createdBy:created_by, salesAgent, warehouse, customer, saleStatus:sale_status, paymentStatus:payment_status, grandTotal:grand_total, lines: products.map(p => ({ sku:p.code, name:p.product_name, qty:p.qty, price:p.price, subtotal:p.subtotal })) }`.
- HTTP POST the batch to `/api/pos/sales` with the bearer secret + `slug`.

## Error handling
- Zod failure → 400 with details; no partial writes.
- Unmatched SKUs (a Dellwest `code` with no Wezesha product) → line stored with `productId=null`, **counted + sampled** in the response (so a SKU drift is visible, not silent); excluded from SalesHistory.
- `code` of `"0"` or blank → treat as unmatched (skip SalesHistory), still stored raw.
- Re-running the same window is idempotent (PosSale upsert + SalesHistory set-semantics).

## Testing
- Unit (pure): a `sku → productId` matcher + the `(product, day)` aggregation/bucketing (timezone correctness; physical-only filter is upstream but assert the endpoint trusts it).
- Endpoint: auth reject; zod; upsert + line replace; SalesHistory set-semantics idempotency (post twice → no doubling); unmatched reporting.
- Forecast: a `pos` SalesHistory row increases the product's run rate (channel-agnostic sum).
- Gates: tsc clean, eslint 0 errors, vitest green.

## Verification (end-to-end)
1. Migration applied; no behavior change until a feed runs.
2. POST a small fixture of physical sales → response shows `salesIngested`/`linesMatched`; `PosSale`/`PosSaleLine` rows exist; `SalesHistory channel="pos"` rows exist for matched lines.
3. Post the **same** fixture again → counts identical, no doubled SalesHistory.
4. Re-run `forecast/run` → a product with new `pos` sales shows a higher run rate / recommendation than before.
5. Run the n8n feed against live Dellwest → physical-only sales land; unmatched-SKU count is sane; spot-check one product's run rate reflects shop-floor + online.

## Open / hand-offs
- **Returns:** confirm how Dellwest marks returns (a `sale_status`, negative qty, or a separate endpoint) → subtract in a follow-up.
- **Sync cadence + window:** hourly vs daily; first-load lookback (propose 120 days, then incremental by max ingested date).
- **B2 (stock compare)** and **B3 (audit UI)** — separate specs; both reuse this feed/raw store.
