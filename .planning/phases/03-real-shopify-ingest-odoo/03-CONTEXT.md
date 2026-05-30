# Phase 3: Real Shopify Ingest + Odoo — Context

**Gathered:** 2026-05-30
**Status:** Ready for planning
**Mode:** auto (recommended/SOW-canonical option chosen per gray area; rationale logged inline)

<domain>
## Phase Boundary

Replace the mock Shopify client with a **real, per-tenant Shopify integration** so Beauty Square's actual store is the source of catalog, inventory (`on_hand`), and 365 days of order history — kept in sync by HMAC-verified webhooks plus a nightly reconcile. Tokens are encrypted at rest. `Location`/`InventoryLevel` become first-class. The same connection pattern is scaffolded for Odoo.

**In scope — Requirements:** SHOP-01..09 (the full Shopify integration). ODOO-01..05 are **in the phase but deferred to a tail** (see D-12 + Deferred) because there is no live Odoo instance to test against and ODOO-02/03 depend on the Phase 4 merge layer.

**Explicit non-scope** (later phases — do not build here):
- Source-of-truth merge layer + `SourceClaim` ledger (Phase 4 — MRG-*). Phase 3 ingest writes directly via tenant-scoped upserts; Phase 4 retrofits writes through `applyClaim()`.
- QuickBooks (Phase 4), Python sidecar (Phase 5), PO email/PDF (Phase 4).
- Multi-location UI / forecasting across locations — `Location` ships, but v1 forecasts against the primary location only (SHOP-08).
</domain>

<decisions>
## Implementation Decisions

### Shopify App Type & Auth (SHOP-01, SHOP-02)

- **D-01: Public OAuth app via the Shopify Partner dashboard (NOT a custom/store-admin app).** SOW-mandated (SHOP-01: "per-tenant Shopify OAuth installation flow"). This is the multi-tenant-correct path the whole Phase 2 investment exists for — each tenant installs the app and gets its own offline token. The faster single-store "custom app Admin API token" is the documented fallback (see Deferred) but is rejected as the primary because it doesn't generalize to SimplyDone's second client. **Roy has Shopify access and will create the Partner app + provide `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET`** (a human checkpoint).
- **D-02: Library = `@shopify/shopify-api` v11+ with `@shopify/shopify-app-session-storage-prisma`.** Pin `ApiVersion` to a fixed stable quarter (research said `January26`; confirm the current STABLE quarter at phase start via `npm view`/Shopify changelog — do NOT use `LATEST_API_VERSION`). Offline access mode (we need background sync, not just online user sessions).
- **D-03: Admin API = GraphQL (not REST).** Bulk Operations (the 365d backfill, SHOP-03) is GraphQL-only, and Shopify is sunsetting REST. All ingest goes through the GraphQL Admin API.
- **D-04: OAuth flow lives at `app/api/shopify/auth/route.ts` (begin) + `app/api/shopify/callback/route.ts` (callback).** "Connect Shopify" button on `app/shop/[slug]/settings/page.tsx` kicks off the install; callback exchanges the code for an **offline** token, encrypts it, and stores it on `ShopifyConnection`. The Shopify app redirect/allowed URLs must include the dev tunnel + the Vercel prod URL (human dashboard config).

### Token Encryption at Rest (SHOP-02)

- **D-05: App-level AES-256-GCM helper at `lib/crypto/encryption.ts`** with a single key from `TOKEN_ENCRYPTION_KEY` (32 bytes, base64 — already documented in `.env.example` from Phase 1 D-14). `encrypt(plaintext)`/`decrypt(ciphertext)` (GCM gives authenticated encryption; store iv+authTag+ciphertext). Chosen over a Prisma extension or Supabase column encryption for portability + simplicity (matches the research "single app-level KMS key in env" decision). Used for `ShopifyConnection.accessToken` now and `QuickBooksConnection` tokens in Phase 4.

### Schema Additions

- **D-06: New models** (Prisma migration stacked on Phase 2's):
  - `ShopifyConnection` — `tenantId @unique` (one Shopify store per tenant in v1), `shopDomain @unique` (the `*.myshopify.com`), `accessToken` (encrypted), `scope`, `installedAt`, `uninstalledAt?`, status. Cascade from Tenant.
  - `Location` — `Tenant 1—n Location`; `shopifyLocationId`, `name`, `isPrimary Boolean`. (SHOP-08)
  - `InventoryLevel` — `Location 1—n InventoryLevel`, `Product`/variant ref, `onHand Int` (the `on_hand` quantity, NOT `available`). (SHOP-04, SHOP-08)
  - `IngestCursor` — `tenantId`, `source` (`shopify`), `resource` (e.g. `orders`,`products`), `cursor`/`lastSyncedAt` — for reconcile resumability (SHOP-07).
  - `WebhookEvent` — `tenantId`, `webhookId` (`X-Shopify-Webhook-Id`) `@unique`, `topic`, `receivedAt` — the idempotency dedupe table (SHOP-06).
- **D-07: `Tenant.shopifyDomain` gets `@unique`** so `lib/auth/webhook-context.ts::resolveTenantByDomain` switches from `findFirst` to `findUnique` (the Phase 2 TODO). Webhook tenant resolution keys on the shop domain.
- **D-08: Add `Product.shopifyHandle`/variant fields as needed** so real products/variants map cleanly; keep the existing `@@unique([tenantId, shopifyProductId])`. Real `productType` values won't match the hardcoded `kenya-calendar.ts` uppercase set — that's a **calibration item, not a bug** (normalize-map at ingest or tolerate at forecast).

### Ingest Strategy (SHOP-03, SHOP-04, SHOP-05, SHOP-06, SHOP-07)

- **D-09: Webhooks-primary + nightly reconcile (research-locked hybrid).**
  - **Backfill on first connect:** GraphQL **Bulk Operations** pulls 365d orders + all products/variants + `on_hand` inventory levels. This runs from anywhere (outbound calls) — works on localhost.
  - **Real-time:** webhook handlers at `app/api/webhooks/shopify/route.ts` for `products/create|update|delete`, `inventory_levels/update`, `orders/create|updated|cancelled`, `app/uninstalled`. **HMAC verified on `request.text()` BEFORE `request.json()`**, comparison via `crypto.timingSafeEqual` on base64 digests (Pitfall 4). Idempotent on `X-Shopify-Webhook-Id` via `WebhookEvent` dedupe (SHOP-06).
  - **Nightly reconcile:** a cron route (`app/api/cron/shopify-reconcile/route.ts`) does a delta sweep using `IngestCursor`. Scheduled via **Vercel Cron** in prod; locally it's a callable route (hit it manually) — no tunnel needed.
- **D-10: `app/uninstalled` webhook clears tokens but preserves tenant data (SHOP-09)** — sets `ShopifyConnection.uninstalledAt`, nulls the encrypted token; Products/SalesHistory/etc. stay.

### Local Dev & Webhook Testing

- **D-11: Real-data ingest is validated locally via the Bulk Operations backfill** (outbound, no public URL needed) — this is the fastest path to "Beauty Square's real catalog renders in the dashboard." **Live webhook delivery testing is deferred to the Vercel deploy** (real HTTPS URL) OR an optional Shopify CLI / cloudflared tunnel for local. HMAC verification is unit-tested locally with a known fixture (no tunnel needed). So: backfill + reconcile prove ingest locally; webhook round-trip proven on deploy.

### Synthetic → Real Data Transition

- **D-13: On first real Shopify connect, the tenant's synthetic seed is replaced by real data.** Beauty Square currently holds 1,023 SYNTHETIC products + synthetic sales (Phase 1 demo). Real `shopifyProductId`s won't match the synthetic ones, so a clean cutover is: **on first successful connect + backfill, clear that tenant's synthetic Products/SalesHistory/Predictions, then ingest real.** This is **destructive for the demo data only** and MUST be guarded (explicit owner confirmation in the connect flow + a dry-run count first). Synthetic data was always a placeholder; this is the moment it becomes real.

### Odoo (ODOO-01..05)

- **D-12: Odoo is deferred to a Phase 3 tail (or a follow-on sub-phase), NOT built in the first Shopify pass.** Two blockers: (1) **no live Odoo instance to test against** — Beauty Square is Shopify-only; building Odoo blind has no acceptance target, unlike Shopify (Beauty Square is live now); (2) **ODOO-02/03 ingest "via the merge layer"**, which is Phase 4 (MRG-*). Recommendation: ship real Shopify fully + proven against Beauty Square, then either tail Odoo as scaffolding (connection + ingest, direct writes) once a test Odoo exists, or formally move ODOO-* to a later milestone. Flagged for Roy — this reshapes Phase 3 to "Shopify-complete, Odoo-scaffolded/deferred."

### Claude's Discretion

- Exact `ApiVersion` quarter (resolve at phase start).
- Whether to use a tunnel (Shopify CLI / cloudflared) for local webhook testing or wait for deploy.
- GraphQL client: the SDK's built-in client vs a thin typed wrapper.
- Bulk Operations polling cadence + JSONL parsing approach.
- Whether `InventoryLevel` references `Product` or a new `ProductVariant` model (depends on how granular Beauty Square's variants are — inspect on first ingest).
- Normalization map for real `product_type` → the calendar category set (or tolerate mismatches).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/ROADMAP.md` → Phase 3 — goal + 5 success criteria (verification targets)
- `.planning/REQUIREMENTS.md` §Shopify Integration (SHOP-01..09) + §Odoo (ODOO-01..05)
- `.planning/PROJECT.md` — "Ingest strategy", "Source-of-truth strategy", "Codebase map ground truth" (mock client, on_hand vs available, hardcoded beautysquareke.co)

### Research (frozen)
- `.planning/research/SUMMARY.md` §2 (Shopify ingest row: `@shopify/shopify-api` v11+, `ApiVersion.January26`, Bulk Operations, encrypted offline tokens), §"Architecture Decisions" (hybrid ingest webhook-primary + reconcile; webhook resolver = the findUnique survivor; encrypted-at-rest tokens; `Location` first-class), §Pitfalls #4 (HMAC via request.text() first + timingSafeEqual base64) + #5 (on_hand not available)
- `.planning/research/ARCHITECTURE.md` + `.planning/research/PITFALLS.md` — Shopify ingest + webhook security detail

### Codebase
- `.planning/codebase/INTEGRATIONS.md` — current mock integration boundaries
- `lib/shopify/client.ts` — the MOCK client being replaced (each method has a `// MOCK — real impl: <endpoint>` comment); currently allow-listed by the tenant-safety ESLint rule (D-16 Phase 2) — replace + remove the allow-list entry
- `lib/auth/webhook-context.ts` — the Phase-2 webhook resolver placeholder; Phase 3 fills `resolveTenantByDomain` + adds `Tenant.shopifyDomain @unique` (D-07)
- `app/shop/[slug]/settings/page.tsx` — where the "Connect Shopify" button + connection status UI go
- `prisma/schema.prisma` — current models; Phase 3 adds ShopifyConnection/Location/InventoryLevel/IngestCursor/WebhookEvent

### Prior phase
- `.planning/phases/02-multi-tenant-auth-tenant-routing/02-CONTEXT.md` — requireTenant chokepoint, D-11 webhook resolver rationale, D-05 (TOKEN_ENCRYPTION_KEY documented), the ESLint allow-list (the mock client entry to remove)

### External docs (fetch current at plan/research time)
- Shopify Admin GraphQL API + Bulk Operations guide; OAuth (offline access) guide; webhook HMAC verification guide; `@shopify/shopify-api` + `@shopify/shopify-app-session-storage-prisma` docs — confirm current stable `ApiVersion` quarter.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/auth/webhook-context.ts` — the sanctioned non-session resolver; fill it in (+ `shopifyDomain @unique`).
- `lib/crypto/encryption.ts` (NEW) — reused by Phase 4 QuickBooks tokens.
- `requireTenant()` + `/shop/[slug]/settings` — the Connect Shopify UI hangs off the existing tenant shell + settings page.
- `lib/prisma.ts` singleton; the existing `@@unique([tenantId, shopifyProductId])` on Product (real ingest upserts on it).

### Integration Points
- `app/api/shopify/{auth,callback}/route.ts` (NEW) — OAuth begin/callback.
- `app/api/webhooks/shopify/route.ts` (NEW) — HMAC + idempotent webhook handler.
- `app/api/cron/shopify-reconcile/route.ts` (NEW) — nightly delta sweep; Vercel Cron in prod.
- `lib/shopify/*` — replace the mock client with real GraphQL ingest modules.
- `app/shop/[slug]/settings/page.tsx` — Connect button + status.
- `vercel.json` (NEW/edited) — cron schedule for reconcile.

### Established Patterns (preserve)
- Tenant-scoped everything (`requireTenant()` for session routes; `resolveTenantByDomain` for webhooks). The tenant-safety ESLint rule still applies — real ingest queries must carry `tenantId`.
- Next 16 async `params`; API routes as the service layer; Zod validation.

</code_context>

<specifics>
## Specific Ideas

- **Beauty Square's real Shopify store is live NOW** and Roy has account access — Shopify is the one Phase-3 integration with a real acceptance target. Optimize Phase 3 around getting its real catalog/orders/inventory flowing and verified.
- **"Last synced N hours ago" resilience** (research): the dashboard must keep rendering from local DB during upstream/connectivity outages (Kenya 2-day-outage scenario). The forecast page already reads local DB; preserve that.
- Roy's session prefs (carried): grade-9 explanations, CLI-first, ask before destructive ops (D-13 synthetic-wipe especially), Codex as 2nd-opinion reviewer, dev server on :3082, Supabase free-tier pooler connection limits (stop dev server before DB scripts).

</specifics>

<deferred>
## Deferred Ideas

- **Custom-app (store-admin) Admin API token** as a fast single-store shortcut — rejected as primary (not multi-tenant) but kept as a documented fallback if the Partner-app OAuth route stalls on app review/approval.
- **Odoo connector (ODOO-01..05)** — deferred to a Phase 3 tail or later milestone (no live test target + merge-layer dependency). Tracked, not dropped (D-12).
- **Multi-location forecasting/UI** — `Location` ships; forecasting against non-primary locations is v2 (V2-09).
- **Real-time webhook → forecast retrigger** — out of scope (V2-12); forecasts run on schedule/on-demand.
- **Live webhook delivery testing on localhost** — deferred to Vercel deploy or an optional tunnel (D-11).

</deferred>

---

*Phase: 03-real-shopify-ingest-odoo*
*Context gathered: 2026-05-30*
