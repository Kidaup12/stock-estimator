# Odoo Connector — Design / Spec

**Date:** 2026-06-11
**Goal:** Let an Odoo-based shop owner connect her store to Wezesha and pass the cold 5-minute test — "what do I order this week and what will it cost?" — on her own real data, with traceable numbers. This is the first non-Shopify source and the foundation for productized Odoo onboarding.

## Definition of done (client test)

A non-technical shop owner, handed the app cold with no explanation, can answer "what do I order this week and what will it cost?" in under 5 minutes, with numbers she can trust and trace. Measured against the existing product rubric (sync foundation, run rate, Buy List, budget/horizon, order loop, promos, users) — applied to Odoo as the data source.

## Current state

- **Zero Odoo code.** "odoo" appears only in `.planning/` docs and `.env.example`. Pure greenfield.
- **Ingest is Shopify-coupled:** `lib/shopify/*`; schema has `ShopifyConnection`, `Product.shopifyProductId` (required + unique per tenant), `Location.shopifyLocationId`, `IngestCursor.source="shopify"`.
- **Downstream is source-agnostic:** forecast engine (`lib/forecast/*`), planner, Buy List, order loop, promos, users/roles, backtest all run off the Prisma models — they don't care where data came from. Rubric §§2–7 ride free once Odoo data lands in `Product` / `SalesHistory` / `InventoryLevel` / `Supplier`.

## Odoo External API (verified against docs, v17)

- **Protocol:** XML-RPC, two endpoints — `/xmlrpc/2/common` (auth) and `/xmlrpc/2/object` (data).
- **Auth:** `common.authenticate(db, username, api_key, {})` → integer `uid`. **API key replaces the password**; login stays in use. Key generated in Odoo → My Profile → Account Security → New API Key (v14+).
- **Reads:** `object.execute_kw(db, uid, api_key, model, 'search_read', [domain], {fields, limit, offset})`. Supports `limit`/`offset` → page reads.
- **Credentials (exactly four):** instance URL, database name, username (login email), API key. `uid` is derived, not supplied.
- **IDs:** every record has a stable integer `id` per database; products also carry `default_code` (SKU, nullable). Stock + order lines reference `product.product` (variant) — key Wezesha `Product` on the Odoo `product.product` id.
- **Currency:** client's Odoo currency confirmed = **KES**, so `standard_price` maps straight to `costKes` (same approach used for Shopify `unitCost`).

## Design

### Data flow
Odoo (XML-RPC) → `lib/odoo/` adapter → existing Prisma models → existing forecast engine → existing dashboard. New **tenant with `source="odoo"`**, isolated from Beauty Square.

### Schema (generalize — migration)
Productized path (real client, hourly cron), so generalize rather than repurpose Shopify fields:
- `Product`: add `externalId String?` + `source String @default("shopify")`; make `shopifyProductId`/`shopifyVariantId` **nullable**; new unique `(tenantId, source, externalId)`. Backfill existing rows `source="shopify"`, `externalId=shopifyProductId`.
- `Location`: add `externalId` + `source`; make `shopifyLocationId` nullable; analogous unique.
- New model `OdooConnection` (mirrors `ShopifyConnection`): `tenantId`, `baseUrl`, `database`, `username`, `apiKey` (AES-256-GCM ciphertext via existing `encrypt()/decrypt()`), `lastSyncedAt`, timestamps.
- `Tenant`: add `source String @default("shopify")` to pick the adapter in cron + ingest.
- `IngestCursor.source` already generic ("odoo" value).
- Migration via the project's `prisma migrate diff` → `migrate deploy` pattern (migrate dev is non-interactive-hostile here).

### `lib/odoo/` adapter (mirrors `lib/shopify/`)
- `client.ts` — XML-RPC client: `authenticate()` (cache uid in-process), `searchRead(model, domain, fields, {limit, offset})` with paging. No SDK needed (raw XML-RPC over `fetch`, like Shopify's raw approach).
- `ingest.ts` — maps + writes (batched ≥500-row rule — VALUES-join updates / deleteMany+createMany, never per-row loops on Vercel→EU Supabase):
  - `product.product` (+ `product.template` for name) → `Product` (sku=`default_code`, cost=`standard_price`→costKes; only write cost when present, never clobber).
  - `stock.quant` + `stock.location` → `Location` + `InventoryLevel` (on-hand per location). Sellable vs virtual/en-route location handling TBD per her setup (default: all real locations sellable; revisit if she has an incoming bucket).
  - **Sales auto-detect:** count `pos.order.line` and `sale.order.line`; ingest whichever has data (or both, merged) → `SalesHistory` (qty, product, date; day-bucketed idempotent SET semantics like `sales-window.ts`). Report which source was found.
  - `product.supplierinfo` (`delay`, partner) + `res.partner` → `Supplier` + per-product lead time.
- `reconcile.ts` — incremental (IngestCursor, day-aligned window) full-refresh of stock + idempotent sales writer + snapshot + re-forecast via `lib/forecast/run-batch.ts`. Mirror of `lib/shopify/reconcile.ts`.

### Cron (Vercel Pro, 800s)
- Extend `app/api/cron/reconcile/route.ts` to dispatch by `Tenant.source` → Shopify or Odoo reconcile. `?mode=sync|full`.
- `vercel.json` cron entry. **Depends on Dave's Vercel Pro upgrade** for the 800s budget; until then, manual sync.
- "Last synced X min ago" surfaced from `OdooConnection.lastSyncedAt` (+ Shopify equivalent) on the dashboard.

### Credentials UI (Settings)
- Settings → add an **Odoo connection** section (parallel to Shopify): URL, database, username, API key. POST → encrypt API key → `OdooConnection`. "Test connection" button (calls `common.authenticate`, reports uid/success). Trigger an initial sync after save.

## What rides free (existing, source-agnostic)
Rubric §§2–7: run rate + 3× cap, days-cover, order-by date (stockout − lead time), Buy List grouped-by-supplier with running total + traceable qty math (run rate × days + safety − stock − incoming), budget/horizon planner (≤ budget always, shows what didn't fit, traceable), order loop (multi-select mark-ordered → on-route → receive → stock up, reverse), promos (future spike + past-spike exclusion), users/roles (staff can receive but not see costs), monthly backtest. No-cost products flagged + excluded from money math (existing behavior).

## External dependencies
1. **Client creds:** URL, db, username, API key (entered in Settings UI).
2. **Vercel Pro** (Dave) before wiring the hourly cron.
3. Her Odoo reachable from Vercel (Odoo Online = yes).

## Success criteria
- Settings "Test connection" returns success (uid) against her instance.
- Initial sync lands her real products/stock/cost/sales; product count + 5 spot-checked stock numbers match Odoo by hand.
- Buy List shows ranked, supplier-grouped, costed reorder list with traceable math; planner respects a budget; no blow-ups.
- Cold 5-minute test passes with the real shop owner.
- Beauty Square (Shopify) unaffected — 2-tenant isolation test still green; tsc/lint clean.

## Open questions / risks
- **Sales source** (POS vs Sales) unknown → mitigated by auto-detect; confirm volume once connected.
- **Location semantics** (does she have an incoming/virtual location?) — default all-sellable; revisit after first sync.
- **product.template vs product.product** for catalogs with variants — ingest variants; confirm her catalog isn't template-only.
- XML-RPC over `fetch` needs an XML payload builder/parser (small dep or hand-rolled) — decide in plan.
- Historical sales window depth in her Odoo (forecast quality scales with it).

## Security
- API key stored AES-256-GCM encrypted (reuse `lib/crypto/encryption.ts`), never logged, never returned to client.
