# n8n build-prompt — QuickBooks → Wezesha catalogue feed

Reuses the existing QuickBooks credential on the Beauty Square reconciliation
workflows. Matches QB items → Shopify by NAME (QB's SKU is empty), then POSTs a
SKU-keyed feed to Wezesha, which decides what's "real". Weak matches are reported,
not asserted.

## Prompt

> Build an n8n workflow **"Beauty Square — QuickBooks → Wezesha catalogue feed"**.
>
> 1. **Schedule Trigger** (daily) + **Manual Trigger**.
> 2. **QuickBooks node** (existing credential): `resource: item, operation: getAll, returnAll: true`.
> 3. **HTTP Request → Shopify GraphQL**: page all product variants (`sku`, `product{title}`),
>    same pattern as the recon workflow's "Pull Shopify" node. Build a name→sku map.
> 4. **Code node "Match"**: for each QB item, normalise its `Name` and look up the Shopify
>    variant by exact normalised title; if no exact hit, take the best token-overlap match
>    and mark it `weak` when overlap < 55% (same scoring as the recon workflow). Emit
>    `{ sku, qbName, qtyOnHand: it.QtyOnHand, cost: it.PurchaseCost, matchConfidence }`
>    only for confident matches; count the weak ones.
> 5. **HTTP Request → `POST https://wezesha-restock-os.vercel.app/api/qb/catalog`**
>    header `Authorization: Bearer <QB_FEED_SECRET>`, JSON body
>    `{ "slug": "beauty-square", "rows": [...], "weak": <count> }`.
>
> Notes:
> - Send the **FULL** QB item list every run — the endpoint's **>60% abort guard** rejects a
>   partial pull (it won't flag the catalogue if a broken feed would deactivate most of it).
> - `slug` is the shop's slug in Wezesha (`beauty-square`).
> - `cost` is optional here (Wezesha already has a cost upload); include it if easy.

## How Wezesha responds

`POST /api/qb/catalog` returns `{ ok, aborted, matched, flagged, weak, totalProducts, runId }`.
- Products whose SKU is in the feed → confirmed **active** (kept in the buy list), even if out of stock.
- Shopify products **absent** from the feed → soft-flagged **inactive** (dropped from forecasts/planner),
  unless an owner pinned them via "Keep active". Nothing is deleted.
- `aborted: true` ⇒ the feed looked partial (>60% would have been flagged) and **no changes were applied** —
  fix the feed and re-run.
- Settings → **QuickBooks (clean data)** shows the last run + a "Review N not in QuickBooks" link.

## Deploy prerequisite

Set `QB_FEED_SECRET` in the Vercel project env (Production) and use the same value in the
n8n HTTP Request's bearer header.
