# Pitfalls Research

**Domain:** Multi-tenant SMB retail demand forecasting (Next.js orchestrator + Python ML sidecar + Shopify/QuickBooks integrations)
**Researched:** 2026-05-28
**Confidence:** HIGH for Shopify/QuickBooks/multi-tenant patterns (Context-rich official docs, multiple community reports, verified). MEDIUM for SARIMA-on-short-history and XGBoost cold-start (well-documented academic + practitioner consensus, but project-specific calibration unverified). MEDIUM for Kenya/SMB connectivity heuristics (anchored in real Beauty Square context but no formal study).

This is a **subsequent-milestone** research file. The codebase concerns already documented in `.planning/codebase/CONCERNS.md` (Math.random, `findFirst()`, no auth, no onOrder, committed dev.db, no tests) are **inputs** to this file, not outputs. The pitfalls below are about what real-world teams hit when doing **the upcoming work** — wiring real Shopify, real QuickBooks, a real Python ML service, and retrofitting auth/tenancy onto an app that wasn't built for it.

---

## Critical Pitfalls

### Pitfall 1: Shopify webhook HMAC verification fails because Next.js App Router consumed the body

**What goes wrong:**
You write a Shopify webhook handler at `app/api/webhooks/shopify/route.ts`. You call `await request.json()` to read the payload, then try to verify the `X-Shopify-Hmac-Sha256` header against the body. Every signature fails. You spend hours thinking your shared secret is wrong. It isn't — the JSON parse mutated the bytes.

**Why it happens:**
Shopify computes HMAC over the **raw bytes** of the request body. The moment you call `.json()` (or any framework auto-parses), the body stream is consumed, re-serialised on access, and whitespace / key-order / Unicode escapes diverge from what Shopify hashed. App Router (Web Fetch `Request`) does not have an `express.raw()` equivalent — once a stream is consumed, the original bytes are gone. A second common variant: using `.digest('hex')` instead of `.digest('base64')` (Shopify sends base64 in the header).

**How to avoid:**
1. In every webhook route, the **first** thing you do is `const raw = await request.text();`. Never call `.json()` first.
2. Verify HMAC against `raw` using `crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(raw, 'utf8').digest('base64')` and compare with `crypto.timingSafeEqual(...)` (not `===`).
3. Only after verification, `JSON.parse(raw)` yourself.
4. Add a contract test: hash a known fixture body with a test secret and assert the route returns 200; mutate one byte and assert it returns 401.

**Warning signs:**
- All webhook deliveries failing with 401 in the Shopify partner dashboard.
- Signature compares correctly in a `curl` replay but not from real Shopify.
- A "fix" that involves disabling the check "just to unblock testing" (this almost always ships to prod).

**Phase to address:**
Whichever phase wires webhooks (likely the Shopify integration phase, or a later one if v1 stays pull-only — the README/PROJECT.md currently flag real-time inventory sync as out-of-scope, so this may not appear in v1 at all). If webhooks are deferred, **document this pitfall in the phase plan that adds them** so the next reader doesn't re-learn it.

---

### Pitfall 2: Shopify OAuth scopes chosen too narrowly, requiring full reinstall later

**What goes wrong:**
You ship Phase 1 of the Shopify integration with `read_products, read_orders` because that's all you need for catalog + history. Two phases later you add the "approve order → create draft order" feature and discover you need `write_draft_orders`. Adding a scope **requires the merchant to uninstall and reinstall the app and reapprove the OAuth screen** — a friction event you have to drag every existing tenant through.

**Why it happens:**
Scope changes are not silent. Shopify (correctly) treats new scopes as a privilege escalation requiring fresh merchant consent. Teams under-scope at install time because "minimum data" is the official guidance, then discover later they need write access for a feature that wasn't on the day-1 roadmap.

**How to avoid:**
- Before requesting any scopes, list **all features that exist in `.planning/PROJECT.md` Active or Validated** that touch Shopify (catalog read, orders read, inventory read, draft order create on approve, location read for multi-location). Map each to its required scope from the [Shopify access scopes table](https://shopify.dev/docs/api/usage/access-scopes).
- Ship the OAuth flow with the full forecast-app scope set on day one: at minimum `read_products`, `read_orders`, `read_inventory`, `read_locations`, `read_customers` (for ABC analysis), and `write_draft_orders` (because the existing `app/api/orders/[id]/approve/route.ts` is already designed to mint draft orders).
- Use the [managed installation flow](https://shopify.dev/docs/apps/build/authentication-authorization) so scope changes can be made declaratively in `shopify.app.toml` and Shopify drives the re-consent.
- Store `shopifyScopes: String?` on `Tenant` so the app can detect mid-life scope drift and force a re-auth.

**Warning signs:**
- A feature spec that says "needs to mutate Shopify" but the OAuth screen never asked for write access.
- The first merchant calling about "the app asked me to reinstall" mid-life — that's a scope upgrade you didn't plan for.

**Phase to address:**
Shopify OAuth phase. Scope list must be reviewed against the **entire** PROJECT.md Active list, not just the current phase's deliverables.

---

### Pitfall 3: Confusing `available` vs `on_hand` vs `committed` in Shopify InventoryLevel — reorder math doubles up

**What goes wrong:**
You pull `InventoryLevel` and feed `quantities[available]` into `Product.currentStock`. Forecast runs, says "reorder 50 of X." Owner approves. Next forecast run still says "reorder 50" because Shopify's `available` already deducts committed-but-unfulfilled orders, but you didn't subtract the new draft order, and meanwhile fulfilment hasn't happened so `on_hand` is unchanged. You ship double.

A second flavour of this: the codebase concerns doc already flags that there's no `onOrder` field on `Product`. So even if you read Shopify perfectly, **once you mint a draft order, that quantity becomes "in flight" and the system has no place to record it**, so the next forecast run double-orders. This is the same pitfall surfacing on the write side.

**Why it happens:**
Shopify's `InventoryLevel` tracks **multiple quantity states** per item-per-location: `available`, `on_hand`, `committed`, `incoming`, `reserved`, `damaged`, `safety_stock`, `quality_control`. Most tutorials show `available` as "the number" and developers wire that in without internalising that `available = on_hand - committed - reserved - ...`. Then they ALSO subtract their own pending POs and create a double-deduction.

**How to avoid:**
1. **Define the contract explicitly in code** (`lib/shopify/inventory-contract.ts` or similar): "`currentStock` in our DB equals Shopify `on_hand` at primary location" — and write a JSDoc explaining what that excludes.
2. Pull `on_hand` (the physical truth) into `Product.currentStock`, NOT `available`.
3. Add the `Product.onOrder: Int @default(0)` field that CONCERNS.md §3.5 already flags as missing. Increment it when a draft order is created; decrement (and increment `currentStock`) when the order is marked received.
4. The reorder formula in `simulate-layers.ts:182` becomes: `recommendedQty = ceil(finalForecast + safety - currentStock - onOrder)`.
5. Add a snapshot test that locks the math down with a known fixture.

**Warning signs:**
- Two consecutive forecast runs producing identical "reorder X" for an SKU where an order was just approved.
- Owner complaining "I just bought 50 of these, why is it telling me to buy 50 more?"
- Reports of negative stock after fulfilment (you trusted `available`, Shopify deducted at fulfilment, you deducted again locally).

**Phase to address:**
Same phase that wires real Shopify inventory ingest. The `onOrder` schema field is a hard prerequisite — do not ship a real Shopify integration without it, or the first approved order silently breaks the next forecast.

---

### Pitfall 4: Multi-location Shopify stores — defaulting to "lowest location ID wins"

**What goes wrong:**
Beauty Square has one Shopify location today, so you write code that flattens inventory: `sum(inventory_levels[].available)` or just grabs the first location. The next client has a warehouse + a retail store + a kiosk, each with separate inventory and separate lead times. Forecasts now recommend reorders against a phantom unified stock pool that doesn't exist anywhere physical.

A subtler version: Shopify's default fulfilment routing deducts inventory **at the location with the lowest ID** when it doesn't know where the order will ship from. If you mirror that locally without realising, you end up with a virtual "phantom location" of negative stock.

**Why it happens:**
The Shopify Admin API exposes `InventoryLevel` per `(inventory_item, location)` pair. The natural-but-wrong move is to sum or pick the first one. Real multi-location forecasting needs per-location demand projections (a Nairobi CBD store and a Westlands store have different demand curves) and per-location reorder math (because shipments arrive at one location, not all).

**How to avoid:**
- Even with Beauty Square having one location today, model `Location` as a first-class entity in Prisma from day one: `Tenant 1—n Location`, `Location 1—n InventoryLevel`, `Product 1—n InventoryLevel`. Add a `Location.isPrimary Boolean` so single-location stores Just Work without UI changes.
- In phase 1, ingest the single location and label it `primary`. Forecast against `primary`. Surface a "Location: Nairobi Main" badge in the dashboard so the assumption is visible.
- Add a feature flag `MULTI_LOCATION_FORECAST` that's off by default. When a tenant has >1 location, the UI nudges them to set per-location demand splits before turning it on, rather than silently producing wrong numbers.
- Document in a code comment near `Product.currentStock`: "This is `on_hand at primary location`. For multi-location tenants, see `InventoryLevel`."

**Warning signs:**
- A new tenant onboards with 2+ locations and forecasts immediately look weird (everything urgent, or nothing urgent).
- Owner comments "the app thinks I have 80 of this but my warehouse has 0 and my retail store has 80 — they're hours apart."

**Phase to address:**
Shopify integration phase. Even if Beauty Square is single-location, the **schema** must accommodate multi-location or you'll have a migration emergency the day Anjay's second client lands.

---

### Pitfall 5: QuickBooks refresh token rotation — losing the "old" token mid-flight and locking out the tenant

**What goes wrong:**
A background forecast job runs. It refreshes the QuickBooks access token at minute 0:30 of the run. The job takes 45 minutes. At minute 0:55, a different code path (e.g. a manual "sync from QB" button the user just clicked) tries to refresh **using the now-stale refresh token from before the rotation**. That call fails with 400 `invalid_grant`. The tenant is now locked out and has to reconnect QuickBooks from scratch.

**Why it happens:**
Intuit rotates the refresh token **on every use**. The old refresh token is invalidated immediately. If two paths in your app try to refresh concurrently — or one path uses a refresh token it read from the DB before another path rotated it — exactly one of them wins and the loser is dead. The access token also expires after 60 minutes, and the refresh token itself expires after 100 days of non-use.

**How to avoid:**
1. **One refresh path, ever.** A single `getValidQuickBooksToken(tenantId)` helper that wraps token reads/refreshes in a per-tenant lock (Postgres advisory lock, or a `Tenant.qboTokenLockedUntil` timestamp). All QB API calls in the app go through it.
2. Refresh **proactively** at access-token-age 50 minutes, not reactively on 401. The 401-retry path is a fallback for clock skew, not the primary refresh trigger.
3. Persist `qboAccessToken`, `qboRefreshToken`, `qboAccessTokenExpiresAt`, `qboRefreshTokenExpiresAt` on `Tenant`. Update atomically inside the lock.
4. Treat `400 invalid_grant` as **terminal**: blank the tokens, flip `Tenant.qboConnectionState = "needs_reauth"`, surface a banner in the dashboard, and stop trying. Do NOT auto-retry — that just chews through more invalid grants and may rate-limit you off.
5. Run a daily cron that refreshes any token where `qboRefreshTokenExpiresAt < now() + 7 days` (or pings to extend it) so a tenant who logs in seasonally doesn't come back to a dead connection.

**Warning signs:**
- Sentry/log entries for `invalid_grant` clustered around forecast job runs (concurrency collision).
- A tenant who connected QuickBooks 3 months ago suddenly disconnected silently (refresh token aged out).
- Two forecast jobs running on the same tenant at the same time.

**Phase to address:**
QuickBooks integration phase. **Build the lock + state machine before the first real API call.** Do not ship a "we'll add locking later" version — the first concurrent refresh will brick a real tenant.

---

### Pitfall 6: QuickBooks `realmId` not bound to the session — wrong tenant's books read

**What goes wrong:**
You complete OAuth with QuickBooks. You store the `realmId` somewhere. Later, a request comes in from tenant A, but your code looks up "the QuickBooks connection" via `prisma.tenant.findFirst()` (the existing anti-pattern from CONCERNS.md §4.2) and pulls tenant B's `realmId` and tokens. You make a QB API call against tenant B's books and surface their COGS as tenant A's. This is a **multi-tenant data leak through an integration sidechannel**, and it's worse than the Prisma leak because the data left your system.

**Why it happens:**
One QuickBooks **user** (Intuit identity) can own multiple **companies** (each with its own `realmId`). And one of your tenants can theoretically connect multiple QB companies. The existing codebase doesn't even scope tenant resolution correctly internally — adding QB on top inherits and amplifies that bug.

**How to avoid:**
- Fix the underlying `findFirst()` tenant resolution **before** wiring QuickBooks. (See Pitfall 9.) Otherwise this pitfall is unavoidable.
- Model the QB connection as `tenantId ↔ realmId` (not `userId ↔ realmId`). Schema: `QuickBooksConnection { id, tenantId @unique, realmId, accessToken, refreshToken, ... }` with a unique index on `tenantId`.
- Every QB API call goes through `getQboClient(tenantId)` that resolves `realmId` from `tenantId`. There is no "global QB client."
- During OAuth callback, **verify the `realmId` returned by Intuit is the one already bound to this tenant** if a connection already exists. If it's different, force a reconfirm flow ("You're connecting a different QuickBooks company — is that intentional?").
- Log every QB API call with `{tenantId, realmId}` so cross-tenant access shows up immediately in logs.

**Warning signs:**
- A test tenant's COGS values look impossibly similar to Beauty Square's (or vice versa).
- The same `realmId` appearing under two tenants in the DB.
- Logs showing API calls to QB with a `realmId` that doesn't match the request's expected tenant.

**Phase to address:**
QuickBooks integration phase, **after** the multi-tenant retrofit (Pitfall 9). The phase ordering matters: tenant scoping must land first, or QB will silently leak.

---

### Pitfall 7: QuickBooks sandbox data doesn't match production data shapes — integration "works" in dev, blows up live

**What goes wrong:**
You build the QB connector against the Intuit sandbox. Inventory items have prices in USD because that's the sandbox default. You parse `Item.UnitPrice` as a number, multiply by a hardcoded `KES_PER_USD = 130`. You ship to production. Beauty Square's QuickBooks is configured with **KES as the home currency** and their items have prices like `350` meaning 350 KES. You now show them prices that are 130x too high (45,500 KES per lipstick). Owner mistrust kicks in immediately and the trust budget for the whole app is gone.

A second flavour: the sandbox auto-reseeds periodically, so item IDs and customer IDs in dev are not the same shape (or sometimes not the same character set) as production. Code that hardcodes ID patterns breaks.

**Why it happens:**
- The Intuit Developer Sandbox provisions a US-locale company by default. Multi-currency is off; home currency is USD.
- The QB API returns prices in the **home currency of the company**, not a normalised currency. You're expected to know the home currency from `CompanyInfo.Country` + `Preferences.CurrencyPrefs.HomeCurrency`.
- Sandbox data resets break ID stability.

**How to avoid:**
1. As the **first** QB API call after OAuth, fetch `CompanyInfo` and persist `Tenant.qboHomeCurrency` and `Tenant.qboCountry`. Reject onboarding if `qboHomeCurrency != Tenant.currency` (or surface a "currency mismatch — please pick which one wins" flow).
2. Never hardcode an FX rate. Treat all monetary values as `{value, currency}` pairs end-to-end. The forecasting math doesn't actually need FX (it's all in units), but the cost / revenue / margin numbers in the dashboard do.
3. Have Anjay create a **Kenya-configured** test company in the sandbox (KES home currency, Kenya address) and run all dev work against that, not the default US sandbox.
4. Don't ship with `realmId` hardcoded anywhere. Every reference goes through the per-tenant resolver.
5. Snapshot-test the parsing of one real `Item` payload from Beauty Square's QB (anonymised) — that's the only real defence against shape drift.

**Warning signs:**
- Dashboard COGS values that look 100x off (currency mistake).
- "Why is everything in dollars?" feedback (you didn't pick up home currency).
- Integration tests passing in sandbox, all breaking in prod.

**Phase to address:**
QuickBooks integration phase. The "fetch CompanyInfo + persist currency first" step should be acceptance criteria for the phase.

---

### Pitfall 8: Python sidecar JSON contract drift — Python returns slightly different shape, forecast page silently breaks

**What goes wrong:**
You stand up the Python FastAPI service. It returns `{layer1_forecast_30d: 12.5, layer1_confidence: 0.82, ...}` (snake_case Python style). The TS app expects `layer1Forecast30d, layer1Confidence` (camelCase per the existing `ForecastResult` type at `simulate-layers.ts:36-49`). Your TS code accesses `result.layer1Forecast30d`, gets `undefined`, the dashboard shows "NaN" or "0" everywhere, and you spend an afternoon thinking the model is broken when it's a key-naming bug.

A subtler version: Python returns numbers as floats; TS code assumes integers in some places (`Math.ceil(recommendedQty)` is fine, but `Order.quantity` is an `Int` in Prisma and `prisma.order.create({data: {quantity: 12.7}})` will throw at runtime, not compile time). Or: Python returns `null` for confidence when there's not enough history; TS assumes `number`.

**How to avoid:**
1. **Define the contract once, in one file, in a way both languages can read.** Options: JSON Schema in `contracts/forecast.schema.json`, generate TS types via `json-schema-to-typescript` and Python types via `datamodel-code-generator`. Both sides validate at the boundary.
2. The contract MUST use the exact field names already in `lib/forecast/simulate-layers.ts:36-49` (`layer1Forecast30d`, `layer1Confidence`, `layer2Adjustment`, `finalForecast30d`, `safetyStock`, `reorderPoint`, `confidence`, `reasoning`, `urgency`, `signals[]`). The README claim "swap is a one-file change" is only true if Python matches this exactly.
3. The TS HTTP client wrapping the Python service validates the response with Zod against the same contract. Reject and log on mismatch — don't silently propagate `undefined`.
4. Version the contract: include `contract_version: "1.0.0"` in every Python response. TS rejects unknown major versions. This lets you evolve the contract without breaking older deploys.
5. Have **one** TS adapter (`lib/forecast/sidecar-client.ts`) that wraps the fetch. Existing callers of `simulateLayeredForecast()` call this. The "one-file swap" then becomes "replace one import."

**Warning signs:**
- Dashboard rendering `NaN`, `undefined`, or `0` for forecast values where Math.random previously gave realistic numbers.
- Prisma errors at write time about wrong type (`expected Int, got Float`).
- Zod validation errors at the sidecar boundary in logs.

**Phase to address:**
Python sidecar phase. Land the contract file + Zod validator **before** the first end-to-end call.

---

### Pitfall 9: Multi-tenant retrofit — `findFirst()` pattern carried into new code, leaking data forever

**What goes wrong:**
CONCERNS.md §4.2 already documents that 12 routes call `prisma.tenant.findFirst()`. The retrofit phase replaces these with session-bound tenant resolution. But two months later, a new feature branch adds another API route, the developer copy-pastes the pattern from a nearby route (the one they didn't update), and the bug regresses. Or: the new Shopify webhook handler resolves tenant by webhook `shop_domain` via `findFirst` instead of binding to the authenticated session, and an attacker can spoof the domain.

A subtler version: the retrofit gets the API layer right but forgets the **scripts**. `scripts/run-forecasts.ts`, `scripts/seed-from-beautysquare.ts`, and the future Python-sidecar caller all bypass auth. A cron that runs `run-forecasts.ts` "for all tenants" without an explicit per-tenant scope will silently process them in a global mutation soup.

**Why it happens:**
- Retrofits leave landmines. Half the codebase uses pattern A (correct), half still uses pattern B (the old `findFirst()`). New code copies whatever was nearby.
- Scripts and crons live outside the auth boundary by definition. They need an explicit `--tenant <id>` argument and explicit scoping, or they're an end-run around all the work you did.
- "It works in dev with one tenant" stays true through the entire retrofit — the bug only manifests when a second tenant exists.

**How to avoid:**
1. **Single chokepoint.** A `lib/auth/getTenantContext()` function that returns `{tenantId, userId, role}` from the request, throwing if unauthenticated. Every API route's first line is `const ctx = await getTenantContext();`. There is no other way to get a tenantId in API code.
2. **Lint rule or `prisma.$extends`.** Either a Prisma client extension that injects `where: {tenantId}` on every query, or a custom ESLint rule that bans bare `prisma.tenant.findFirst()` and bare `prisma.*.findMany()` without a `tenantId` in `where`. Without enforcement, regression is inevitable.
3. **Onboard a second tenant in dev.** Before declaring the retrofit done, seed a `Tenant B` and verify every dashboard page only shows Tenant A's data when logged in as A. This is the only honest acceptance test.
4. **Scripts take `--tenant <id>` and fail if missing.** Loops over all tenants are an opt-in `--all-tenants` flag with a confirmation prompt.
5. **PR template checkbox:** "Have you added `getTenantContext()` to every new API route?"

**Warning signs:**
- Any new API route that doesn't start with `const ctx = await getTenantContext()`.
- Any Prisma call in API code without `tenantId` in `where`.
- A `findFirst` on `Tenant` anywhere outside the auth helper.
- The dashboard "just working" for tenant A in dev — when there's only one tenant in the DB, every bug looks fine.

**Phase to address:**
Multi-tenant retrofit phase, **before** Shopify or QuickBooks integrations. Both integrations bind external accounts to tenants — if tenant resolution is broken, the integrations will leak external data across tenants (see Pitfall 6).

---

### Pitfall 10: SARIMA on too-short or too-sparse history — model fits noise and "confidently" predicts garbage

**What goes wrong:**
The Python sidecar fits a SARIMA(p,d,q)(P,D,Q)s model with seasonal period s=7 (weekly) or s=365 (yearly). For a SKU with 90 days of history, statsmodels happily fits it. The model converges. It returns a forecast with a tight confidence interval. The forecast is wrong by 5x because there isn't enough data to estimate the seasonal terms, and the optimiser found a local minimum that fits the 90 days perfectly and projects nonsense forward.

A specific Beauty Square risk: any SKU added in the last <365 days has no full-cycle history. The synth-sales-history script generates 365 days because the dev environment needs it; real data will have many SKUs with much less.

**Why it happens:**
- SARIMA needs roughly **2-3 full seasonal cycles** to estimate parameters reliably. For weekly seasonality that's ~14-21 weeks. For yearly seasonality that's ~2-3 years. Most SMB retail SKUs do not have 3 years of clean history.
- Statsmodels doesn't refuse to fit on short data — it warns or silently proceeds. The output looks identical to a well-fit model.
- Confidence intervals from a SARIMA fit are conditional on the model being right. If the model is wrong (under-data), the intervals are meaningless but still presented as numbers.

**How to avoid:**
1. **Per-SKU model selection by history length.** In the Python sidecar:
   - `<30 days`: no SARIMA. Fall back to weighted moving average + category-level seasonal index. Mark `confidence=low` and `reasoning="insufficient history (n=X days), using category baseline"`.
   - `30-180 days`: SARIMA with weekly seasonality only (s=7). No yearly term.
   - `180-730 days`: SARIMA with weekly + monthly. Still no yearly.
   - `>730 days`: full SARIMA(p,d,q)(P,D,Q)7 + holiday/payday exogenous regressors via SARIMAX.
2. **Always evaluate on a holdout.** Hold out the last 30 days, fit on the rest, score. If MAPE/RMSE on the holdout is worse than naive-30-day-average, fall back to naive. Surface this in the `reasoning` field: "SARIMA underperformed naive baseline on holdout, using naive."
3. **Cap confidence by data length.** `confidence = min(modelConfidence, dataLengthConfidence(history_days))`. A 30-day-history SKU caps at e.g. 0.4 regardless of model fit.

**Warning signs:**
- A SKU with <60 days of history showing `confidence: 0.9`.
- Forecast values for new SKUs that swing wildly run-over-run (telltale of unstable fit).
- The dashboard's "Urgent" tab dominated by brand-new SKUs with no history (you're forecasting on noise and the noise is screaming).

**Phase to address:**
Python sidecar / forecast accuracy phase. The per-history-length routing logic is a hard prerequisite — without it, the moment a real shop with realistic SKU age distribution connects, half the forecasts are noise.

---

### Pitfall 11: Intermittent demand (slow movers) + MAPE — the metric explodes and you chase the wrong SKUs

**What goes wrong:**
Beauty Square has 1,020 SKUs. The bottom-tail ~30% sell 0-2 units a month (slow movers, special-order items, niche fragrances). You evaluate forecast quality with MAPE (Mean Absolute Percentage Error). For a SKU with actual = 0, MAPE divides by zero → infinity. For actual = 1 with prediction 3, MAPE = 200%. Your overall metric is dominated by tail SKUs, makes the model look terrible, and you spend a sprint trying to "fix" the model when the real problem is the metric.

A second flavour: the model itself fails on intermittent series. SARIMA over-smooths bursts (a SKU that sells 0,0,0,0,5,0,0 gets predicted at ~0.7 forever). Owners see the forecast saying "0" for an item that sells in bursts and lose trust.

**Why it happens:**
- MAPE has a singularity at actual=0 and explodes for small actuals.
- Classic ARIMA-family models assume stationary or smoothly-varying series. Intermittent series are neither.
- Croston's method, SBA, TSB, and Holt-Winters with damping handle intermittent demand; SARIMA does not.

**How to avoid:**
1. **Classify SKUs by demand pattern before forecasting.** A simple ADI/CV² classification:
   - **ADI** = average days between non-zero demand
   - **CV²** = squared coefficient of variation of non-zero demand
   - Smooth (ADI<1.32, CV²<0.49): SARIMA/XGBoost
   - Intermittent (ADI≥1.32, CV²<0.49): Croston / SBA
   - Erratic (ADI<1.32, CV²≥0.49): XGBoost with heavy regularisation
   - Lumpy (ADI≥1.32, CV²≥0.49): Croston-TSB; or roll up to weekly/monthly and forecast that
2. **Use the right metric per class.** For intermittent SKUs, report **MAE** (mean absolute error) and **RMSSE** (root mean squared scaled error, the M5 competition metric) instead of MAPE. Surface the metric per ABC tier in admin so it's obvious when a model is being judged unfairly.
3. **For lumpy/intermittent SKUs, forecast at the weekly or monthly bucket**, then divide back to daily for ordering. The bucket aggregation absorbs the bursts.
4. **Always show the historical chart next to the forecast.** Owners trust forecasts that visibly track the past — and they correctly distrust "0 units" for a SKU that visibly sells in bursts.

**Warning signs:**
- Overall MAPE >100% (almost certainly a tail-skewed metric).
- Confidence and accuracy reports dominated by C-tier SKUs.
- Owner feedback "the app says I'll sell 0 of X but I always sell some" — that's an intermittent-demand model mismatch.

**Phase to address:**
Python sidecar phase. The ADI/CV² classifier is a few lines of code but a huge accuracy lever. Bake it in from the start.

---

### Pitfall 12: XGBoost residual layer overfits on short per-SKU history

**What goes wrong:**
You train an XGBoost model per SKU on the SARIMA residuals, with features like day-of-week, payday, holiday-this-week, promo-active. With 90 days of history that's 90 rows per SKU. XGBoost (with default depth 6, 100 trees) has plenty of capacity to memorise 90 rows. Train error: 0. Holdout error: terrible. The "Layer 2 adjustment" injects noise rather than signal, and Layer 1 + Layer 2 is worse than Layer 1 alone.

**Why it happens:**
Gradient-boosted trees are voracious learners. With small N, they fit noise. The classic fix (more data) isn't available — you can't go back in time. The right fix is to share strength across SKUs.

**How to avoid:**
1. **Single global model, not per-SKU.** Train one XGBoost on all SKUs' residuals, with SKU-level features (category, ABC tier, price tier, supplier, history-length-bucket) as inputs. Each SKU benefits from the patterns learned across the whole catalog. This is standard M5-competition wisdom.
2. **Regularise aggressively.** `max_depth=4`, `min_child_weight=10`, `reg_alpha=0.1`, `reg_lambda=1.0`, `subsample=0.8`, `colsample_bytree=0.8`. Tune by holdout-MAE on aggregated forecast, not in-sample loss.
3. **Time-series cross-validation only — never random CV.** Random CV leaks future into training. Use rolling-origin CV with at least 4 folds, each training-set length matching what you'd actually have in production at that point in time.
4. **Cap residual adjustment magnitude.** If XGBoost says "multiply Layer 1 by 3.7," clamp at e.g. 1.5x. A well-calibrated Layer 2 makes small corrections; large corrections are almost always overfitting.
5. **Track Layer-2 lift in production.** Compare actuals to (Layer 1 only) vs (Layer 1 + Layer 2). If Layer 2 doesn't beat Layer 1 on a 30-day rolling window, turn it off and surface "Layer 2 disabled — Layer 1 currently more accurate" in the dashboard.

**Warning signs:**
- Train MAE near 0, holdout MAE near naive baseline (textbook overfit).
- Layer-2 adjustments routinely >50% in either direction.
- A/B comparison of Layer 1 vs Layer 1+2 favouring Layer 1.

**Phase to address:**
Python sidecar phase. Train the global model in the first ML iteration; per-SKU XGBoost is a tempting trap to avoid.

---

### Pitfall 13: Cold-start latency on Python sidecar — first request after idle takes 30s, forecast page times out

**What goes wrong:**
The Python sidecar runs on Railway (or similar) on a free / minimal tier that idles after inactivity. The first request after a quiet period spins up the container, loads statsmodels + xgboost + the cached models from disk (~5-15s on a cold container), and finally returns. Meanwhile the Next.js `app/api/forecast/run/route.ts` has `maxDuration = 120` but Vercel's edge may timeout the user-facing HTTP request well before that. The dashboard shows an error. The user retries; the second request is fast. The user reports "it's flaky."

**Why it happens:**
- Python imports of statsmodels + xgboost + pandas + numpy add 3-8s of cold boot. Loading pickled models from disk adds more.
- Free-tier hosts (Railway hobby, Fly.io shared) aggressively idle containers.
- Vercel's serverless function timeout for hobby tier is 10s for App Router edge runtime, 60s for Node runtime, 300s for Vercel Pro. None of these covers a 30s cold start gracefully if the call is synchronous.

**How to avoid:**
1. **Async, not sync.** The user clicks "Run forecast." The Next.js route POSTs a job to the sidecar, returns `{jobId}`, and the dashboard polls (or uses SSE/WebSocket) for completion. Cold starts become invisible because the user sees a progress bar, not a hang.
2. **Warm the sidecar.** A Vercel cron pings `GET /healthz` on the sidecar every 5 minutes. Cheap and eliminates idle-down for most hosts.
3. **Lazy-import inside endpoint, cache model in module scope.** First request still slow, subsequent ones fast. Combined with warmup, almost-never-cold.
4. **Pre-load models at container boot, not at first request.** The FastAPI app on startup (`@app.on_event("startup")` or lifespan handler) loads all pickled models into a module-level dict.
5. **Sidecar runs on always-on tier ($5-7/mo on Railway).** This is the cheapest fix and should be the default. Track it as a fixed cost.

**Warning signs:**
- Dashboard "forecast run" timing out intermittently, succeeding on retry.
- Sidecar logs showing container start every few hours.
- Cold-start P99 latency much worse than warm P99.

**Phase to address:**
Python sidecar phase. Decide sync-vs-async at design time — retrofitting async is a real refactor.

---

### Pitfall 14: Model drift goes unnoticed because there's no prediction history

**What goes wrong:**
CONCERNS.md §6.2 already flags that `app/api/forecast/run/route.ts:70` does `prisma.prediction.deleteMany()` before every run. So every forecast obliterates the previous one. You ship the real Python sidecar. The model is great for two weeks, then a competitor opens up the street, demand pattern shifts, and the model is now systematically over-forecasting. You don't notice for a month because there's no prediction history to backtest against actuals.

**Why it happens:**
- The mock pattern deletes-before-insert because there's nothing to compare to. Real production needs the opposite: append-only history.
- "Model drift" requires comparing predicted-vs-actual over time. No history = no detection.

**How to avoid:**
1. **Stop deleting predictions.** Refactor the forecast-run path to upsert with a `forecastRunId` column. Each run is a separate slice; old slices stay. The dashboard reads "the latest run" via `orderBy: {createdAt: desc}, take: 1` per product.
2. **Add a `forecast_actual` join.** When sales come in for the period a forecast covered, compute and store the error. This is the source data for drift detection.
3. **Weekly drift report.** A cron computes 30-day rolling MAE per ABC tier per tenant. Alert if MAE doubles month-over-month, or if signed bias (consistent over/under) exceeds 20%.
4. **Surface "model accuracy last 30 days" in the dashboard.** Owners trust models more when they can see "we predicted within 12% on A-tier last month."
5. **Plan for retraining cadence.** Weekly retrain on rolling 12-month window is standard for SMB retail. Monthly is the minimum.

**Warning signs:**
- No `forecastRunId` or equivalent column on `Prediction`.
- The DB has exactly one prediction row per product at any time.
- No "accuracy" or "drift" widget anywhere in the UI.
- Owner complaints clustering around a time window (drift event, undetected).

**Phase to address:**
Python sidecar phase, OR a separate "forecast observability" phase that lands right after the sidecar. Don't ship the sidecar without prediction history — it's a one-way door.

---

### Pitfall 15: Forecast cache shared across tenants — Tenant A sees Tenant B's numbers

**What goes wrong:**
You add caching to the forecast page because the dashboard is slow. You use Next.js `unstable_cache` or React's `cache()` keyed on `productId`. Tenant A and Tenant B both have a product with the same SKU code "RT-LIP-001" because you matched by SKU in the cache key. Tenant A loads the page first; their forecast is cached. Tenant B loads the same SKU; the cache hits and returns Tenant A's forecast.

A subtler version: `revalidateTag('forecast')` invalidates everyone's cache when one tenant approves an order. Acceptable for correctness but a thundering-herd at scale.

**Why it happens:**
- Cache keys need to encode `tenantId` explicitly. Forget once and you have a cross-tenant leak.
- Server-side caching layers (Next.js, Redis, in-memory LRU) all share by default. Multi-tenant safety requires per-tenant keying everywhere.

**How to avoid:**
1. **Every cache key includes `tenantId` as the first component.** A helper `tenantScopedCacheKey(tenantId, ...rest)` enforces this.
2. **Code-review checklist:** "Does every `cache()`, `unstable_cache()`, Redis SET, or LRU key include `tenantId`?"
3. **Test with two tenants.** Hit a forecast page as Tenant A, then as Tenant B (with overlapping SKU codes), and verify the response differs. This is a 5-line integration test.
4. **Cache tags also tenant-scoped:** `revalidateTag(\`forecast:\${tenantId}\`)` not `revalidateTag('forecast')`.

**Warning signs:**
- Cache key strings in the codebase without `tenantId` in them.
- Two tenants reporting "identical numbers" they shouldn't have.
- A global `revalidateTag('foo')` call.

**Phase to address:**
Multi-tenant retrofit phase + any later phase that adds caching. If caching is added in a later phase, the retrofit phase should leave behind a `lib/cache/tenant-cache.ts` helper as the only sanctioned way to cache.

---

### Pitfall 16: Kenya connectivity — forecast app assumes "always online," breaks after a 2-day outage

**What goes wrong:**
The Shopify or QuickBooks sync fails for 2 days (KPLC power cut at the shop, or the upstream API has a Kenya-specific routing issue, or a Safaricom fibre cut). On day 3 the owner opens the dashboard for the Monday reorder. The app refuses to forecast: "stale data, last sync 2026-03-12." Owner can't order. They go back to Excel and don't trust the app again.

A subtler version: the sync resumes, but it pulls a 2-day backlog of orders all at once. The forecast suddenly thinks Monday-Tuesday demand was 2x normal (it's actually two days bunched into one). Reorder math overshoots.

**Why it happens:**
- Naive "must be fresh to forecast" logic treats connectivity as a precondition. In Kenya it's a probabilistic guest.
- Bulk backfill of historical orders triggers anomalous "spike" days that the model treats as real.

**How to avoid:**
1. **Forecast from local DB, always.** Sync is an input pipeline, not a precondition. The forecast page works even if the last sync was 7 days ago, with a clearly visible "Last synced: 3 days ago — sync to refresh" banner.
2. **Backdate orders to their real date.** When Shopify returns orders with `created_at: "2026-03-10"` after a 2-day outage, the `SalesHistory.date` is the real date, not today. This is already correct in the schema but easy to break when bulk-importing.
3. **Smooth backfill spikes.** When the sync detects >1 day of catch-up, log a `data_quality_flag` on the affected dates. The Python sidecar can ignore flagged dates from training, or weight them down.
4. **Cache the last successful sync's data shape.** If the sync fails, the dashboard shows yesterday's forecast with a "stale" pill, not an error page.
5. **PWA-style "good for offline" UX.** Service worker caches the dashboard shell. The owner can at least see the last forecast even on flaky 3G.

**Warning signs:**
- Dashboard errors after a sync outage instead of degraded but functional UI.
- A "spike day" appearing in the chart on the date of the first post-outage sync.
- "Last synced" labels missing from the UI.

**Phase to address:**
Whichever phase wires real Shopify/QB ingest. Outage resilience is part of the integration's done-criteria, not a separate phase.

---

### Pitfall 17: KES vs USD price drift — supplier costs in USD, FX moves, margin math goes wrong

**What goes wrong:**
A supplier (Guangzhou Beauty Imports — already seeded as USD in the codebase) prices in USD. Beauty Square pays in KES at point of import. You store `Supplier.currency = "USD"` and `Product.cost` in... what currency? Today it's KES (per the synth script). When the supplier raises USD prices or KES depreciates, the stored cost is stale. Margin reports lie. Reorder recommendations don't reflect true landed cost.

**Why it happens:**
- Mixing currencies without a normalisation strategy is endemic in SMB systems.
- FX rates aren't a fixed constant — KES/USD moved 110→130 in a year (recent past). Stored cost without FX context is wrong by 18%.

**How to avoid:**
1. **Store cost in supplier currency + a snapshot FX rate at purchase time.** Schema: `Product.costAmount: Decimal, Product.costCurrency: String, Product.costFxToKesAtPurchase: Decimal, Product.costSnapshotAt: DateTime`. Then "current cost in KES" is a computed value, not a stored one.
2. **Distinguish "purchase cost" from "current replacement cost."** For reorder math, replacement cost (today's FX × today's supplier price) is what matters. For accounting, weighted-average historical cost.
3. **Fetch FX rates daily** from a free source (e.g. Open Exchange Rates free tier, or Central Bank of Kenya daily rate). Persist `FxRate { date, base, target, rate }` so historical reports are reproducible.
4. **For v1, defer multi-currency complexity if Beauty Square only uses KES suppliers.** But the schema should allow it from day one — adding currency columns later is a painful migration.

**Warning signs:**
- Margin reports that swing wildly month-over-month without sales changing.
- A supplier-currency column that's always "KES" because nobody set it correctly.
- Owner asking "why does the app think this lipstick costs 200 shillings? My supplier raised the price."

**Phase to address:**
QuickBooks integration phase (since QB is where cost-of-goods lives) and/or the schema migration phase that adds supplier-currency awareness.

---

### Pitfall 18: M-Pesa payday clustering modeled as a static rule — misses real shifts

**What goes wrong:**
The existing `kenya-calendar.ts::isPaydayWeek()` hardcodes payday as days 25-end + 13-16. Reality is messier: many Kenya employers pay on the **last working Friday** of the month, which shifts. Public sector pays around the 25th. Casual workers get paid weekly on Fridays. The synth data was generated to match the hardcoded rule, so the SARIMA mock looks great — when real data flows, the model under-weights the actual payday peak (which is a calendar-aware Friday, not a calendar day-of-month).

**Why it happens:**
The hardcoded rule was a reasonable approximation for synthetic data. It's not how real wages clear into the shop's till.

**How to avoid:**
1. **Detect payday peaks from the data, don't assume them.** In the Python sidecar, compute a "day-of-month effect" and "last-Friday-of-month effect" empirically from each tenant's history. Use whichever has stronger signal.
2. **Allow per-tenant overrides.** A "Local context" page where Mary can mark "we see a spike around the 28th and on the last Friday" — turn it into XGBoost features.
3. **Don't ship the hardcoded calendar as the production source of truth.** It's a starter for tenants with <90 days of history (cold start). Replace with learned signals as soon as data permits.
4. **Surface the assumed payday pattern in the UI.** "We're treating these dates as paydays based on your last 6 months of sales: [list]" — owner can correct.

**Warning signs:**
- Forecast peaks falling 1-2 days off the actual sales peak.
- Hardcoded payday logic still firing for tenants with 12+ months of history (should have been replaced by learned signal).

**Phase to address:**
Python sidecar phase. Learning calendar effects from data is a feature of the real model, not a separate phase.

---

### Pitfall 19: Moveable holidays (Eid) — fixed-date holiday table goes stale

**What goes wrong:**
`kenya-calendar.ts` hardcodes Christmas, Madaraka, Mashujaa, Jamhuri, Valentine's. None of those move. But Eid al-Fitr (March 20, 2026 — moves yearly) and Eid al-Adha (also moves) are major shopping events in Eastleigh and Muslim-majority areas. Hardcoding them in the calendar means in 2027 the dates are wrong and the model misses the spike entirely.

**Why it happens:**
- Islamic holidays follow the lunar calendar; their Gregorian date shifts ~11 days earlier each year and the exact day depends on moon-sighting (declared by Kenyan government typically 1-2 days before).
- Hardcoded constants in source code are eternal until someone updates them.

**How to avoid:**
1. **Use a moving-holiday library.** `python-holidays` covers Kenya including Idd-ul-Fitr and Idd-ul-Adha with proper lunar calculations. In the TS calendar, mirror via a generated table or fetch yearly.
2. **For 2026, the announced dates are: Idd-ul-Fitr Fri 2026-03-20, Idd-ul-Adha later in the year (TBD by moon-sighting).** Use these for the current year; never hardcode for future years.
3. **Surface to the owner.** A monthly-context page that lists upcoming holidays with editable "expected impact" — owner can mark "Idd boosts fragrance 2x this year" based on local knowledge.
4. **In the sidecar, treat holidays as features with category-specific lift coefficients learned per tenant.** The fixed 2.5x Christmas / 3.0x V-Day boosts in `kenya-calendar.ts` are global guesses; real lift is tenant-specific.

**Warning signs:**
- 2027 forecast missing the Eid spike entirely.
- Hardcoded date constants for any holiday that isn't fixed-Gregorian.

**Phase to address:**
Python sidecar phase. The calendar feed becomes an input to the model.

---

### Pitfall 20: Supplier lead time variance not modelled — King's formula safety stock is too low

**What goes wrong:**
The existing King's formula safety stock calculation needs `leadTimeStdDev`. For Guangzhou Beauty Imports the seeded variance is some constant. Reality: shipments from China to Mombasa take 21-35 days normally, but 60-80 days during Chinese New Year (factories closed 3-4 weeks pre-holiday + clogged ports + reduced shipping capacity for ~6 weeks total). If safety stock is computed with the "normal" stddev, you stockout every January-February.

**Why it happens:**
- Lead time variability is hard to capture statically. The standard deviation of a bimodal distribution (normal + CNY) is misleading; safety stock formulas assume roughly-normal lead times.
- Suppliers don't volunteer "we'll be 3 weeks late in February." Customers learn from being burned.

**How to avoid:**
1. **Compute lead time stddev from `Order.expectedArrivalDate` vs `Order.receivedAt` history** (both fields CONCERNS.md §3.5 flags as missing — add them). Once you have actuals, fit a distribution per supplier, optionally per-season.
2. **Seasonal lead-time multipliers per supplier.** A supplier in China gets a "CNY multiplier" applied for orders placed in October-February. A supplier in Europe gets a "summer holiday" multiplier for July-August. Owner-editable per supplier.
3. **Pre-CNY reorder bump.** A heuristic: for any China-sourced SKU, increase the reorder quantity 6-8 weeks before CNY to cover the extended lead time. Surface as "CNY buffer order — shipping shuts down" in the reasoning.
4. **Until you have actuals, use community defaults** (China: mean 28d, stddev 10d; CNY months: mean 50d, stddev 20d; Dubai: mean 14d, stddev 5d; Local KE: mean 5d, stddev 3d). Document these in `lib/forecast/supplier-defaults.ts`.

**Warning signs:**
- Repeated stockouts of China-sourced SKUs in January-February.
- Owners reporting "the app told me to order on time but the supplier was late and I ran out."
- Safety stock recommendations that don't change with supplier (one-size-fits-all).

**Phase to address:**
Reorder math phase (likely same as the `onOrder` field add). Lead-time-stddev plumbing is part of "make reorder math actually correct."

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip the schema change for `onOrder` and just "remember not to double-order" | Saves a migration | First approved order silently re-recommends itself; trust dies | **Never** |
| Hardcode the QuickBooks home currency as KES because Beauty Square is KES | Saves a CompanyInfo API call | Tenant 2 has USD books, COGS is silently wrong 18x | **Never** — even for a single-client v1 |
| Ship Shopify integration with read-only scopes, plan to add write_draft_orders later | Slightly simpler initial OAuth | Existing tenants must reinstall to add write access; UX scar | Only if write actions are explicitly out-of-scope for v1; then document the constraint |
| Run forecast on `findFirst` tenant until "we have multiple tenants" | Looks like it works | Second onboarding silently overwrites first tenant's connection (CONCERNS.md §4.2 already documents this); QB realmId leaks across tenants | **Never** for any phase that adds external integrations |
| Skip prediction history (keep the `deleteMany` pattern) | Less storage | Cannot detect model drift; cannot backtest; cannot answer "why did this number change?" | **Never** — append-only is a one-way door |
| One global XGBoost model for everyone vs per-tenant | Less complexity, more data per train | Tenant-specific patterns get washed out | Acceptable for v1 (single tenant); revisit when 5+ tenants exist |
| Sync mode for Python sidecar instead of async jobs | Simpler client code | Cold starts surface as timeouts; flaky UX | Acceptable if sidecar runs always-on and stays warm; not acceptable for free-tier hosting |
| Hardcode Kenya holiday table for current year | Quick win | Goes stale yearly; misses Eid shifts | Acceptable as a fallback for cold-start tenants; not as the production source of truth |
| Defer multi-location schema until a multi-location tenant onboards | Less Prisma surface area | Painful migration with live data; second client lands on Monday | **Never** — schema should support it from day one, even if UI hides it |
| Store Shopify access token as plaintext (matches current schema) | No KMS setup | Repo compromise = OAuth keys to every connected store; GDPR/compliance landmine | Acceptable only inside a single-day prototype window; encrypt before first real OAuth install |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Shopify OAuth | Requesting scopes incrementally as features land | Plan all scopes upfront from PROJECT.md Active list; install with full set; store `shopifyScopes` for drift detection |
| Shopify webhooks | `await request.json()` before HMAC verify | `await request.text()` first; verify base64 HMAC with `timingSafeEqual`; only then `JSON.parse(raw)` |
| Shopify inventory | Using `available` as `currentStock` | Use `on_hand` for `currentStock`; track `committed` separately; add `onOrder` for in-flight POs |
| Shopify locations | Summing inventory across locations | Per-location InventoryLevel; designate `isPrimary`; forecast per-location for multi-location tenants |
| Shopify rate limits | Reactive backoff on 429 | Proactive: read `X-Shopify-Shop-Api-Call-Limit` (REST) or `extensions.cost` (GraphQL); pace requests below 80% bucket; prefer GraphQL bulk for catalog sync |
| Shopify dev store vs prod | Testing only against dev store | Dev stores have no real order volume / rate-limit pressure; test pagination + rate-limit handling with synthetic load |
| QuickBooks OAuth | Reactive token refresh on 401 | Proactive refresh at 50min; per-tenant lock around refresh; treat `invalid_grant` as terminal → mark `needs_reauth` |
| QuickBooks realmId | One-realmId-per-user assumption | Bind `realmId` to `tenantId` (unique); verify realmId match on each OAuth callback; log `{tenantId, realmId}` on every API call |
| QuickBooks sandbox | Building against US sandbox, shipping to KES production | Create Kenya-configured sandbox company; fetch `CompanyInfo` first; never hardcode currency |
| QuickBooks multi-currency | Assuming `Item.UnitPrice` is in your currency | Read home currency from CompanyInfo; treat all amounts as `{value, currency}` pairs; reconcile FX at read time, not at write |
| QuickBooks long jobs | Background sync runs >60 minutes, access token dies mid-flight | Refresh proactively inside the loop; persist progress so the next attempt resumes |
| Python sidecar | snake_case Python ↔ camelCase TS, silent `undefined` | Shared JSON Schema contract; Zod validation on TS side; `contract_version` field; reject unknown versions |
| Python sidecar deploy | Free-tier host, idle-down, 30s cold start | Always-on tier ($5-7/mo); preload models on startup; cron warmup; OR async job pattern with polling |
| FX rates | Hardcoded constant | Daily fetch from CBK or free FX API; persist historical rates per day for reproducible reports |
| Kenya holidays | Hardcoded date constants for moveable holidays | `python-holidays` library or yearly-refreshed table; surface to owner for confirmation |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-product Prisma `create` in a loop (already present at `forecast/run/route.ts:73-134`) | Forecast run takes 30s+ on prod Postgres | Batch with `createMany` or transactional batch | ~500+ products on Postgres over the network |
| All-predictions, all-365d-history read on dashboard load (`forecast/route.ts:17-37`) | Dashboard slow + memory pressure | Paginate; aggregate at DB; cache per-tenant | ~10k products / 1M sales rows |
| Synchronous Python sidecar call from request handler | User-facing timeouts on cold starts | Async job + polling; or always-on sidecar with warmup | First request after idle, every time |
| Forecast cache without `tenantId` in key | Cross-tenant data leak in cache | `tenantScopedCacheKey()` helper | The moment a second tenant is active |
| Webhook handler doing heavy work inline | Shopify retries → duplicate processing | Verify, enqueue, return 200 in <2s; process async | Any sustained webhook volume (>1/s) |
| QuickBooks full-sync on every forecast run | API rate-limit exhaustion (500/min/realmId); slow | Incremental sync (`ModifiedSince`); cache locally | First tenant with >2k items |
| Bulk re-seed on a real tenant (`POST /api/seed`) | 5-minute DB lock + destroys real history | Hard-block this route on tenants with `isProduction = true` | Day one of real data flow |
| Per-SKU model fit at request time | First "Run forecast" takes minutes for a large catalog | Pre-trained models cached on disk in sidecar; only inference is request-time | 200+ SKU catalog |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Plaintext OAuth tokens in DB (current schema: `Tenant.shopifyAccessToken: String?`) | Repo or DB leak = full read/write access to every connected Shopify and QuickBooks account | Encrypt at rest with a tenant-derived key OR a single app-level KMS key; never log; never return from API |
| `findFirst()` tenant resolution (existing pattern, 12 routes) | Cross-tenant data leak; second onboarding overwrites first | Replace with `getTenantContext()` from authenticated session; lint rule; Prisma extension |
| Public seed endpoint (`POST /api/seed`, no auth, `maxDuration = 300`) | Anyone can wipe production DB; 5-min compute DoS | Admin-only; gated by env flag; refuses on tenants flagged `isProduction` |
| No webhook HMAC verification | Anyone with the webhook URL can post fake orders/inventory changes | Verify `X-Shopify-Hmac-Sha256` (Shopify) / signature (QB) on every webhook before any DB mutation |
| Trusting `shop_domain` from webhook payload to resolve tenant | Spoofed webhook → cross-tenant write | Resolve tenant from authenticated registration of the webhook subscription, not from payload claim |
| Logging full OAuth tokens during debugging | Token exfiltration via log aggregator | Redact `*Token` fields in a log middleware; CI lint for `console.log(*token*)` |
| QuickBooks `realmId` mixed across tenants | Wrong tenant's financial data exposed | `QuickBooksConnection.tenantId @unique`; resolver checks; logged every call |
| Shopify scope creep | Over-permissioned access if compromised | Request minimum viable scope set; review on each phase that adds a Shopify capability |
| No CSRF / origin check on POST routes after auth lands | Token-authed user tricked into mutating data | Next.js's built-in CSRF for Server Actions; manual origin check for `/api/*` |
| Allowing tenant A admin to change Tenant.id or migrate connections | Privilege escalation across tenants | Tenant-level role model; admin actions scoped to own tenant; cross-tenant admin is a separate "platform admin" role |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing a single number ("reorder 47") without confidence or reasoning | Owner doesn't trust it, falls back to gut | Show forecast + range + top 3 signals + "what would change this" — already partly there in `ForecastResult.reasoning`/`signals[]` |
| Refusing to forecast when data is stale | Owner blocked entirely after a connectivity blip | Always forecast from local; visible "Last synced N hours ago" badge; reorder buttons disabled (not hidden) with explanation |
| Mock badges in production UI (current: "Layer 1 SARIMA + Layer 2 XGBoost — both mock" in `settings/page.tsx:160,293`) | Erodes trust when shown to a paying customer | Remove all "mock" copy before first real demo; replace with real layer descriptions |
| Burying the supplier lead-time assumption | Owner sees "reorder Friday" but doesn't know the system assumed 28-day China lead time | Show the assumed lead time inline; one-click edit if wrong |
| Surfacing forecasts for SKUs with insufficient history with full confidence | Owner orders 50 of a brand-new SKU based on noise | Cap displayed confidence by history length; show "new SKU — using category baseline" pill |
| Forecast page rendering "0" or "NaN" silently on sidecar contract mismatch | Owner sees garbage, can't tell why | Hard error if sidecar response fails schema validation; "Forecast temporarily unavailable" banner; alert team |
| Asking owner to reconnect Shopify mid-session without explanation | Drops trust; owner suspects fraud | Banner: "Shopify access expired (or revoked) — reconnect to refresh data. Last good sync: [date]" |
| No way to mark "I bought this elsewhere" outside the app | App keeps recommending reorder of in-stock item | Quick "I have stock, don't suggest" button; feeds back as an inventory adjustment |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Shopify OAuth:** Verify the flow handles **scope changes** (force re-consent), **token revocation** by merchant (graceful "needs_reauth" state), and **uninstall webhook** (cleanup of stored tokens). Many implementations only handle the happy install path.
- [ ] **Shopify webhook handler:** Verify it uses `request.text()` not `request.json()` first; verifies `digest('base64')` not `digest('hex')`; uses `timingSafeEqual`; returns 200 within 2s before doing heavy work.
- [ ] **Shopify inventory ingest:** Verify it pulls `on_hand` not `available`; handles multi-location (even if just storing primary); subtracts on-order from reorder math via the new `onOrder` field.
- [ ] **QuickBooks OAuth:** Verify proactive token refresh exists; per-tenant lock prevents concurrent refresh; `invalid_grant` flips state to `needs_reauth` instead of looping; `CompanyInfo` is fetched and home currency is persisted.
- [ ] **QuickBooks realmId binding:** Verify `QuickBooksConnection.tenantId @unique`; every API call passes tenantId through the resolver; logs capture both IDs.
- [ ] **Python sidecar contract:** Verify Zod validation on the TS side rejects malformed responses; `contract_version` is checked; one Adapter file is the only call-site.
- [ ] **Python sidecar deploy:** Verify cold-start path tested (force a cold start in staging, measure latency end-to-end); models are preloaded on container start; warmup cron exists OR sidecar is on always-on tier.
- [ ] **Forecast history retention:** Verify `deleteMany` on predictions is gone; predictions are append-only with `forecastRunId`; actuals get joined back for drift tracking.
- [ ] **Multi-tenant retrofit:** Verify `findFirst()` count is zero in `app/api/`; a lint rule enforces it; **a second test tenant has been seeded and dashboard data isolation manually verified**.
- [ ] **Tenant-scoped cache:** Verify every cache key has tenantId; `revalidateTag` uses tenant-scoped tags.
- [ ] **Cost & FX:** Verify `Product.cost` has currency context; daily FX fetch persists historical rates; margin reports use replacement cost (current FX) not stored cost.
- [ ] **Supplier lead time:** Verify `Order.expectedArrivalDate` + `Order.receivedAt` exist; supplier `leadTimeStdDev` reflects actuals or documented defaults; CNY multiplier applied for China suppliers.
- [ ] **Holidays:** Verify Eid (and other moveable holidays) come from a library or yearly-refreshed table, not hardcoded constants for future years.
- [ ] **Connectivity resilience:** Forecast page renders fully from local DB with no live API call required; "last synced" badge visible; sync failures don't block the page.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Shopify scopes too narrow | MEDIUM | Add scopes; bump app version; drive existing tenants through re-consent via in-app banner; document who reconnected; expect some churn |
| Shopify webhook HMAC silently failing | LOW | Fix the verify logic; replay missed webhooks via Shopify Partner dashboard (limited window) OR full reconcile via REST pull |
| Double-ordered because no `onOrder` field | HIGH | Reconcile in-transit POs manually; one-time write to new `onOrder` column; communicate "we found and fixed a double-order bug" honestly to affected tenants |
| QuickBooks tokens deadlocked | MEDIUM | Force re-auth for the tenant; document in playbook; root-cause the concurrency bug; add the lock if missing |
| Wrong QB realmId connected | HIGH | Disconnect; reconnect to correct realm; **audit all forecasts/orders/cost data created in the interim and quarantine**; notify affected tenant |
| Python sidecar contract drift broke dashboard | LOW | Roll back sidecar to previous contract version; fix TS-side Zod schema; deploy both; backfill any missing predictions |
| SARIMA wildly wrong on a SKU | LOW per-SKU | Detect via drift report; demote SKU to naive baseline; flag for review; investigate as a batch |
| Multi-tenant leak via cache | HIGH | Invalidate all cache; root-cause the missing tenantId key; audit logs for cross-tenant reads; disclose if PII crossed boundaries |
| Currency mismatch corrupted cost data | MEDIUM | Pause forecasting; recompute cost from QB at correct FX; re-run reports; explain the correction to the tenant |
| Lead time stddev too low, missed CNY | MEDIUM per tenant | Apologise; place expedited air-freight order (eats margin); update CNY multiplier for next year |
| Owner stops trusting the model | HIGH | This is the only one with no technical fix; prevent by always surfacing reasoning + history + accuracy report |

---

## Pitfall-to-Phase Mapping

Phase names below are illustrative; the roadmap orchestrator will assign canonical phase numbers. Pitfalls are grouped by the **earliest** phase that should prevent them.

| Pitfall | Prevention Phase (earliest) | Verification |
|---------|------------------------------|--------------|
| #9 Multi-tenant retrofit (`findFirst`, cache leak) | **Multi-tenant retrofit** (must precede external integrations) | Seed a 2nd tenant; manual cross-tenant data check; lint rule passing; zero `findFirst` in `app/api/` |
| #15 Forecast cache shared across tenants | **Multi-tenant retrofit** | Cache key audit; integration test with 2 tenants |
| #2 Shopify scope under-request | **Shopify integration** (entry-criteria for the phase) | Scope list mapped to PROJECT.md Active list; OAuth screen shows all needed scopes in one consent |
| #3 `on_hand` vs `available` confusion + double-order | **Shopify integration** + `onOrder` schema add (must land together) | `onOrder` field present; reorder math test asserts double-order doesn't recur |
| #4 Multi-location flattening | **Shopify integration** (schema, even if UI deferred) | `Location` model in Prisma; `isPrimary` flag; single-location tenant ingests without UI changes |
| #1 Webhook HMAC body parsing | **Shopify webhooks phase** (or skip if webhooks deferred — document the deferral) | Contract test with known fixture; manual test in Shopify Partner dashboard |
| #5 QB token refresh race | **QuickBooks integration** (entry-criteria) | Per-tenant lock present; concurrent-refresh integration test; `invalid_grant` flips to `needs_reauth` |
| #6 QB realmId leakage | **QuickBooks integration** (after #9) | `QuickBooksConnection.tenantId @unique`; cross-tenant integration test |
| #7 QB sandbox vs prod shape | **QuickBooks integration** | Kenya-configured sandbox in use; `CompanyInfo` fetch is the first call after OAuth; home currency persisted |
| #17 KES/USD price drift | **QuickBooks integration** (cost data flows from here) | `costCurrency` + FX snapshot fields; daily FX cron; margin report reconciliation |
| #8 Python sidecar JSON contract drift | **Python sidecar phase** | Shared JSON Schema in `contracts/`; Zod on TS; `contract_version`; one adapter file |
| #10 SARIMA on short/sparse history | **Python sidecar phase** | History-length routing logic; holdout evaluation gates; confidence cap by data length |
| #11 Intermittent demand + MAPE | **Python sidecar phase** | ADI/CV² classifier in the pipeline; MAE/RMSSE reported per class; weekly bucket for lumpy |
| #12 XGBoost overfit | **Python sidecar phase** | Global model not per-SKU; rolling-origin CV; Layer-2 lift tracked in production |
| #13 Cold-start latency | **Python sidecar phase** (host decision) | Async job or always-on tier decided; cold-start latency measured in staging |
| #14 No prediction history → no drift detection | **Python sidecar phase** | `forecastRunId` column; append-only; drift report cron; accuracy widget in UI |
| #18 Static payday rule | **Python sidecar phase** | Empirical day-of-month + last-Friday detection; tenant override UI |
| #19 Moveable holiday staleness | **Python sidecar phase** | `python-holidays` integration or yearly table refresh; UI surfaces upcoming holidays |
| #20 Supplier lead-time variance / CNY | **Reorder math hardening phase** (alongside `onOrder` add) | `expectedArrivalDate` + `receivedAt` on Order; per-supplier seasonal multipliers; CNY buffer logic |
| #16 Connectivity resilience | **Whichever phase wires real ingest** | Forecast page renders with stale data; "last synced" badge; sync errors are non-blocking |

---

## Notes on confidence

- **HIGH confidence** for the Shopify webhook HMAC + body-parsing pitfall, QuickBooks token refresh / realmId / sandbox patterns, multi-tenant `findFirst` data leak patterns, Python sidecar contract drift, and the FastAPI cold-start traps. These are well-documented in official docs and multiple independent community reports.
- **MEDIUM confidence** for the SARIMA short-history / intermittent demand pitfalls and the ADI/CV² classification thresholds. These reflect M5 competition wisdom and standard practitioner playbooks, but the exact thresholds will need calibration against Beauty Square's real data.
- **MEDIUM confidence** for Kenya-specific lead-time defaults (China 28d±10d, Dubai 14d±5d, etc.). These are reasonable starter values but should be replaced by actuals from `Order.expectedArrivalDate` vs `Order.receivedAt` once that data accumulates.
- **MEDIUM confidence** for the M-Pesa payday-clustering specifics. The "last working Friday + 25th + 13-16" pattern is plausible from general Kenya retail context but no formal study was found in this research pass.

---

## Sources

- [Shopify Admin API 2026 Guide — GraphQL, Inventory & Sales Data, Auth, Rate Limits (AdsX)](https://www.adsx.com/blog/shopify-admin-api-guide)
- [Shopify access scopes (official docs)](https://shopify.dev/docs/api/usage/access-scopes)
- [InventoryLevel (Shopify Admin REST)](https://shopify.dev/docs/api/admin-rest/latest/resources/inventorylevel)
- [InventoryLevel (Shopify Admin GraphQL)](https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryLevel)
- [Shopify Help — Multi-managed inventory](https://help.shopify.com/en/manual/products/inventory/setup/multi-managed-inventory)
- [Shopify Help — Setting up and managing locations](https://help.shopify.com/en/manual/fulfillment/setup/locations/setup)
- [Shopify Webhooks — Deliver webhooks through HTTPS (official)](https://shopify.dev/docs/apps/build/webhooks/subscribe/https)
- [Why Shopify Webhook HMAC Verification Keeps Failing (DEV)](https://dev.to/prateek32177/why-shopify-webhook-hmac-verification-keeps-failing-33ch)
- [How to validate Shopify Webhook hmac in NextJS (Medium)](https://medium.com/@frankjinzhang/how-to-validate-shopify-webhook-hmac-in-nextjs-751fbfac10a3)
- [Shopify API Survival Guide — GraphQL, Rate Limits & Webhooks](https://theecommerce.dev/blog/shopify-api-survival-guide-production-tips)
- [How to Integrate with the QuickBooks Online API (2026 Guide) (Truto)](https://truto.one/blog/how-to-integrate-with-the-quickbooks-online-api-2026-guide)
- [QuickBooks Online API Guide 2026 — OAuth, Endpoints & Rate Limits (Satva)](https://satvasolutions.com/blog/quickbooks-online-api-guide)
- [QuickBooks API OAuth 2.0 and Authorization FAQ (Intuit)](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq)
- [Set up OAuth 2.0 (Intuit)](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- [Refresh token works in sandbox, but not production (Intuit help)](https://help.developer.intuit.com/s/question/0D54R000090AFMESA4/refresh-token-works-in-sandbox-but-not-production-in-quickbooks-payments-api)
- [Quantity on Hand and Quantity Available (QBKAccounting)](https://qbkaccounting.com/quantity-on-hand-and-quantity-available/)
- [Set up and track your inventory in QuickBooks Online (Intuit)](https://quickbooks.intuit.com/learn-support/en-us/help-article/inventory-management/set-track-inventory-quickbooks-online/L22FZLBGN_US_en_US)
- [Multi-Tenant SaaS Data Isolation: Row-Level Security, Tenant Scoping, and Plan Enforcement with Prisma (DEV)](https://dev.to/whoffagents/multi-tenant-saas-data-isolation-row-level-security-tenant-scoping-and-plan-enforcement-with-1gd4)
- [How We Built a Multi-Tenant SaaS with Next.js 16, Prisma 7, and Auth.js (DEV)](https://dev.to/frostbyte_nz/how-we-built-a-multi-tenant-saas-with-nextjs-16-prisma-7-and-authjs-57gj)
- [Implementing Multi-Tenancy in a Next.js Application with Prisma (Medium)](https://qaffaf.medium.com/implementing-multi-tenancy-in-a-next-js-4f2608633a38)
- [SARIMA: A Practical, Production-Ready Guide (TheLinuxCode)](https://thelinuxcode.com/sarima-seasonal-autoregressive-integrated-moving-average-a-practical-production-ready-guide/)
- [Predictive Analytics for Demand Forecasting — SARIMA vs LSTM in Retail SCM (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S1877050922003076)
- [MAPE in Forecasting: Formula, Good Values and Limitations (ImperiaSCM)](https://imperiascm.com/blog/mape-and-supply-chain-forecasting-how-to-measure-and-enhance-accuracy)
- [Machine Learning for Retail Demand Forecasting — XGBoost (Towards Data Science)](https://towardsdatascience.com/machine-learning-for-store-demand-forecasting-and-inventory-optimization-part-1-xgboost-vs-9952d8303b48/)
- [XGBoost Over-fitting Control (Tutorialspoint)](https://www.tutorialspoint.com/xgboost/xgboost-overfitting-control.htm)
- [How to Optimize FastAPI for ML Model Serving (Luis Sena, Medium)](https://luis-sena.medium.com/how-to-optimize-fastapi-for-ml-model-serving-6f75fb9e040d)
- [ML serving and monitoring with FastAPI and Evidently](https://www.evidentlyai.com/blog/fastapi-tutorial)
- [FastAPI for MLOps: Python Project Structure and API Best Practices (PyImageSearch)](https://pyimagesearch.com/2026/04/13/fastapi-for-mlops-python-project-structure-and-api-best-practices/)
- [Idd ul-Fitr 2026 in Kenya (timeanddate.com)](https://www.timeanddate.com/holidays/kenya/eid-al-fitr)
- [Friday, March 20, 2026, Declared Holiday To Mark Idd-ul-Fitr (Kenya Times)](https://thekenyatimes.com/breaking-news/friday-march-20-2026-declared-holiday-to-mark-idd-ul-fitr/)
- [Kenya Public Holidays 2026 (Tallyfy)](https://tallyfy.com/national-holidays/KE/)
- [Chinese New Year 2026: Supply Chain Strategy Amid Volatility (EFW)](https://efwnow.com/resource/chinese-new-year-2026-supply-chain/)
- [Lunar New Year 2026: Asia Sourcing Guide (SEKO Logistics)](https://www.sekologistics.com/en/resource-hub/knowledge-hub/lunar-new-year-2026-complete-supply-chain-planning-guide-for-asia-sourcing/)
- [Chinese New Year Shutdown 2026 — Shipping Delays & Supply Chain Guide (TonleXing)](https://www.tonlexing.com/chinese-new-year-shutdown/)
- Project-internal: `.planning/codebase/CONCERNS.md`, `.planning/codebase/INTEGRATIONS.md`, `.planning/PROJECT.md`

---
*Pitfalls research for: multi-tenant SMB retail demand forecasting (Next.js + Python sidecar + Shopify + QuickBooks, Kenya context)*
*Researched: 2026-05-28*
