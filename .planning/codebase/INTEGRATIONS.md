# External Integrations

**Analysis Date:** 2026-05-28

## Integration Status Legend

- **Wired** — Real network/API call executes against an external service.
- **Stubbed** — Code path exists but returns mock data sourced from the local database; production swap is a one-file change.
- **Aspirational** — Mentioned in `README.md` roadmap; no code present.

## APIs & External Services

### Shopify (Stubbed)

**Status:** Mock-only. No real Shopify API calls are made.

**Implementation:** `lib/shopify/client.ts` — `ShopifyClient` class with five methods, each annotated with the real Shopify Admin API endpoint that would replace it:

| Method | Mock behavior | Real impl (per inline comment) |
|--------|---------------|-------------------------------|
| `testConnection()` | Returns `{ok, shopName, mock: !accessToken}` based on presence of `accessToken` only. | `GET /admin/api/2024-10/shop.json` with `X-Shopify-Access-Token` header. |
| `fetchProducts(limit)` | Reads `prisma.product` rows for the tenant matching `cfg.domain`, maps to `ShopifyProductSummary`. | `GET /admin/api/2024-10/products.json?limit=250`. |
| `fetchOrders(since)` | Reads `prisma.salesHistory` since the given date. | `GET /admin/api/2024-10/orders.json?status=any&created_at_min=...`. |
| `fetchInventory()` | Reads `prisma.product.currentStock`. | `GET /admin/api/2024-10/inventory_levels.json?location_ids=...`. |
| `createDraftOrder({productId, quantity})` | Returns `{id: "mock-draft-<timestamp>", ...}` without persisting. | `POST /admin/api/2024-10/draft_orders.json`. |

**Auth state:**
- `Tenant.shopifyAccessToken` field exists in `prisma/schema.prisma` and is captured by `app/api/shop/route.ts` (POST). Currently used only to flip the `mock: true|false` flag in `testConnection()` — the token is never sent over the wire.

**Callers:**
- `app/api/shop/test/route.ts` — Validates input with Zod, instantiates `ShopifyClient`, calls `testConnection()`.
- `app/api/orders/[id]/approve/route.ts` — Does NOT call `ShopifyClient.createDraftOrder()`. Instead writes `shopifyDraftOrderId = "mock-draft-<timestamp>"` directly to the DB row. The mock client method is currently unreferenced.

**Roadmap (per `README.md`):** Milestone 2 calls for "real Shopify OAuth + Python FastAPI service". No OAuth flow / app credentials present.

### Beauty Square KE Catalog Scrape (Wired)

**Status:** Live HTTP fetch against a public Shopify storefront's `products.json` endpoint.

**Implementation:** `scripts/seed-from-beautysquare.ts`

- **Source URL:** `https://beautysquareke.co/products.json` (constant `SOURCE`).
- **Auth:** None — public storefront JSON.
- **Method:** Pages through `?limit=250&page=<n>` using `fetch()` until a page returns fewer than 250 products.
- **Per product:** Takes first variant, parses price, generates random initial stock (20-100) and cost (45-60 % of retail), upserts into `prisma.product` keyed on `(tenantId, shopifyProductId)`.
- **Tenant bootstrap:** Creates a `Tenant` named `"Beauty Square KE"` with `shopifyDomain = "beautysquareke.co"` and `currency = "KES"` if none exists.

**Invocation:**
- `npm run seed` (chains `seed-from-beautysquare.ts` then `synth-sales-history.ts`).
- `POST /api/seed` (`app/api/seed/route.ts`) — Exported `seed()` + `synth()` are imported and run from the API route. `maxDuration = 300` set for Vercel.

## Data Storage

**Databases:**
- SQLite (development) — `prisma/dev.db`, hardcoded in `prisma/schema.prisma` as `url = "file:./dev.db"`. Bundled into Vercel deployment via `outputFileTracingIncludes` in `next.config.ts` (read-only at runtime).
- PostgreSQL (production, aspirational) — `README.md` instructs switching `provider = "postgresql"` and setting `DATABASE_URL` env var. Not currently wired; schema must be edited manually.

**Client:** Prisma 6.1.0. Singleton in `lib/prisma.ts` attaches to `globalThis` outside production to survive Next.js hot reloads.

**File Storage:**
- Local filesystem only — SQLite file. No S3/Cloud Storage SDKs.

**Caching:**
- None — No Redis, Upstash, or in-process LRU detected.

## Authentication & Identity

- **None.** No NextAuth, Clerk, Lucia, or custom auth detected. All API routes are unauthenticated. `Tenant.shopifyAccessToken` is captured but never validated or used as an auth credential.

## Monitoring & Observability

- **Error Tracking:** None (no Sentry, Datadog, Rollbar).
- **Logs:** `console.log`/`console.error` only, primarily in `scripts/` files for seed/forecast progress output.

## CI/CD & Deployment

**Hosting:**
- Vercel (per `README.md`). `next.config.ts` is tuned for Vercel serverless (sqlite file traced into bundle, `maxDuration` set on long-running API routes like `/api/seed` = 300s, `/api/forecast/run` = 120s).

**CI Pipeline:**
- None detected (no `.github/workflows`, no `vercel.json`, no `railway.json`).

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` — Required only when switching schema to Postgres (per `README.md`). Not used in current SQLite mode.
- `NODE_ENV` — Standard Next.js variable, read in `lib/prisma.ts`.

**Secrets location:**
- No `.env*` files in the repo. No secret management configured (no Vault, AWS Secrets Manager, Doppler).

## Webhooks & Callbacks

- **Incoming:** None.
- **Outgoing:** None.

## Forecast / ML Layer (Stubbed → Aspirational)

**Current implementation:** `lib/forecast/simulate-layers.ts` — Pure TypeScript simulation of a two-layer model:
- **Layer 1 (SARIMA mock):** `seasonalNaive30()` blends last-30-day sum (60 %) with same-period-last-year sum (40 %), falls back to `weightedDailyRate()` from `lib/forecast/baseline.ts`.
- **Layer 2 (XGBoost mock):** Multiplies Layer 1 by holiday boost (`lookaheadHolidayBoost`), payday boost (`lookaheadPaydays`), and active promo lift (`activePromoLift`), plus 5 % uniform noise.
- **Safety stock:** King's formula via `kingsSafetyStock()` in `lib/forecast/baseline.ts`.
- **ABC service levels:** `zForServiceLevel()` returns z = 2.33 / 1.65 / 1.28 for A/B/C classes.
- **Kenya signals:** `lib/seed/kenya-calendar.ts` — Hardcoded fixed Kenyan holidays (Madaraka, Mashujaa, Jamhuri, Christmas, Boxing, Valentine's, Mother's/Father's Day computed), `isPaydayWeek()` checking days 25-end-of-month + 13-16 (mid-month payday).

**Callers:**
- `app/api/forecast/run/route.ts` (POST) — Computes ABC, runs simulator per product, persists `Prediction` rows, creates `Order` rows for critical/high urgency.
- `scripts/run-forecasts.ts` — CLI equivalent of the above.

**Aspirational (per `README.md` lines 15 and 57):**
- Python FastAPI sidecar service running statsmodels SARIMA + XGBoost residual model. `simulate-layers.ts` is intentionally shaped to return the same JSON contract a real service will produce, so the swap is "a one-file change" — replace the call to `simulateLayeredForecast()` with an HTTP fetch to the sidecar.

## Roadmap-Only Integrations (Aspirational)

These appear in `README.md` "Roadmap" (lines 55-59) but have no corresponding code:

- **Real Shopify OAuth** — Milestone 2. Schema field `Tenant.shopifyAccessToken` is the prepared landing spot.
- **Python FastAPI forecast service** (statsmodels SARIMA + XGBoost residual) — Milestone 2. Drop-in for `lib/forecast/simulate-layers.ts`.
- **Multi-channel sales aggregation** (WhatsApp / IG / retail) — Milestone 3. `SalesHistory.channel` field exists (default `"shopify"`) and would accept additional channel values.
- **M-Pesa billing** — Milestone 3. No Safaricom Daraja SDK, no `MPESA_*` env references. Pure aspiration.
- **Live FX rates** — Milestone 4. No FX provider integration. `Supplier.currency` stores USD/AED/EUR/KES strings for future conversion.
- **Google Trends Kenya** — Milestone 4. No `google-trends-api` or pytrends usage.
- **Weather signals** — Milestone 4. No weather API integration.
- **QuickBooks** — Mentioned only in the focus-area prompt; not present in `README.md` or codebase. Treated as aspirational / out-of-scope at this point.

---

*Integration audit: 2026-05-28*
