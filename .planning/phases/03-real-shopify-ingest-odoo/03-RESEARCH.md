# Phase 3 Research — Real Shopify Ingest

**Researched:** 2026-05-31
**Scope:** Shopify only (SHOP-01..09). Odoo deferred per 03-CONTEXT.md D-12.
**Method:** version pins via npm + Shopify API release schedule verified live; implementation patterns from official `@shopify/shopify-api` + Admin GraphQL docs. (A prior open-ended research agent hung on web crawling; this is the focused, decision-ready version.)

## User Constraints (from 03-CONTEXT.md — LOCKED)

D-01 public OAuth app + offline tokens · D-02 `@shopify/shopify-api` + session-storage-prisma · D-03 GraphQL Admin API · D-04 OAuth at `app/api/shopify/{auth,callback}` · D-05 AES-256-GCM token encryption · D-06..D-08 new schema models + `Tenant.shopifyDomain @unique` · D-09 webhooks-primary + Bulk Operations backfill + nightly reconcile + HMAC-first + WebhookEvent dedupe · D-10 uninstall preserves data · D-11 backfill validates locally, live webhooks deferred to deploy · D-13 synthetic→real guarded swap.

## Standard Stack (pinned 2026-05-31)

| Package | Version | Notes |
|---------|---------|-------|
| `@shopify/shopify-api` | **13.0.0** (`latest`) | Newer than the frozen research's "v11+". Core OAuth + GraphQL client + webhook validation. Runtime-agnostic (works in Next route handlers via the web-api adapter). |
| `@shopify/shopify-app-session-storage-prisma` | **9.0.0** | Prisma session storage adapter. Requires a `Session` model in the Prisma schema (see Schema below). |
| Shopify Admin API version | **`2026-04`** (ApiVersion `April26`) | **Current stable** (released 2026-04-01; next `2026-07` on 2026-07-01). PIN THIS — do NOT use `LATEST_API_VERSION`. Re-confirm at execute time; if `2026-07` has shipped by then, pin that. |

Install: `npm install @shopify/shopify-api@13 @shopify/shopify-app-session-storage-prisma@9`
Also need the web runtime adapter import: `import "@shopify/shopify-api/adapters/web-api";` (Next.js route handlers use Web APIs / `fetch`, not Node http).

**Sources:** [Shopify API versioning](https://shopify.dev/docs/api/usage/versioning) · [GraphQL Admin API 2025-10 ref](https://shopify.dev/docs/api/admin-graphql) · npm `@shopify/shopify-api` (13.0.0), `@shopify/shopify-app-session-storage-prisma` (9.0.0).

## Phase Requirements → Mechanism

| Req | Mechanism |
|-----|-----------|
| SHOP-01 | OAuth offline install: `shopify.auth.begin()` → Shopify consent → `shopify.auth.callback()` returns offline session w/ `accessToken`; persist encrypted on `ShopifyConnection` |
| SHOP-02 | AES-256-GCM `lib/crypto/encryption.ts`, key `TOKEN_ENCRYPTION_KEY` (32-byte base64); encrypt before write, decrypt on read |
| SHOP-03 | GraphQL **Bulk Operations** `bulkOperationRunQuery` for 365d `orders`; poll `currentBulkOperation`; stream JSONL `url` |
| SHOP-04 | Bulk op for `products`+variants; inventory via `inventoryLevel.quantities(names:["on_hand"])` (NOT `available`) |
| SHOP-05 | Webhook route, HMAC on `request.text()` BEFORE parse, `timingSafeEqual` on base64 digests |
| SHOP-06 | `WebhookEvent.webhookId @unique` (from `X-Shopify-Webhook-Id` header) → insert-or-skip |
| SHOP-07 | Nightly Vercel Cron → delta sweep using `IngestCursor` (orders/products `updated_at >= cursor`) |
| SHOP-08 | `Location` + `InventoryLevel`; `isPrimary` set on first connect; forecast against primary |
| SHOP-09 | `app/uninstalled` webhook → null token, set `uninstalledAt`, KEEP Product/SalesHistory/etc. |

## Architecture Patterns

### Pattern 1 — Shopify client singleton (`lib/shopify/shopify.ts`)
```ts
import "@shopify/shopify-api/adapters/web-api";
import { shopifyApi, ApiVersion, LATEST_API_VERSION } from "@shopify/shopify-api";

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: (process.env.SHOPIFY_SCOPES ?? "read_products,read_inventory,read_orders,read_locations").split(","),
  hostName: process.env.SHOPIFY_APP_HOST!.replace(/^https?:\/\//, ""), // no protocol
  apiVersion: ApiVersion.April26,   // 2026-04 stable — confirm at execute time
  isEmbeddedApp: false,             // standalone connect flow, not an embedded admin app
});
```
`SHOPIFY_SCOPES` must request the FULL day-1 set so re-auth isn't needed later: `read_products,read_inventory,read_orders,read_locations` (research §6: under-requesting scopes forces re-install). `SHOPIFY_APP_HOST` = the public base URL (Vercel prod, or the tunnel URL in dev).

### Pattern 2 — OAuth offline (App Router route handlers)
- `app/api/shopify/auth/route.ts` (GET): read `?shop=<store>.myshopify.com`, call `await shopify.auth.begin({ shop, callbackPath: "/api/shopify/callback", isOnline: false, rawRequest: req })`. The helper returns a redirect Response (App Router can return it directly, or it sets headers — confirm v13's return shape; in v13 `auth.begin` writes to a `rawResponse` or returns a Response. Use the web-api adapter so it speaks `Request`/`Response`).
- `app/api/shopify/callback/route.ts` (GET): `const { session } = await shopify.auth.callback({ rawRequest: req });` → `session.accessToken` is the OFFLINE token (because isOnline:false). Encrypt + upsert `ShopifyConnection { tenantId, shopDomain: session.shop, accessToken: encrypt(session.accessToken), scope: session.scope }`. Then register webhooks (Pattern 4) + kick off the backfill (Pattern 3). Redirect to `/shop/[slug]/settings?connected=1`.
- **Tenant binding:** the connect flow starts from `/shop/[slug]/settings`, so carry the tenant slug through OAuth `state` (or a signed cookie) and resolve it in the callback via `requireTenant(slug)` — the offline token is bound to BOTH the Shopify shop AND the Wezesha tenant. `Tenant.shopifyDomain` is set to `session.shop` (enables `resolveTenantByDomain` for webhooks, D-07).

### Pattern 3 — Bulk Operations (365d orders + products + inventory)
GraphQL client: `const client = new shopify.clients.Graphql({ session });` where `session` is reconstructed from `ShopifyConnection` (shop + decrypted token, offline).
```graphql
mutation {
  bulkOperationRunQuery(query: """
    {
      orders(query: "created_at:>=2025-05-31") {
        edges { node { id name createdAt
          lineItems { edges { node { quantity sku
            product { id } variant { id } originalUnitPriceSet { shopMoney { amount } } } } } } }
      }
    }
  """) { bulkOperation { id status } userErrors { field message } }
}
```
Poll `{ currentBulkOperation { id status errorCode objectCount url } }` until `status == COMPLETED`; then GET the `url` (a temporary GCS link) — it's **JSONL**, one object per line, with nested children flattened (each line carries `__parentId`). Parse line-by-line (stream; the file can be large). Run SEPARATE bulk ops for `orders`, `products`(+variants), and `inventoryLevels` (or one combined query — but separate is simpler to map). **Only one bulk op runs per shop at a time** — serialize them.

**on_hand inventory (SHOP-04, NOT available):**
```graphql
{ locations(first: 10) { edges { node { id name isActive
    inventoryLevels(first: 250) { edges { node {
      item { variant { id sku } }
      quantities(names: ["on_hand"]) { name quantity } } } } } } } }
```
`quantities(names:["on_hand"])` is the modern API (the old `available` scalar is deprecated). Map `Location` → primary = the first active location (set `isPrimary`).

### Pattern 4 — Webhooks (HMAC + idempotency)
Register on connect via GraphQL `webhookSubscriptionCreate` (topics: `PRODUCTS_CREATE/UPDATE/DELETE`, `INVENTORY_LEVELS_UPDATE`, `ORDERS_CREATE/UPDATED/CANCELLED`, `APP_UNINSTALLED`) pointing at `${SHOPIFY_APP_HOST}/api/webhooks/shopify`. Handler:
```ts
export async function POST(req: NextRequest) {
  const raw = await req.text();                       // RAW body FIRST (Pitfall 4)
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const digest = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(raw, "utf8").digest("base64");
  const ok = hmac.length === digest.length &&
    crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest));
  if (!ok) return new NextResponse("Unauthorized", { status: 401 });

  const webhookId = req.headers.get("x-shopify-webhook-id")!;
  const topic = req.headers.get("x-shopify-topic")!;
  const shop = req.headers.get("x-shopify-shop-domain")!;
  // idempotency: insert WebhookEvent; if duplicate (unique webhookId) → 200 no-op (SHOP-06)
  try { await prisma.webhookEvent.create({ data: { webhookId, topic, shop } }); }
  catch { return NextResponse.json({ ok: true, duplicate: true }); }

  const tenant = await resolveTenantByDomain(shop);   // webhook resolver (Phase 2), now findUnique
  const payload = JSON.parse(raw);
  // ...dispatch by topic, tenant-scoped writes...
  return NextResponse.json({ ok: true });
}
```
Return 200 fast; Shopify retries on non-2xx for 48h and auto-removes the subscription after 19 consecutive failures. **HMAC contract test** with a known `(secret, body, expected-digest)` fixture is the locally-runnable proof (live delivery deferred per D-11).

### Pattern 5 — Nightly reconcile (Vercel Cron + IngestCursor)
`vercel.json`: `{ "crons": [{ "path": "/api/cron/shopify-reconcile", "schedule": "0 2 * * *" }] }` (02:00 UTC). Route guards on `Authorization: Bearer ${CRON_SECRET}` (Vercel sends it; also allow manual local trigger with the same header). For each connected tenant: read `IngestCursor` per resource, query `orders(query:"updated_at:>=<cursor>")` + `products(query:"updated_at:>=<cursor>")`, upsert deltas, advance the cursor to `now`. This catches any webhook misses (SHOP-07). Locally: just `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3082/api/cron/shopify-reconcile`.

### Pattern 6 — Synthetic→real cutover (D-13, GUARDED)
Order of operations on first successful connect:
1. Run the backfill into memory/parse the JSONL → count real products/orders.
2. **Dry-run guard:** surface `"This will replace N synthetic products with M real products. Confirm?"` in the connect UI before any delete.
3. On confirm, in a transaction per tenant: `deleteMany` synthetic `Order`/`Prediction`/`SalesHistory`/`Product` for that tenantId, then insert real (upsert by `@@unique([tenantId, shopifyProductId])`). Keep `Supplier`/`Promo`/`MonthlyContext` (owner-entered, not synthetic).
4. Re-run forecasts against real data.

## Schema additions (Prisma)

```prisma
model Session {            // required by @shopify/shopify-app-session-storage-prisma
  id String @id
  shop String
  state String
  isOnline Boolean @default(false)
  scope String?
  expires DateTime?
  accessToken String?
  // (adapter-defined shape — confirm exact fields from session-storage-prisma@9 README at execute time)
}
model ShopifyConnection {
  id String @id @default(cuid())
  tenantId String @unique
  shopDomain String @unique          // <store>.myshopify.com
  accessToken String                 // AES-256-GCM ciphertext
  scope String
  installedAt DateTime @default(now())
  uninstalledAt DateTime?
  tenant Tenant @relation(fields:[tenantId], references:[id], onDelete: Cascade)
}
model Location {
  id String @id @default(cuid())
  tenantId String
  shopifyLocationId String
  name String
  isPrimary Boolean @default(false)
  tenant Tenant @relation(fields:[tenantId], references:[id], onDelete: Cascade)
  inventoryLevels InventoryLevel[]
  @@unique([tenantId, shopifyLocationId])
  @@index([tenantId])
}
model InventoryLevel {
  id String @id @default(cuid())
  tenantId String
  locationId String
  productId String
  onHand Int @default(0)             // on_hand, NOT available
  updatedAt DateTime @updatedAt
  location Location @relation(fields:[locationId], references:[id], onDelete: Cascade)
  product Product @relation(fields:[productId], references:[id], onDelete: Cascade)
  @@unique([locationId, productId])
  @@index([tenantId])
}
model IngestCursor {
  id String @id @default(cuid())
  tenantId String
  source String   // "shopify"
  resource String // "orders" | "products" | "inventory"
  cursor DateTime?
  updatedAt DateTime @updatedAt
  @@unique([tenantId, source, resource])
}
model WebhookEvent {
  id String @id @default(cuid())
  webhookId String @unique          // X-Shopify-Webhook-Id
  topic String
  shop String
  receivedAt DateTime @default(now())
}
```
`Tenant` gains `shopifyDomain String? @unique` (D-07), `shopifyConnection ShopifyConnection?`, `locations Location[]`. `Product` gains `inventoryLevels InventoryLevel[]`.

## Common Pitfalls (verified against current code)

1. **`available` vs `on_hand`** — use `quantities(names:["on_hand"])`; the legacy `available` scalar misrepresents committed stock and double-orders (Pitfall 5).
2. **HMAC after JSON parse** — `request.json()` consumes the body and re-serialization changes bytes → HMAC fails. ALWAYS `request.text()` first (Pitfall 4).
3. **`LATEST_API_VERSION`** — silently rolls your contract every quarter; pin `April26`.
4. **One bulk op per shop** — starting a second while one runs errors; serialize orders→products→inventory.
5. **Bulk JSONL is flat with `__parentId`** — children (lineItems, variants) are separate lines referencing the parent; reassemble in the parser.
6. **localhost + Shopify** — Shopify OAuth redirect URLs and webhook endpoints generally require a public HTTPS URL. **OPEN QUESTION (execute-time):** confirm whether `http://localhost:3082` is accepted as a dev redirect URL for a public app, or whether a tunnel (Shopify CLI `shopify app dev`, or cloudflared) is required for the OAuth round-trip. Backfill (outbound GraphQL) needs NO public URL — so even if OAuth needs a tunnel, ingest logic is testable once a token exists. Fallback: paste an offline token obtained via the Shopify CLI / a custom app for first local ingest, then wire the public OAuth flow for deploy.
7. **Tenant-safety ESLint** — real ingest queries must carry `tenantId`; `resolveTenantByDomain` (webhook-context.ts) is already allow-listed. Remove the `lib/shopify/client.ts` allow-list entry when the mock is deleted.

## Open Questions (flagged for execute-time, none block planning)

1. **localhost vs tunnel for OAuth** (Pitfall 6) — confirm; affects the human setup steps. Backfill is unaffected.
2. **Exact `@shopify/shopify-api@13` `auth.begin/callback` return shape in App Router** — v13 web-api adapter returns/edits a `Response`; confirm the precise call signature from the v13 README during Plan Task 1 (a 10-min spike).
3. **session-storage-prisma@9 exact `Session` model fields** — copy from the adapter's README/migration (don't guess the columns).
4. **Variant granularity** — does Beauty Square use multi-variant products? Determines whether `InventoryLevel` keys on Product or a new `ProductVariant`. Inspect on first ingest (D-08 / Claude's discretion).

## Validation Architecture (lean — Nyquist off)

- **HMAC contract test** (`lib/shopify/__tests__` or `tests/`): known `(secret, rawBody)` → assert the route accepts the correct digest and 401s a tampered one. The locally-runnable proof for SHOP-05 since live delivery is deferred.
- **Encryption round-trip test**: `decrypt(encrypt(x)) === x`, and ciphertext ≠ plaintext, for `lib/crypto/encryption.ts` (SHOP-02).
- **JSONL parser test**: a fixture JSONL with `__parentId` nesting → assert orders/lineItems reassemble correctly.
- **Backfill is the live acceptance**: real Beauty Square catalog + 365d orders + on_hand render in `/shop/beauty-square/dashboard` (SHOP-03/04 — success criteria #2).

## Ready for Planning
All 9 Shopify requirements mapped to concrete mechanisms with pinned versions + code sketches. The 4 open questions are execute-time spikes (localhost/tunnel, v13 auth signature, session model fields, variant granularity), none blocking the plan structure.
