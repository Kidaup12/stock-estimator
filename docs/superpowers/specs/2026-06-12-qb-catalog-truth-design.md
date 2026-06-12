# QuickBooks catalog truth — kill "dead" products (Track A)

## Context

Wezesha's product catalog comes from Shopify and has drifted to ~2029 products, but Beauty Square only really sells ~1200 (plus some legitimately out-of-stock items). The extra ~800 are Shopify drafts/archived/discontinued rows that inflate every count, dilute the buy list, and erode trust in the numbers. QuickBooks is Beauty Square's accounting source of truth: **every product they actually sell is in QB.** So QB membership — not Shopify's catalog, not stock level — is the clean signal for "is this product real."

This spec makes QB an **authoritative clean-data overlay** on top of the Shopify-connected app: products QB doesn't have get soft-flagged out of the buy list and parked in a review bucket; products QB *does* have stay, **even when out of stock**. Nothing is deleted; nothing is written back to Shopify.

It is **Track A** of a two-track effort. Track B (ingest physical-shop sales from the Dellwest POS API) is a separate later spec. Track A intentionally builds the catalog-truth foundation first.

**Outcome:** the dashboard, planner, and forecasts operate on the real catalog; a "Not in QuickBooks" review list shows exactly which products were set aside and why, for the owner to investigate.

## Decisions locked with the user

1. **QB = source of truth by MEMBERSHIP, not stock.** In QB → real. Out-of-stock-in-QB is still real and **must never be flagged dead.** Only products QB has no record of get flagged.
2. **Soft-flag, never delete.** Flagged products are hidden from the buy list and separated into a review bucket the owner can investigate and override.
3. **Delivery = n8n feed.** n8n already connects to QB and matches QB→Shopify by product name (QB's SKU is empty). It emits a SKU-keyed feed; Wezesha ingests it. No QB OAuth in the app; no in-app name-matching for Track A.
4. **Wezesha stays the Shopify app.** QB is an additional overlay, not a replacement store source. The Shopify store connection is unchanged.
5. **Stock stays from Shopify for v1.** QB supplies membership + cost only. A QB-stock override is explicitly deferred (don't disrupt the working reconcile + en-route workflows).
6. **No Shopify writes.** Wezesha only reads/computes.

## Non-goals (YAGNI)

- No QuickBooks OAuth/client inside the Next.js app (n8n owns the QB connection).
- No product deletion.
- No QB-driven stock override (deferred).
- No Dellwest / physical-sales work (Track B).
- No in-app name-matcher for Track A (the feed arrives pre-matched + SKU-keyed; weak matches are flagged upstream and surfaced, not re-derived).

## Architecture

```
QuickBooks ──(n8n: getAll items + match→Shopify by name)──▶ SKU-keyed feed
                                                              │  [{sku, qbName, qtyOnHand, cost,
                                                              │    matchConfidence}]
                                                              ▼
                                          POST /api/qb/catalog  (bearer secret, OWNER/system)
                                                              │
                                          ┌───────────────────┴────────────────────┐
                                          │ ingest: mark matched products active,   │
                                          │ set qbMatchedAt + cost; flag the rest    │
                                          │ active=false; record a QbSyncRun         │
                                          └───────────────────┬────────────────────┘
                                                              ▼
              forecast/run skips active=false ─▶ no prediction ─▶ vanishes from dashboard/planner
                                                              │
                                          "Not in QuickBooks" review view (active=false list)
```

The lever is deliberately small: **`active=false` ⇒ no forecast ⇒ invisible to the buy list automatically**, plus one review view. We do not have to thread an `active` filter through every query — dropping the prediction is enough for the buy-list surfaces; the Products page gains an explicit filter + the review view.

## Components

### 1. n8n "QuickBooks catalog feed" workflow (lives in n8n, reuses the recon QB credential)
- Pulls QB items (`getAll`), matches each to a Shopify product **by name** (reuse the recon workflow's token-overlap matcher; flag matches below the confidence threshold instead of guessing).
- Emits one row per matched Shopify product: `{ sku, qbName, qtyOnHand, cost, matchConfidence }`. Unmatched QB items and weak matches are reported but not asserted as truth.
- POSTs the array to `POST /api/qb/catalog` with a bearer secret. Scheduled (daily) + manually runnable.
- A build-prompt for this workflow ships with the implementation (like `docs/n8n-cogs-export-prompt.md`); it supersedes the standalone COGS export by folding cost into the same feed.

### 2. Schema (Prisma, additive migration)
- `Product.active Boolean @default(true)` — false ⇒ flagged out of the buy list.
- `Product.activeOverride Boolean @default(false)` — owner pinned this product active; the flagger must never set it inactive.
- `Product.qbMatchedAt DateTime?` — last time QB confirmed this product (null = never confirmed).
- `Product.qbName String?` — the QB name it matched (audit/debug; helps the owner see why).
- `QbSyncRun` model (tenant-scoped): `{ at, matched, flagged, weak, totalProducts }` — audit trail + powers the Settings card. (Mirrors the lightweight run-record pattern already used for forecasts/backtests.)
- Additive + live-safe (defaults backfill existing rows to `active=true` so nothing changes until the first feed runs).

### 3. Ingest endpoint `POST /api/qb/catalog`
- Auth: bearer `QB_FEED_SECRET` (same pattern as `CRON_SECRET`) — it's a system write endpoint hit by n8n, not a user action. Tenant resolved from the feed/secret.
- Body (zod-validated): `{ rows: [{ sku, qbName, qtyOnHand?, cost?, matchConfidence? }] }`.
- Steps (one transaction / batched, never per-row loops — the project's hard rule for Vercel→Supabase):
  1. Match each row to a product by **SKU** (the feed is already name-resolved upstream). Set `active=true`, `qbMatchedAt=now`, `qbName`, and `costKes` (guarded: only when present, never clobber).
  2. **Flag the remainder:** Shopify-source products **not** present in this feed → `active=false`, **except** any with `activeOverride=true` (owner-pinned). Scope the flag to `source="shopify"` so other sources are untouched; only flag within the catalog the feed is authoritative over.
  3. Insert a `QbSyncRun` row with the counts.
- Idempotent: re-running the same feed yields the same active set. Returns `{ matched, flagged, weak, totalProducts }`.

### 4. Forecast + buy-list integration
- `forecast/run` and `run-batch` **skip `active=false`** products (no prediction created). They then fall out of dashboard/planner/export with zero per-surface changes. Existing predictions for newly-inactive products are pruned on the next run (the 30-day retention already handles stale predictions).
- Inventory-position / Products page: add an `active` filter (default: show active; toggle to see flagged).

### 5. "Not in QuickBooks" review view
- A page/tab listing `active=false` products with: title, SKU, last-30/90d sales, current stock, last `qbMatchedAt`. So the owner can see *why* it's flagged (e.g. "never matched", "dropped out of the feed on <date>") and decide.
- **Manual override:** a per-product "Keep active" action sets `active=true` + `activeOverride=true`, so the next feed won't re-flag it. Reversible (clear the override to let QB govern it again).

### 6. Settings — real QuickBooks card
- Re-add a **QuickBooks (clean data)** card, separate from the Shopify store card. Shows: last feed sync (`QbSyncRun.at`), matched / flagged / weak counts, and the feed endpoint + secret hint for wiring n8n. Read-only status; no OAuth.

## Error handling

- Feed validation failure → 400 with zod details; no partial writes.
- Empty/suspicious feed guard: if a feed would flag an implausible share of the catalog (e.g. >60% suddenly inactive), **do not apply** — record the run as `aborted` and surface a warning (protects against a broken/partial QB pull nuking the catalog). Threshold configurable.
- Weak matches: surfaced in the run summary + review view, never auto-applied as truth.
- Bad SKU in a row → counted as unmatched, reported, skipped.

## Testing

- Unit: the active-flag logic — (a) products in the feed → active; (b) **out-of-stock-in-QB product stays active** (the locked rule); (c) Shopify product absent from feed → active=false; (d) non-shopify-source product never flagged; (e) idempotent re-run; (f) the >60% abort guard.
- Endpoint: auth (reject without secret), zod validation, batched write, counts returned.
- Integration: feed a small fixture → assert active set + a `QbSyncRun` row + that `forecast/run` skips inactive.
- Gates: tsc clean, eslint 0 errors, vitest green (matches the project bar).

## Verification (end-to-end)

1. Apply migration; existing products default `active=true` (no behavior change yet).
2. POST a small sample feed to `/api/qb/catalog` with the secret → response shows matched/flagged counts; a `QbSyncRun` row exists.
3. Confirm an out-of-stock product that's in the feed stays `active=true`; a product absent from the feed becomes `active=false`.
4. Run `forecast/run` → flagged products get no prediction → absent from dashboard/planner; present in the "Not in QuickBooks" review view.
5. "Keep active" override on one flagged product → it returns to the buy list and survives the next feed.
6. Settings QB card shows the last sync + counts.

## Open items / hand-offs

- **QB stock override** — deferred; revisit after dead-products is trusted.
- **Dellwest physical sales (Track B)** — separate spec; the Dellwest API is IP-bot-protected (Imunify360) so it needs Dellwest to whitelist the puller's IP. Dellwest also joins by name, so Track A's upstream name-matcher is the shared core.
- **n8n IP / scheduling** — the QB feed runs from the existing n8n instance (QB cred already works there); confirm its egress is acceptable to QB.
