# Codebase Concerns

**Analysis Date:** 2026-05-28

This document catalogues every gap, stub, and risk a future Claude needs to know about before writing or changing code in this repo. Each item names files and explains the operational impact.

---

## 1. Known Stubs & Mocks (entire ML + integration layer is simulated)

### 1.1 SARIMA + XGBoost forecasting is 100% TypeScript simulation

**Files:** `lib/forecast/simulate-layers.ts`, `lib/forecast/baseline.ts`

The README states this directly (lines 7, 15): "Layer 1 (SARIMA mock) + Layer 2 (XGBoost mock)" — there is **no statsmodels SARIMA and no XGBoost** anywhere. What the file actually does:

- `seasonalNaive30()` (`simulate-layers.ts:51`) — Labelled "Layer 1 (SARIMA)" but is a weighted blend: `0.6 × recent-30d total + 0.4 × same-30d-window-from-365-days-ago`, falling back to `weightedDailyRate × 30` if no seasonal data. Pure naive seasonal projection, not ARIMA.
- The "Layer 2 XGBoost adjustment" (`simulate-layers.ts:158-163`) is a deterministic multiplicative formula: `layer1 × holidayBoost × paydayMultiplier × promoLift × (0.95 + Math.random() × 0.1)`. No model, no residual learning, no features beyond what's hardcoded in `lib/seed/kenya-calendar.ts`.
- `layer1Confidence` (`simulate-layers.ts:131-134`) is derived from coefficient of variation, not from any model.
- The string "SARIMA mock" / "XGBoost mock" is **written into every prediction's `reasoning` field** (`simulate-layers.ts:185-186`) and surfaced in the dashboard UI (`app/dashboard/product/[id]/page.tsx:156-162` show `badge="mock"`, and `app/settings/page.tsx:160,293` print "Layer 1 SARIMA + Layer 2 XGBoost — both mock" to users).

**Contract shape the real Python sidecar must produce:** `ForecastResult` type at `lib/forecast/simulate-layers.ts:36-49` — eleven fields including `layer1Forecast30d`, `layer1Confidence`, `layer2Adjustment`, `finalForecast30d`, `safetyStock`, `reorderPoint`, `confidence`, `reasoning`, `urgency`, `signals[]`. The README (line 15) calls swap "a one-file change" — that is true only if the Python service returns this exact JSON, including the `Signal[]` shape (`label`, `deltaPct`, `emoji`).

**Impact:** Every forecast in the system is a deterministic-plus-tiny-noise calculation. Two consecutive `/api/forecast/run` calls on the same data will produce ~10% variance from `Math.random()` alone. There is **no actual ML**.

### 1.2 Shopify client is a mock that reads from the local DB

**File:** `lib/shopify/client.ts`

Every method has a `// MOCK — real impl:` comment showing the real Shopify Admin API endpoint that should replace it:

- `testConnection()` (`client.ts:41`) — returns `ok: true` for any domain. If no access token, returns `mock: true`. **Never makes a network call.**
- `fetchProducts()` (`client.ts:49`) — reads `prisma.product` rows for the tenant and returns them as if they came from Shopify.
- `fetchOrders()` (`client.ts:69`) — reads `prisma.salesHistory` and reshapes it as Shopify orders.
- `fetchInventory()` (`client.ts:85`) — reads `prisma.product.currentStock`.
- `createDraftOrder()` (`client.ts:93`) — returns `{ id: "mock-draft-" + Date.now() }`. Nothing is sent to Shopify.

**Used by:** `app/api/shop/test/route.ts` (connect test). The order approval path at `app/api/orders/[id]/approve/route.ts:14` **also writes `mock-draft-${Date.now()}` directly into `shopifyDraftOrderId`**, bypassing the client entirely.

**Impact:** "Connect Shopify" in onboarding always succeeds. The "Approve order" button does not create a Shopify draft order — it only flips DB rows.

### 1.3 All data is synthetic

**Files:** `scripts/seed-from-beautysquare.ts`, `scripts/synth-sales-history.ts`, `scripts/seed-suppliers.ts`, `scripts/backfill-costs.ts`

- **Catalog:** Scraped from the public storefront `https://beautysquareke.co/products.json` (`seed-from-beautysquare.ts:26`). Tenant is hardcoded to `"Beauty Square KE"` / `"beautysquareke.co"` (`seed-from-beautysquare.ts:27-28`). Initial stock is `Math.floor(20 + Math.random() * 80)` per product (`seed-from-beautysquare.ts:61`). Cost is `price × random(0.45..0.60)` (`seed-from-beautysquare.ts:63`).
- **Sales history:** 365 days of Poisson-sampled daily sales (`synth-sales-history.ts:6-16`), with per-product base rate from `rankToBaseRate()` (`synth-sales-history.ts:18-27`) — a long-tail distribution where ~20% get the bulk of sales and the bottom 20% are intentionally dead stock. Sales are amplified by Kenya calendar (`kenya-calendar.ts`): day-of-week, payday weeks (25–end + 13–16), and holiday boosts (Christmas 2.5×, V-Day fragrance 3.0×, etc.). 5–8 synthetic promo windows per product per year are also injected.
- **`currentStock` is re-tuned post-synth** (`synth-sales-history.ts:114-127`) to deliberately produce a 10% near-stockout / 20% comfortable / 70% well-stocked mix so the dashboard "Urgent" tab is never empty in demos.
- **Suppliers:** Six hardcoded suppliers in `scripts/seed-suppliers.ts:18-86` (Guangzhou Beauty Imports, Dubai Cosmetics House, Nairobi Trade Centre, Eastleigh Distributors, EU Beauty Direct, Mombasa Sea Freight). Assigned to products by string-matching `vendor` against a `matchVendor: ["COSRX", "ANUA", ...]` array.
- **Costs:** Re-randomised by supplier in `scripts/backfill-costs.ts:6-13` to produce believable per-supplier margin bands.

**Impact:** Nothing in this DB came from a real shop. All ABC tiers, urgency flags, lost-sales numbers, and ROI scores are computed on synthetic data that was deliberately shaped to look impressive.

---

## 2. Production Gaps (explicitly called out in README, but with hidden traps)

### 2.1 SQLite cannot work on Vercel

**Files:** `prisma/schema.prisma:5-8`, `prisma/dev.db` (45 MB, **committed to git**), `.gitignore:43-44`

README §"Deploy to Vercel" (lines 27-34) acknowledges: *"the bundled `prisma/dev.db` lets the deployment serve pages, but Vercel's filesystem is read-only at runtime — any seed/forecast/promo write will fail."*

To switch to Postgres requires **four manual changes**, none scripted:
1. Provision Postgres (Vercel Postgres / Neon).
2. Set `DATABASE_URL` in Vercel.
3. Edit `prisma/schema.prisma:6` from `provider = "sqlite"` to `provider = "postgresql"`.
4. Change `url = "file:./dev.db"` (`schema.prisma:7`) to `url = env("DATABASE_URL")` — **the README doesn't mention this**, but Prisma will fail without it.
5. Run `npx prisma db push` against the new DB.

**Hidden trap:** The `Prediction.signals` field at `schema.prisma:141` is stored as `String` (a JSON-encoded array, parsed at `app/api/forecast/route.ts:123` and `app/api/products/[id]/route.ts:83`). On Postgres this still works but should ideally be `Json` for indexability — anyone "improving" the type at migration time will break those `JSON.parse(p.signals || "[]")` callsites.

**Hidden trap 2:** `prisma/dev.db` is 45 MB and tracked in git. Switching to Postgres won't remove it — it will continue bloating the repo. The `.gitignore` (`gitignore:43-44`) explicitly excludes only `prisma/dev.db-journal`, leaving the DB file committed by design.

### 2.2 No `DATABASE_URL` plumbing in code

The Prisma schema hardcodes `url = "file:./dev.db"` (`schema.prisma:7`). No `env()` reference exists. So even setting `DATABASE_URL` in Vercel does nothing until step 4 above is performed.

### 2.3 No `.env.example` and no `.env` referenced in code

No `.env*` file exists in the repo. `.gitignore` line 34 excludes `.env*` files, but nothing in `lib/` or `app/` calls `process.env.*` for anything domain-specific. Conclusion: the app currently has zero runtime configuration. Adding Shopify OAuth, Postgres, Sentry, or M-Pesa will require introducing the env loading pattern from scratch.

---

## 3. Missing Features the Roadmap Depends On

README §Roadmap (lines 55-59) lists Milestones 2, 3, 4. Below is the **specific code-level gap** for each.

### 3.1 No real Shopify OAuth

- No `/api/auth/shopify/callback` route exists under `app/api/`.
- `lib/shopify/client.ts:36-46` accepts any `accessToken` string — there is no OAuth handshake, scope verification, or token refresh.
- The tenant table stores `shopifyAccessToken` as a plaintext `String?` (`schema.prisma:14`) — when OAuth lands, this needs encryption-at-rest planning.

### 3.2 No Python sidecar

- No `Dockerfile`, `pyproject.toml`, `requirements.txt`, or `python/` directory anywhere in the repo.
- No HTTP client wrapping calls to such a service. `app/api/forecast/run/route.ts:80` calls `simulateLayeredForecast()` directly in-process.
- README line 15 promises "swap is a one-file change" — true mechanically (replace the import in `forecast/run/route.ts:3`), but the Python service must replicate the *exact* `ForecastResult` shape including the human-readable `reasoning` string and emoji-tagged `signals[]`.

### 3.3 No QuickBooks connector

- No mention of QuickBooks, Xero, or any accounting integration anywhere in the codebase. The user prompt notes this as a roadmap item — nothing exists for it.
- Cost data is randomly generated by `scripts/backfill-costs.ts:30` (`cost = round(price × random(0.45..0.60))`). A real implementation needs to pull COGS from accounting.

### 3.4 No A/B/C product tiering as a first-class concept

- The `Product.abcCategory` column exists (`schema.prisma:40`) but is `String?` with no enum constraint. Values are written by `assignAbc()` at `app/api/forecast/run/route.ts:7-20` (and the duplicate copy at `scripts/run-forecasts.ts:6-19`) based on **last-90-day revenue only**, with cutoffs 70%/90%/100%.
- ABC is only **assigned during forecast runs** — there is no scheduled refresh, no manual override UI, no way to set per-SKU service-level targets (the `z` values are hardcoded at `lib/forecast/baseline.ts:57-61`: A=2.33, B=1.65, C=1.28).
- A real tiering system needs lifecycle tracking (new SKU vs. mature vs. EOL), multi-criteria (revenue + margin + strategic), and history (so you can see a SKU drop from A→B).

### 3.5 No backorder / on-order quantity tracking

- `Product` (`schema.prisma:27-54`) has `currentStock` (on-hand) but **no `incomingQty`, `onOrder`, `inboundETA`, or backorder field**.
- `Order` (`schema.prisma:151-165`) tracks approval status (`pending`, `approved`, `skipped`) but has **no `quantityOrdered`, `expectedArrivalDate`, or `receivedAt`** — once an order is approved, the system has no way of knowing units are en route. The next forecast run will re-recommend the same reorder because `currentStock` hasn't changed.
- `simulateLayeredForecast.recommendedQty` (`simulate-layers.ts:182`) is `ceil(finalForecast + safety - currentStock)` — does **not** subtract on-order units. This produces double-ordering whenever a previous PO is still in transit.

### 3.6 No multi-channel sales aggregation

- `SalesHistory.channel` (`schema.prisma:63`) defaults to `"shopify"` and the synth script (`synth-sales-history.ts:86`) writes only `"shopify"`.
- `Promo.channel` (`schema.prisma:99`) accepts `"shopify"|"whatsapp"|"instagram"|"all"` (zod enum at `app/api/promos/route.ts:13`), and the UI at `app/promos/page.tsx:122` exposes those as marketing toggles — but **no ingestion code exists** for non-Shopify channels. WhatsApp/IG sales never enter `SalesHistory`.
- The README §Roadmap line 58 calls this out as Milestone 3. The schema is *partly* ready (the `channel` column exists on `SalesHistory`) but no API routes, no parsers, no manual-entry UI.

### 3.7 No M-Pesa billing

- Zero M-Pesa code. The only "M-Pesa" mentions are marketing copy in `app/pricing/page.tsx` and `app/contact/page.tsx`.
- No Daraja SDK, no STK push handler, no `/api/billing/*` route, no `Subscription` or `Invoice` model in `schema.prisma`.

---

## 4. Security

### 4.1 ZERO authentication on every API route

**Every** route under `app/api/` is unauthenticated. There is **no** `getServerSession`, `auth()`, `cookies()`, header check, or middleware anywhere in the repo (confirmed: `Grep auth|session|getSession|getUser|headers\(|cookies\(` over `**/*.ts` returns no matches).

Specifically unprotected:
- `POST /api/shop` (`app/api/shop/route.ts:23`) — anyone can overwrite the tenant's name, domain, and **access token**.
- `POST /api/shop/test` (`app/api/shop/test/route.ts:10`) — accepts arbitrary domain + token, "tests" against the mock.
- `POST /api/seed` (`app/api/seed/route.ts:7`) — anyone can trigger a 365-day data wipe + re-synth. `maxDuration = 300` means it'll happily run for 5 minutes.
- `POST /api/forecast/run` (`app/api/forecast/run/route.ts:22`) — anyone can run the forecast loop (`maxDuration = 120`).
- `POST /api/orders/:id/approve` (`app/api/orders/[id]/approve/route.ts:4`) — anyone can mark any order approved.
- `POST /api/orders/:id/skip` (`app/api/orders/[id]/skip/route.ts:4`).
- `POST /api/products/:id` PATCH (`app/api/products/[id]/route.ts:90`) — change supplier on any product.
- `POST /api/promos` (`app/api/promos/route.ts:27`), `POST /api/suppliers` (`app/api/suppliers/route.ts:26`), `POST /api/monthly-context` (`app/api/monthly-context/route.ts:24`), `POST /api/simulate/budget` (`app/api/simulate/budget/route.ts:16`), `POST /api/simulate/demand-shock` (`app/api/simulate/demand-shock/route.ts:13`) — all open.
- All `GET` endpoints under `app/api/` are also unauthenticated, including the catalog and reports.

**Impact:** Once deployed to a public URL, any visitor can wipe and re-seed the database, change supplier assignments, approve fake reorders, and read all sales history. This must be fixed before any real client uses the app.

### 4.2 Implicit single-tenant via `prisma.tenant.findFirst()` everywhere

**12 API files use `prisma.tenant.findFirst()`** (count: 16 occurrences across 12 files) instead of resolving tenancy from a session or path param. Examples: `app/api/shop/route.ts:12,31`, `app/api/forecast/run/route.ts:23`, `app/api/reports/route.ts:5`, `app/api/products/route.ts:5`, `app/api/promos/route.ts:18,28`, `app/api/suppliers/route.ts:17,27`, `app/api/simulate/*/route.ts`, `app/api/catalog/facets/route.ts:5`, `app/api/monthly-context/route.ts:15,25`.

This is the de-facto tenant ID resolver. **Consequences:**
- Onboarding (`app/api/shop/route.ts:31-39`) calls `findFirst()` and if a tenant exists, *updates* it. So the second user to onboard **overwrites the first user's Shopify domain and token**.
- Adding a second tenant later will silently break every endpoint — they'll all operate on whichever row Prisma returns first (no `orderBy`).
- True multi-tenancy is a deep refactor: every `findFirst()` callsite must be replaced with auth-derived `tenantId`, and every query needs a `where: { tenantId }` clause (most already have this, but it currently comes from the implicit `findFirst()`).

### 4.3 Hardcoded tenant identity in code

- `scripts/seed-from-beautysquare.ts:27-28` hardcodes `TENANT_NAME = "Beauty Square KE"` and `SHOPIFY_DOMAIN = "beautysquareke.co"`. Any seed run mutates or creates *that* tenant.
- `app/settings/page.tsx:41-42` hardcodes the same values as the default form values for the onboarding UI.
- This makes "demo to a different shop" require a code change, not a config change.

### 4.4 Shopify access token stored as plaintext

`Tenant.shopifyAccessToken: String?` (`schema.prisma:14`) is stored unencrypted. Currently always null/empty (mock mode), but when OAuth lands this needs encryption-at-rest. The current `GET /api/shop` (`app/api/shop/route.ts:11-21`) returns `hasToken: !!tenant.shopifyAccessToken` — at least the value itself isn't echoed — but raw DB reads will expose it.

### 4.5 SQLite file is committed to git

`prisma/dev.db` (45 MB) is **tracked in the repo**. The `.gitignore:43-44` comment explicitly notes this is intentional ("commit the .db so Vercel reads have a DB"). Consequences:
- Repository bloat: every re-seed-and-commit balloons history.
- Anyone with repo read access can `git clone` and pull a full year of synthetic sales — fine today, dangerous the moment real Shopify data flows in.
- A `prisma db push` schema change on a developer's machine writes to this file and creates a diff every time.

### 4.6 No CORS, no rate-limiting, no input size limits on API routes

None of the routes set CORS headers, none rate-limit, and `app/api/seed/route.ts:5` sets `maxDuration = 300` — a single attacker call can pin the database for 5 minutes.

---

## 5. Test Coverage

### 5.1 No test framework installed

- `package.json` has **no** `test` script (it has `dev`, `build`, `start`, `lint`, `db:*`, `seed`).
- No `jest`, `vitest`, `playwright`, `@testing-library/*` in `dependencies` or `devDependencies`.
- No `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, `jest.config.*`, or `vitest.config.*` anywhere in the repo (find returned zero results).
- `.gitignore:14` reserves `/coverage` but nothing produces coverage.

**Impact:** The next code change anywhere in this repo will be verified only by `npm run dev` and clicking through the UI. There is **no regression net** at all. High-value targets to test first (when a framework is added):

| Module | Risk |
|--------|------|
| `lib/forecast/baseline.ts` | Pure math — `kingsSafetyStock`, `weightedDailyRate`, `urgencyFromDays`, `zForServiceLevel`. Easy to unit-test, high blast radius. |
| `lib/forecast/simulate-layers.ts` | The whole forecast contract. Snapshot tests would lock the JSON shape before the Python swap. |
| `lib/seed/kenya-calendar.ts` | Date math for holidays + paydays — easy to break with timezone bugs. |
| `app/api/forecast/run/route.ts` ABC assignment | Deterministic, currently untested, copy-pasted to `scripts/run-forecasts.ts` (drift risk). |
| `app/api/simulate/budget/route.ts` | Greedy allocator with critical-overflow logic — easy to get wrong. |

### 5.2 Duplicate forecast-orchestration logic (drift bomb)

`app/api/forecast/run/route.ts:7-20` (`assignAbc`) and `scripts/run-forecasts.ts:6-19` are **literally identical** copy-pastes. The whole orchestration body (lines 22-137 vs 21-125) is ~95% duplicated. Any fix to one **will not** propagate to the other. This is unsafe without tests.

---

## 6. Fragile Areas

### 6.1 Mock data assumes Kenya retail patterns — real Shopify data won't match

The forecast quality depends on Kenya-specific signal shapes baked into the synthetic data:

- `synth-sales-history.ts:71-77` injects payday (1.6×), day-of-week (Friday 1.35×, Saturday 1.5×), and Kenyan holiday multipliers into *generated* daily sales. So when `simulate-layers.ts` looks back and detects "Christmas same-period-last-year was 2.5× higher", it's because the synth script put that signal there.
- `lib/seed/kenya-calendar.ts:13` hardcodes that Christmas boosts FRAGRANCE by 3.0× and SKINCARE by 2.0× — for categorisation matching to work, `Product.productType` must be one of `FRAGRANCE | MAKEUP | SKINCARE | HAIRCARE | LIP CARE | BODY` (uppercase). Real Shopify product_type values from a *different* store may be `"Fragrance"`, `"Eau de Parfum"`, `"Perfume"`, or anything else — the case-insensitive match at `kenya-calendar.ts:86,94` will *not* match `"Eau de Parfum"` and silently fall through to `categoryBoost["ALL"]`.
- Similarly the supplier auto-assignment at `scripts/seed-suppliers.ts:124-145` matches on hardcoded vendor names (`COSRX`, `ANUA`, `LANEIGE`, `FENTY`, etc.). A different shop = zero matches = everything falls through to "Nairobi Trade Centre" (`seed-suppliers.ts:142-143`).

**Impact when real Shopify connects:** Forecasts will *run* but lose all the holiday/category boosts. ABC tiering will still work (it's revenue-based). Safety stock will still work (it's math on lead time + demand). Supplier assignment will collapse to one default supplier.

### 6.2 ABC assignment is destructive and stateless

`app/api/forecast/run/route.ts:70` runs `prisma.prediction.deleteMany({ where: { tenantId } })` **before** every forecast run, and `scripts/run-forecasts.ts:69-70` additionally `deleteMany`s all `Order` rows. This means:

- Forecast history is **not kept**. There is no way to see "what did we predict last week vs. this week" — every run wipes the slate.
- The orders table loses its non-pending rows on each script run (`run-forecasts.ts:70` deletes *all* orders, not just pending ones). The API endpoint at `app/api/forecast/run/route.ts:70` is slightly safer (deletes only predictions, not orders) but then **new** pending orders pile on top of old approved/skipped ones from previous runs.
- Backtesting model accuracy is impossible without prediction history.

### 6.3 Random-noise leak into forecasts (non-reproducible)

`simulate-layers.ts:162` includes `const noise = 0.95 + Math.random() * 0.1;` in the final forecast. Two consecutive `/api/forecast/run` calls on identical data produce up to ±5% different `recommendedQty`. Combined with §6.2 (no history), this means the same store at the same instant could see different "Approve order" amounts depending on which forecast run they're looking at.

### 6.4 SQLite + Prisma scaling cliffs

- The forecast loop at `app/api/forecast/run/route.ts:73-134` does **one `prisma.prediction.create` per product, sequentially in JS**. For a 1,020-SKU shop (the seeded BeautySquare catalogue) that's 1,020 round trips. SQLite handles it locally; on Postgres over the network it'll be slow.
- `synth-sales-history.ts:89-92` already batches at 1,000 rows. Other writers don't batch.
- `app/api/forecast/route.ts:17-37` loads **all** predictions + 365-day sales history with no pagination — fine at 1k products / 100k sales rows; will choke at 10k / 1M.

### 6.5 Schema gaps that block roadmap features

| Roadmap item | Schema gap | Required change |
|--------------|------------|-----------------|
| Multi-channel sales (M3) | `SalesHistory.channel` exists but no ingestion paths | New API routes; manual-entry UI; bulk-import CSV |
| Backorder tracking | `Order` has no `quantity` field, no `expectedArrivalAt`, no `receivedAt` | Add fields, update `simulate-layers.ts:182` to subtract on-order units |
| ABC overrides | `Product.abcCategory` is unconstrained `String?`, set only by forecast run | Add `abcOverride: String?` + UI |
| Real OAuth | `Tenant.shopifyAccessToken` is plaintext | Encrypt-at-rest + add `shopifyScopes: String?` + `tokenExpiresAt: DateTime?` |
| Audit log | No table | Add `AuditLog` model |
| Subscription / billing | No `Subscription`, `Invoice`, or `MpesaPayment` | Whole new module |

### 6.6 Shared `cuid()` IDs and cascade deletes

All models use `@default(cuid())` (`schema.prisma` lines 11, 28, 57, 73, 91, 109, 125, 152). Eleven `onDelete: Cascade` rules are in place from `Tenant` outward, which is correct — deleting the tenant wipes everything. But: **there is no soft-delete anywhere**. The `/api/seed` route (`app/api/seed/route.ts:7`) calls `synth()` which calls `prisma.salesHistory.deleteMany()` (`synth-sales-history.ts:36`) — a hard delete of a real shop's sales history if mock-mode is ever pointed at production data by mistake.

---

## 7. Minor / Low-priority

- `scripts/seed-from-beautysquare.ts:54` skips products with no variants silently. No log, no count of skipped rows.
- `scripts/seed-from-beautysquare.ts:97` exits pagination on `< 250` results; Shopify pagination can theoretically return fewer per page legitimately — fragile if the source store changes.
- `simulate-layers.ts:141-142` emoji selection (`"🎄" : "💝" : "🌙" : "🎉"`) is hardcoded by holiday substring match. Adding a new holiday will silently get the generic "🎉".
- `lib/forecast/baseline.ts:22` returns `999` as a sentinel for "infinite days of stock" — eight places use it for sorting/display; if any sort by ascending stockout days, dead-stock items will appear first.
- `app/settings/page.tsx:42` hardcoded `"beautysquareke.co"` — when a real customer onboards, they'll see the wrong default and may submit it.

---

*Concerns audit: 2026-05-28*
