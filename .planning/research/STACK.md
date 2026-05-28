# Stack Research — Additions to the Existing Stock-Estimator Stack

**Domain:** Multi-tenant inventory forecasting (Shopify + QuickBooks ingest, Python forecast sidecar, Next.js 16 app)
**Researched:** 2026-05-28
**Overall confidence:** MEDIUM-HIGH

## Scope Note

The existing app stack is **fixed** and **not** revisited here: Next.js 16.2.6 (App Router), React 19, Prisma 6.1, TypeScript strict, Tailwind v4, Zod 3.24, npm, Vercel + Postgres. Everything below is an **addition** for the five decisions the milestone needs to make.

## Decisions Required

| # | Decision | Recommendation (short) |
|---|----------|------------------------|
| a | Shopify OAuth + Admin API SDK | `@shopify/shopify-api` (official, framework-agnostic) + `@shopify/shopify-app-session-storage-prisma` |
| b | QuickBooks Online OAuth + API | `intuit-oauth` (official, OAuth only) + thin custom Accounting API client; **avoid `node-quickbooks`** |
| c | Python forecast sidecar | FastAPI + statsmodels SARIMAX + XGBoost residual, Railway deploy, OpenTelemetry + Sentry |
| d | Session auth (multi-tenant) | **Better Auth v1.6.x** with `organization` plugin + Prisma adapter; Clerk only if owner pays for managed UI |
| e | Deterministic RNG for `simulate-layers.ts` stub | `mulberry32` inline (no dep), seeded by `productId + runDate` |

---

## (a) Shopify OAuth + Admin API in Next.js 16 App Router

### Recommendation

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@shopify/shopify-api` | `^11.x` (latest 2026) | Framework-agnostic OAuth, REST + GraphQL Admin clients, webhook HMAC, session model | Official Shopify package; only library Shopify themselves recommend for non-Remix/Express setups. **Confidence: HIGH** (Context7-verifiable, Shopify-published) |
| `@shopify/shopify-app-session-storage-prisma` | `^5.x` | Persists Shopify `Session` to Prisma | Avoids re-implementing the session adapter; works with the existing Prisma 6 client |
| `@shopify/admin-api-client` | `^1.x` | Thin GraphQL/REST client (optional — `shopify-api` re-exports) | Only pull in directly if you need it outside an OAuth session context (e.g. raw scripts) |

### Pattern — Next.js 16 App Router

There is **no official Next.js 16 adapter from Shopify** (the only official framework adapters are Express and React Router). The pattern that works is:

1. **Two route handlers**: `app/api/shopify/auth/route.ts` (calls `shopify.auth.begin`) and `app/api/shopify/callback/route.ts` (calls `shopify.auth.callback`). Both run on `runtime: 'nodejs'` (NOT edge — `@shopify/shopify-api` needs Node crypto/buffer).
2. **Session storage**: `new PrismaSessionStorage(prisma)` reuses the existing `lib/prisma.ts` singleton. Add a `Session` model to `prisma/schema.prisma` per the package's required shape.
3. **API version pinning**: pin to `ApiVersion.January26` (or whatever the current stable quarter is at build time). Do **not** use `LATEST_API_VERSION` in production — it changes under you on Shopify's quarterly cadence and breaks types.
4. **Tenant linkage**: on callback, look up `Tenant` by `shop` domain → write `shopifyAccessToken` (already in schema) and the offline session row.

### Token storage pattern

- **Offline access tokens** (server-to-server, no merchant present) — what you want for daily ingest. Long-lived per shop, stored encrypted at rest.
- Encrypt the `accessToken` column. Use a single app-level encryption key in `SHOPIFY_TOKEN_ENCRYPTION_KEY` (32 bytes, base64). `@shopify/shopify-app-session-storage-prisma` does NOT encrypt by default — wrap it or use Prisma field-level encryption.
- One offline session per `(tenantId, shopDomain)`. Online sessions (per-merchant-user) are only needed if you ever embed admin UI — not in scope for v1.

### Rate-limit handling

Shopify Admin GraphQL uses a **calculated query cost / leaky bucket** model:
- Standard plan: 1000-point bucket, 50 points/sec restore. Plus: 2000 / 100.
- Each response includes `extensions.cost.throttleStatus` — read `currentlyAvailable` after every call.
- **Pattern**: maintain a per-shop bucket simulator in memory; before each call, if `currentlyAvailable < requestedQueryCost`, sleep `(requestedQueryCost - currentlyAvailable) / restoreRate * 1000` ms.
- For initial historical backfill (orders, inventory), **use Bulk Operations** (`bulkOperationRunQuery`) — they bypass cost limits and stream JSONL. This is non-negotiable for a 365-day order pull.
- Retry on `429`: exponential backoff with jitter, max 5 attempts.
- Add `Shopify-GraphQL-Cost-Debug: 1` header in development to see per-field cost.

### Multi-tenant fit

GOOD. `PrismaSessionStorage` is keyed by Shopify shop domain; map shop → `Tenant.id` at callback. Each tenant gets isolated offline sessions. No cross-tenant token leak risk if your Prisma queries are tenant-scoped (which they currently aren't — that's a separate Phase 1 fix).

---

## (b) QuickBooks Online OAuth + Accounting API in Node

### Recommendation

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `intuit-oauth` (a.k.a. `oauth-jsclient`) | `^4.x` | Official Intuit OAuth 2.0 + OIDC client. Authorize URL, code→token, refresh, revoke | Maintained by Intuit. Handles the **refresh-token rotation** Intuit enforces. **Confidence: HIGH** (Intuit-published, on Intuit Developer Portal) |
| `axios` or `undici` | latest | HTTP client for the Accounting API itself | Lighter than wrapping `node-quickbooks` — see below |
| `zod` | `^3.24` (already in stack) | Parse/validate the v3 Accounting API response shapes | Don't trust the SDK types blindly |

### Why NOT `node-quickbooks`

`node-quickbooks` is community-maintained, not from Intuit, and (a) ships with stale dependency footprint, (b) wraps OAuth1.0a era patterns retrofitted to OAuth2, (c) no TypeScript types, (d) hides the refresh-token rotation from you which is the **one thing you have to get right**. The official Intuit Node sample explicitly uses `intuit-oauth` + raw HTTP for the API. **Confidence: MEDIUM** (cross-referenced npm + Intuit dev portal — both libraries exist, `node-quickbooks` is older and not Intuit-published).

### OAuth + token-rotation pattern

- **Access token**: lives 1 hour (3600s).
- **Refresh token**: lives 100 days, **rotates on every refresh** — the old refresh token is invalidated immediately when you get a new one.
- **CRITICAL**: persist the new refresh token atomically with the new access token. If you crash between getting the response and saving, that tenant is **locked out** and must re-authorize. Wrap in a single Prisma transaction.
- Schema additions to `Tenant`:
  ```
  qboRealmId            String?
  qboAccessToken        String?   // encrypted
  qboRefreshToken       String?   // encrypted, rotates
  qboAccessTokenExpiry  DateTime?
  qboRefreshTokenExpiry DateTime?
  ```
- Refresh proactively when access token has < 5 minutes left. Refresh on 401. Never call refresh from two parallel requests for the same tenant (use a per-tenant in-process lock or a DB advisory lock).
- Endpoints differ by environment: `sandbox-quickbooks.api.intuit.com` for dev, `quickbooks.api.intuit.com` for prod. Token URL is the same: `oauth.platform.intuit.com/oauth2/v1/tokens/bearer`.

### Multi-tenant fit

GOOD. One QBO connection = one `realmId` per tenant. Store on `Tenant` row. Refresh-token rotation is per-tenant; nothing shared. Add a `Last-Modified-Time` cursor per tenant for incremental sales pulls.

### What to actually pull

- `Item` (inventory + non-inventory items) — match to `Product` by name/sku.
- `SalesReceipt` + `Invoice` + `Payment` (POS lands as SalesReceipt; storefront via web connector lands as Invoice).
- `InventoryAdjustment` if doing reconciliation.
- Use **CDC (Change Data Capture) endpoint** `/cdc` for incremental sync after first load — single call returns all changed entities since a timestamp.

---

## (c) Python Forecast Sidecar

### Recommendation

| Component | Choice | Version | Why |
|-----------|--------|---------|-----|
| Web framework | **FastAPI** | `^0.115` | De-facto standard for ML model serving. Pydantic v2 schemas align with the existing zod contract. Built-in OpenAPI for the TS app to type-check against. **Confidence: HIGH** |
| ASGI server | **uvicorn[standard]** | `^0.32` | Standard FastAPI runner |
| SARIMA | **statsmodels** `SARIMAX` | `^0.15` | What the README and existing TS stub model. Stable, well-understood, has `mle_retvals` for confidence bands. **Confidence: HIGH for fit-quality, MEDIUM for "best choice"** — see "Stability note" below |
| Residual model | **XGBoost** | `^2.1` | Existing roadmap pick. Battle-tested for tabular residuals over time features. **Confidence: HIGH** |
| Validation | **scikit-learn** `TimeSeriesSplit` | `^1.5` | For walk-forward CV — never use random k-fold on time series |
| Schema/serialization | **Pydantic v2** | `^2.9` | Bundled with FastAPI |
| Data | **pandas** | `^2.2`, NOT 3.x yet | XGBoost/statsmodels integration well-tested on 2.x |
| **Numpy** | **numpy** | `^2.0` | Pandas 2.2+ and statsmodels 0.15+ work on numpy 2; pin to avoid silent issues |

### Stability note — SARIMA vs Prophet vs NeuralProphet for retail

Comparative studies (2024–2026) show mixed results:
- **Prophet** sometimes beats SARIMAX on MAPE in batch backtests (e.g. MAE 4.25 vs 6.28 on one Kaggle retail dataset).
- **SARIMAX with online residual correction** beats both Prophet and NeuralProphet in **frozen-model regimes** (i.e. the model you re-fit once a week, not every day) — MAE 32.5 vs Prophet 37.6.
- **NeuralProphet is the least stable** of the three across studies — high variance on small datasets.

**For Beauty Square (small dataset, retail, frozen-fit cadence): SARIMAX + XGBoost residual is a defensible 2026 pick.** Keep an A/B harness so you can swap in Prophet later if MAPE doesn't beat the simulator baseline. **Confidence: MEDIUM** — defensible but not the only right answer. Flag for evaluation in the relevant phase.

### XGBoost residual pipeline

Standard pattern:
1. Fit SARIMAX on the daily sales series per `(tenantId, productId)`.
2. Compute in-sample residuals `r_t = y_t - ŷ_t^{SARIMA}`.
3. Build feature matrix: day-of-week, day-of-month, payday flag, holiday flag, active-promo flag, lagged residuals (1, 7, 14, 28), trend index. Kenya signals come from the TS app via the forecast request payload.
4. Fit `XGBRegressor` on residuals using `TimeSeriesSplit(n_splits=5)` for hyperparameter tuning. `tree_method='hist'` for speed on small data.
5. Forecast: `final = SARIMA_forecast + XGBoost_residual_forecast`.
6. Confidence interval: SARIMA gives one, widen by residual std from XGBoost CV folds.

**Persist the fitted model**: pickle SARIMAX results + JSON-export XGBoost booster per `(tenantId, productId)`. Re-fit weekly via scheduled job, predict daily.

### Deployment — Railway vs alternatives

**Recommendation: Railway.** Same provider Roy already uses for Melvin's LPO automation and Kidaflow LPO pipeline (per memory). Deploy via Dockerfile (Railway autodetects Python but Dockerfile gives you reproducible numpy/statsmodels builds).

| Option | When | Why |
|--------|------|-----|
| **Railway** ✓ | Default | Roy already operates Railway in production. ~$5/mo for v1 traffic. Easy env var management. Persistent disk if you store pickled models there. |
| Fly.io | If multi-region latency matters | Better cold-start story. Not needed for Nairobi single-tenant. |
| Modal | If forecast jobs go batch-async | Pay-per-second, scales to zero. Overkill for v1. |
| Vercel Python | NEVER | 60-second function limit, no persistent disk, cold starts kill statsmodels init. **Avoid.** |
| AWS Lambda + container | If client demands AWS | Cold starts on 500MB container = 10s. Painful. |

Use Railway's built-in **Postgres** as the model artifact store (small) OR a persistent volume. Don't store models in the Next.js DB — keep concerns separated.

### Observability

- **OpenTelemetry FastAPI auto-instrumentation** (`opentelemetry-instrumentation-fastapi`) — emit traces to Sentry/SigNoz/Grafana Cloud. **Confidence: HIGH**.
- **Sentry SDK for Python** (`sentry-sdk[fastapi]`) — error tracking. Roy already uses Sentry on other projects (per memory patterns).
- **Structured logs** via `structlog` — JSON to stdout, Railway captures.
- **Forecast-specific metrics**: log per-forecast MAPE vs prior-week actuals once you have ground truth. This is the single number that tells you the model is working.
- Health endpoint: `GET /health` returns model freshness per tenant.

### Contract — match the existing TS stub

`lib/forecast/simulate-layers.ts::simulateLayeredForecast()` returns `{ layer1Value, layer2Value, signals[] }`. The FastAPI service must return the **exact same JSON shape**. The TS app changes from a function call to `fetch(SIDECAR_URL + '/forecast', { method: 'POST', body: JSON.stringify(input) })` — one file. Auth between TS and Python sidecar: shared secret in `FORECAST_SIDECAR_TOKEN` header, validated by FastAPI dependency.

---

## (d) Session Auth for Next.js 16 App Router (Multi-Tenant)

### Recommendation: Better Auth v1.6.x

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `better-auth` | `^1.6.x` | Auth core | TypeScript-native, owns users in your Postgres, built-in `organization` plugin = multi-tenant out of the box. Auth.js maintainers themselves now point new projects toward Better Auth. **Confidence: MEDIUM-HIGH** |
| `@better-auth/prisma-adapter` | `^1.6.x` | Prisma 6 adapter | Reuses existing `lib/prisma.ts` |
| `better-auth/plugins/organization` | (in core) | Maps user ↔ Tenant ↔ role | Replaces the broken `prisma.tenant.findFirst()` calls with session-bound tenant resolution |

### Why not the alternatives

| Option | Verdict | Reason |
|--------|---------|--------|
| **NextAuth/Auth.js v5** | Acceptable but **not recommended for new builds** | Stable since late 2024; its own maintainers redirect new projects to Better Auth. Multi-tenant requires manual schema + custom logic. |
| **Lucia** | **DO NOT INSTALL** | Deprecated March 2025. Docs remain as educational reference only. Will rot. |
| **Clerk** | Use **only if** Anjay/Roy want managed UI + zero ops | Fastest TTFP for B2C, but $25/mo at 10K MAU; less control over user table (matters for a multi-tenant Postgres app); harder to do tenant-bound queries server-side without paying for Pro. For a 1-tenant-today project that wants to own data, Better Auth wins. |
| **Custom Auth** | NO | Already burned by zero-auth state; rolling your own multi-tenant session would consume the whole milestone budget. |
| **Supabase Auth** | NO | Different DB platform — Vercel Postgres is already in stack, swap cost is huge. |

### Multi-tenant pattern with Better Auth

1. Better Auth's `organization` plugin gives you `Organization` (= your `Tenant`), `Member` (user↔org), `Invitation`.
2. **Reuse existing `Tenant` table**: configure Better Auth's organization model to map `Organization.id` ↔ `Tenant.id`. Add a `userId` field to `Tenant` if any, or just add `Member.organizationId = Tenant.id`.
3. Session contains `activeOrganizationId` — that's your `tenantId`.
4. **Replace every `prisma.tenant.findFirst()`** with a single helper:
   ```ts
   // lib/auth/context.ts
   export async function requireTenant() {
     const session = await auth.api.getSession({ headers: headers() })
     if (!session?.session.activeOrganizationId) throw new UnauthorizedError()
     return session.session.activeOrganizationId
   }
   ```
5. Every `app/api/*` route calls `requireTenant()` first. Every Prisma query includes `where: { tenantId }`.

### Schema impact

Better Auth needs these tables: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`. Run `npx better-auth generate` to emit Prisma schema additions. Run `prisma migrate`.

### Confidence

**MEDIUM-HIGH.** Better Auth v1 shipped early 2025, has reached stable, and the organization plugin is well-documented for the multi-tenant case. The main risk is library maturity (still <2 years old). Mitigation: thin auth wrapper in `lib/auth/` that exposes only `requireTenant()`, `requireUser()`, `getSession()` — if Better Auth ever needs replacing, the blast radius is small.

---

## (e) Deterministic Seeded RNG for `simulate-layers.ts`

### Recommendation: Inline `mulberry32`, no dependency.

```ts
// lib/forecast/rng.ts
export function mulberry32(seed: number) {
  return function() {
    seed = (seed + 0x6D2B79F5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Seed must be deterministic per forecast — derive from productId + runDate
export function seedFor(productId: string, runDate: Date): number {
  const s = `${productId}-${runDate.toISOString().slice(0,10)}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return h
}
```

### Why mulberry32 vs alternatives

| Option | Verdict | Why |
|--------|---------|-----|
| **mulberry32 inline** ✓ | **Pick this** | 6 lines, no dependency, period ~2³², high statistical quality, used by d3-random et al. Replaces every `Math.random()` in `simulate-layers.ts` with `rng()` from a per-product-per-run seed. |
| `seedrandom` (npm) | Acceptable | 30KB, depends on `crypto`, overkill for noise injection in a simulator stub |
| `prando` (npm) | Acceptable | TypeScript-native, good DX, but external dep for what is ~10 lines of math |
| `rand-seed` (npm) | Acceptable | Multiple algorithms (sfc32, mulberry32, xoshiro128**) — only useful if you need to A/B PRNGs |
| `crypto.randomBytes` | NO | Not seedable — defeats the purpose |

**Confidence: HIGH.** mulberry32 is a well-known PRNG; the seed-from-`(productId, runDate)` pattern guarantees same input → same output for the entire lifetime of the simulator stub, which is the milestone goal. Once the Python sidecar lands, this code is deleted — minimal investment.

---

## What To Avoid

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node-quickbooks` | Community, not Intuit; hides refresh rotation; no TS types | `intuit-oauth` + thin custom HTTP client |
| Lucia Auth | Deprecated March 2025 | Better Auth |
| NextAuth v4 patterns (legacy `[...nextauth].ts`) | Pre-App-Router; broken under Next 16 | Better Auth (or Auth.js v5 if migrating) |
| `LATEST_API_VERSION` from `@shopify/shopify-api` in prod | Auto-rolls every quarter; breaks types and queries silently | Pin to a specific `ApiVersion.January26` |
| Single REST `orders.json` calls for historical backfill | Costs 1 point/call × 50K orders = days of throttled time | Bulk Operations (`bulkOperationRunQuery`) |
| Vercel Python functions for the forecast sidecar | 60s timeout, no persistent disk, cold-start cost for statsmodels | Railway with Dockerfile |
| `pip install -r requirements.txt` without lock | Numpy 2 / statsmodels 0.15 / pandas 2.2 must agree | `uv` or `pip-tools` with lockfile |
| Storing QBO refresh token without DB transaction wrap | One crash mid-refresh = tenant locked out (100-day re-auth) | Single transaction: refresh API call → store both tokens atomically |
| Math.random() anywhere in forecast code | Non-determinism = unreproducible tests, untrustable forecasts | mulberry32 + per-product-per-run seed |
| `dayjs` / `moment` for date math in this milestone | Timezone bugs around Kenya payday windows | Native `Date` + small `addDays`/`isPaydayWeek` helpers (already exist in `lib/seed/kenya-calendar.ts`) |
| Storing Shopify or QBO tokens unencrypted | Plain-text DB compromise = full merchant access | Field-level encryption with single `*_TOKEN_ENCRYPTION_KEY` env var |
| `pickle` for XGBoost model storage | Brittle across xgboost minor versions | XGBoost native `Booster.save_model(path.json)` |

---

## Installation Cheatsheet

```bash
# Next.js app (existing repo)
npm install @shopify/shopify-api@^11 @shopify/shopify-app-session-storage-prisma@^5
npm install intuit-oauth@^4
npm install better-auth@^1.6 @better-auth/prisma-adapter@^1.6

# Python sidecar (new repo or sub-directory)
# requirements.txt
fastapi==0.115.*
uvicorn[standard]==0.32.*
pydantic==2.9.*
statsmodels==0.15.*
xgboost==2.1.*
scikit-learn==1.5.*
pandas==2.2.*
numpy==2.0.*
sentry-sdk[fastapi]==2.*
opentelemetry-instrumentation-fastapi==0.48b0
structlog==24.*
httpx==0.27.*
```

---

## Multi-Tenant Compatibility Summary

| Choice | Multi-tenant story | Risk |
|--------|---------------------|------|
| `@shopify/shopify-api` + Prisma session storage | One offline session per shop domain; map to `tenantId` at callback | Low — naturally per-tenant |
| `intuit-oauth` + custom client | One `realmId` per tenant on the `Tenant` row | Medium — refresh-token rotation race if you don't lock per-tenant |
| FastAPI sidecar | Stateless; takes `tenantId` + `productId` in request body; persists models per `(tenantId, productId)` | Low — tenant just becomes a key in the model store |
| Better Auth + organization plugin | Built for this exact case (org = tenant) | Low — primary reason this beats Auth.js v5 |
| mulberry32 RNG | Seeded by `(productId, runDate)`; productIds are already tenant-scoped | None |

---

## Confidence Summary

| Decision | Confidence | Evidence basis |
|----------|------------|----------------|
| (a) Shopify: `@shopify/shopify-api` + Prisma storage | **HIGH** | Official Shopify packages, documented on shopify.dev, GitHub `Shopify/shopify-app-js` is canonical |
| (a) Rate-limit strategy | **HIGH** | shopify.dev/docs/api/usage/limits is current and unambiguous |
| (b) Use `intuit-oauth`, avoid `node-quickbooks` | **MEDIUM-HIGH** | Intuit Developer Portal lists `intuit-oauth` (a.k.a. `oauth-jsclient`) as official; `node-quickbooks` is community, older |
| (b) Refresh-token rotation requires atomic store | **HIGH** | Intuit FAQ + community help threads explicitly document the invalidation |
| (c) FastAPI + statsmodels + XGBoost | **HIGH** for stack, **MEDIUM** for model choice over Prophet | Standard 2026 pattern; SARIMA vs Prophet has mixed evidence — defensible pick but worth A/B testing |
| (c) Railway deployment | **HIGH** | Roy operates Railway in production today on multiple projects |
| (c) Observability (OTel + Sentry) | **HIGH** | Standard FastAPI stack; instrumentation packages mature |
| (d) Better Auth over NextAuth/Lucia/Clerk | **MEDIUM-HIGH** | Multiple 2026 comparisons agree; Lucia deprecation is fact; Better Auth maturity is the only risk |
| (d) Organization plugin for multi-tenant | **MEDIUM-HIGH** | Documented and used in production examples; some open issues around edge cases |
| (e) mulberry32 inline | **HIGH** | Well-known PRNG, trivial implementation, matches the milestone scope (transitional code) |

## Gaps / Things to Verify in Phase Research

1. **Exact current `@shopify/shopify-api` major version** — pin during phase implementation; could be v11 or v12 by build time. Verify against `npm view @shopify/shopify-api version` at phase start.
2. **Better Auth `organization` plugin edge cases with Prisma 6** — there's at least one open GitHub issue (#6768) around member-creation invalid invocation. Smoke-test the invitation flow before relying on it.
3. **Numpy 2.0 + statsmodels 0.15 + xgboost 2.1 + pandas 2.2 compatibility** — confirmed individually but full-matrix smoke-test on Railway Dockerfile before going live.
4. **Shopify API quarterly version** — pick the version that is **stable** (not unstable/candidate) at phase-1 start.
5. **Whether to encrypt tokens with Prisma field-level encryption or app-level `crypto`** — depends on whether Vercel Postgres extensions (pgcrypto) are easier than Node-side. Pick one in the phase.

---

## Sources

**Shopify**
- [Shopify App JavaScript SDK overview](https://shopify.dev/docs/api/shopify-app) — Official package map
- [Shopify shopify-app-js GitHub](https://github.com/Shopify/shopify-app-js) — Source of truth for `@shopify/shopify-api`
- [@shopify/shopify-app-session-storage-prisma](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma) — Prisma session adapter
- [Shopify Admin API rate limits](https://shopify.dev/docs/api/usage/limits) — Cost calculation + leaky bucket
- [Shopify GraphQL API: Production Rate Limit Strategy 2026](https://no7software.co.uk/blog/shopify-graphql-admin-api-rate-limits-production) — Production patterns
- [Shopify rate limit dev guide 2026](https://www.letstalkshop.com/blog/shopify-admin-graphql-rate-limits-2026) — Bucket sizes per plan
- [OAuth guide for `@shopify/shopify-api`](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/docs/guides/oauth.md) — Begin/callback pattern

**QuickBooks**
- [Intuit Developer — OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) — Official OAuth flow
- [Intuit Developer — OAuth NodeJS Client](https://developer.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/nodejs/oauth-nodejs-client) — `intuit-oauth` reference
- [Intuit OAuth FAQ — refresh token rotation](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq) — Confirms rotation on every refresh
- [intuit/oauth-jsclient GitHub](https://github.com/intuit/oauth-jsclient) — Source of `intuit-oauth`
- [intuit/intuit-developer-nodejs](https://github.com/intuit/intuit-developer-nodejs) — Official starter combining OAuth + API
- [QuickBooks Online API Guide 2026 — Satva](https://satvasolutions.com/blog/quickbooks-online-api-guide) — Token lifetimes + endpoint reference

**Auth**
- [Better Auth vs NextAuth vs Lucia 2026 — BuildPilot](https://trybuildpilot.com/625-better-auth-vs-lucia-vs-nextauth-2026) — Lucia deprecated, Better Auth recommended for new TS projects
- [LogRocket — Best Next.js auth 2026](https://blog.logrocket.com/best-auth-library-nextjs-2026/) — Independent comparison
- [Better Auth vs Clerk vs NextAuth vs Supabase 2026 — Makerkit](https://makerkit.dev/blog/tutorials/better-auth-vs-clerk) — Multi-tenant focus
- [Better Auth Prisma adapter docs](https://better-auth.com/docs/adapters/prisma) — Adapter setup
- [Better Auth + ZenStack multi-tenant pattern](https://zenstack.dev/blog/better-auth) — Organization plugin + tenant scoping
- [Multi-tenant Next.js + Prisma + Auth.js (DEV)](https://dev.to/frostbyte_nz/how-we-built-a-multi-tenant-saas-with-nextjs-16-prisma-7-and-authjs-57gj) — Counter-evidence: Auth.js works too

**Forecast sidecar**
- [Modern Time Series Forecasting with Python (2026 book)](https://us.amazon.com/Modern-Time-Forecasting-Python-cutting-edge/dp/9365893623) — SARIMA + XGBoost + FastAPI deployment
- [SigNoz — OpenTelemetry + FastAPI](https://signoz.io/blog/opentelemetry-fastapi/) — Auto-instrumentation guide
- [opentelemetry-instrumentation-fastapi PyPI](https://pypi.org/project/opentelemetry-instrumentation-fastapi/) — Package
- [statsmodels forecasting reference](https://www.statsmodels.org/devel/examples/notebooks/generated/statespace_forecasting.html) — SARIMAX usage
- [Hybrid SARIMA + XGBoost paper](https://www.researchgate.net/publication/387674315) — Methodology basis
- [Adaptive ensemble SARIMA + XGBoost (Nature 2025)](https://www.nature.com/articles/s41598-025-23352-w) — Recent retail forecasting research
- [Prophet vs SARIMA vs NeuralForecast](https://medium.com/@thecodedesk910/which-time-series-tool-you-should-use-prophet-vs-sarima-vs-neuralforecast-6f486d80bb42) — Stability evidence
- [Railway third-party observability](https://docs.railway.com/guides/third-party-observability) — Sentry/Datadog/etc integration

**RNG**
- [Prando (zeh/prando)](https://github.com/zeh/prando) — Alternative seeded PRNG
- [rand-seed npm](https://github.com/michaeldzjap/rand-seed) — Multi-algorithm option
- [Mulberry32 reference (Scalable Developer)](https://scalabledeveloper.com/posts/pseudorandom-number-generators/) — Algorithm description

---

*Stack research for: Stock Estimator Phase-1+ additions*
*Researched: 2026-05-28*
