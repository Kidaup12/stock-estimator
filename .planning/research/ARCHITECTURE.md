# Architecture Research

**Domain:** Multi-tenant retail demand-forecasting SaaS (Next.js orchestrator + Python forecast sidecar + Shopify/QuickBooks ingest)
**Researched:** 2026-05-28
**Confidence:** MEDIUM-HIGH (Shopify webhook + sidecar patterns HIGH; QuickBooks merge tactics MEDIUM — informed by 2026 community reports of Intuit's January 2026 connector breakage, which is real but rapidly evolving)

This file answers the five architectural questions for the Phase 2-5 work: source-of-truth merging, ingest scheduling, Python sidecar boundaries, multi-tenant data flow, and build order. It refers throughout to concrete files already in the repo (per `.planning/codebase/`) so the recommendations land as deltas, not greenfield designs.

---

## System Overview (Target State, End of Milestone 1)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  CLIENT (browser)                                                          │
│  - Tenant resolved by subdomain (e.g. beautysquare.app.simplydone.africa)  │
│    OR by /shop/[slug] path in v1 (faster to ship, see §4)                  │
└──────────────────────────┬─────────────────────────────────────────────────┘
                           │ HTTPS  (cookie-bound session)
                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  NEXT.JS APP (Vercel)                — the orchestrator + system of record  │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  middleware.ts  →  resolves tenantId from session + subdomain/path,   │ │
│  │                    attaches to AsyncLocalStorage / request headers    │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────┐ ┌────────────────┐ ┌─────────────────────────────────┐│
│  │ app/dashboard  │ │ app/settings   │ │ app/api/* (existing 20+ routes) ││
│  │ app/suppliers  │ │ (onboarding)   │ │ + new ingest + sidecar bridge   ││
│  │ app/promos     │ │                │ │                                 ││
│  │ app/simulate   │ │                │ │                                 ││
│  └────────────────┘ └────────────────┘ └─────────────────────────────────┘│
│                                       │                                    │
│  ┌────────────────────────────────────┴───────────────────────────────────┐│
│  │  lib/  (framework-agnostic)                                            ││
│  │    forecast/simulate-layers.ts ── THE CONTRACT (unchanged shape)       ││
│  │    forecast/sidecar-client.ts  ── NEW: HTTP wrapper for Python svc     ││
│  │    integrations/shopify/       ── real OAuth + Admin GraphQL client    ││
│  │    integrations/quickbooks/    ── OAuth2 + QBO REST client             ││
│  │    integrations/merge.ts       ── NEW: source-priority reconciliation  ││
│  │    tenant/resolve.ts           ── NEW: replace prisma.tenant.findFirst ││
│  └────────────────────────────────────────────────────────────────────────┘│
└──────────┬───────────────────────────────────────────┬────────────────────┘
           │                                           │
           │ HTTPS (server-side, signed JWT)           │ Prisma (Postgres)
           ▼                                           ▼
┌──────────────────────────────┐         ┌────────────────────────────────────┐
│  PYTHON FORECAST SIDECAR     │         │  POSTGRES  (Neon / Vercel)         │
│  (Railway, FastAPI)          │         │                                    │
│  - POST /forecast            │         │  Tenant ── 1:N ── Product          │
│  - statsmodels SARIMA        │         │    │              │                │
│  - XGBoost residual          │         │    └─ Prediction  └─ SalesHistory  │
│  - STATELESS per request     │         │    └─ Promo       └─ Order         │
│  - Receives history inline   │         │    └─ Supplier    └─ Audit (new)   │
│  - Returns ForecastResult    │         │                                    │
│    (same JSON shape)         │         │  + new: IngestCursor, SourceClaim  │
└──────────────────────────────┘         └────────────────────────────────────┘
           ▲
           │ (does NOT touch Postgres directly — see §3)
           │
┌──────────┴────────────────────────────────────────────────────────────────┐
│  EXTERNAL SOURCES                                                          │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐│
│  │  Shopify Admin API + Webhooks   │  │  QuickBooks Online + Webhooks   ││
│  │  - products/* webhooks          │  │  - Item/Invoice/SalesReceipt    ││
│  │  - inventory_levels/update      │  │  - webhooks flaky → poll backup ││
│  │  - orders/create, orders/paid   │  │                                 ││
│  └─────────────────────────────────┘  └─────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Owns | Implementation Today | Implementation Target |
|-----------|------|----------------------|-----------------------|
| Next.js App | UI, orchestration, tenant authority, source-of-truth reconciliation | All exists | Add tenant resolver, ingest routes, sidecar bridge |
| `lib/forecast/simulate-layers.ts` | The forecast contract (JSON shape) | Pure TS mock with `Math.random()` | Stays a TS function, but delegates to sidecar via `sidecar-client.ts` |
| Python sidecar | SARIMA + XGBoost math only | Does not exist | New FastAPI service on Railway, stateless |
| Postgres | System of record | SQLite committed to git | Vercel Postgres / Neon, `provider = "postgresql"`, env-driven URL |
| Shopify integration | Catalog truth, online-channel sales, draft orders | Mock reading from local DB | Real OAuth, webhooks-primary + nightly reconcile poll |
| QuickBooks integration | Inventory-on-hand truth (Beauty Square), COGS, multi-channel sales | Nothing | OAuth2, polling-primary + opportunistic webhooks |
| Merge layer (`lib/integrations/merge.ts`) | Reconciling Shopify ↔ QuickBooks per-field | Nothing | Source-priority table + conflict ledger (see §1) |

---

## 1. Source-of-Truth Merging Pattern

### Decision: **Per-field source priority + audit log of conflicts**

For Beauty Square specifically — and as a defensible default for any Shopify+QuickBooks tenant — the rule is:

> "Each field has exactly one canonical source. The other source is read-only for that field. When they disagree, the canonical value wins, and the disagreement is written to a `SourceClaim` audit row so Mary can be told about it."

This is not last-write-wins (loses signal) and not a free-form conflict-resolution UI (over-engineering for v1). It's a **deterministic priority table**, codified in `lib/integrations/merge.ts`.

### Recommended Priority Table

Stored as a per-tenant config row (e.g. `Tenant.sourcePriorities: Json`) so the next tenant — who may run Shopify-canonical — can flip the table without code changes.

| Field | Beauty Square Canonical | Secondary | Rationale |
|-------|-------------------------|-----------|-----------|
| Product catalog (title, vendor, productType, SKU, variants) | **Shopify** | QB (mapped by SKU) | Mary edits in Shopify admin; QB items are auto-created |
| Retail price (`priceKes`) | **Shopify** | QB | Storefront is where pricing lives |
| Cost / COGS (`costKes`) | **QuickBooks** | Shopify (write-only) | QB tracks landed cost via bills + lots |
| On-hand inventory (`currentStock`) | **QuickBooks** | Shopify (informational) | POS + receiving land in QB; Shopify can drift |
| Sales — online (Shopify channel) | **Shopify** | QB invoice mirror | Webhook-fast; QB lags |
| Sales — POS / walk-in (offline channels) | **QuickBooks** | (none) | These never touch Shopify |
| Supplier / vendor master | **QuickBooks** | Shopify vendor field | Suppliers are an accounting concept |
| Customer records | **QuickBooks** | Shopify customer | Tax + receivables live in QB |
| Reorder draft orders | **Stock Estimator** (writes to Shopify) | — | The app is the system of record for forecasts |

### Merge Algorithm

For each entity-field pair on every ingest cycle:

```
1. canonical_value = read from canonical source for this field
2. secondary_value = read from secondary source for this field (if present)
3. if canonical_value present:
       db.upsert(field = canonical_value, source = canonical_source_id)
       if secondary_value present AND secondary_value != canonical_value:
           db.insert(SourceClaim {
             entityId, field, canonical_value, secondary_value,
             canonical_source, secondary_source, deltaPct, observedAt
           })
   else if secondary_value present:
       db.upsert(field = secondary_value, source = secondary_source_id,
                 confidence = "secondary-only")
       db.insert(SourceClaim { ..., severity: "canonical-missing" })
```

The `SourceClaim` table is the conflict ledger. A dashboard widget (Phase 5 nice-to-have) surfaces unresolved claims so Mary can see "Shopify says 12, QB says 8 — we trusted QB. Confirm?".

### Why Not Last-Write-Wins

LWW is the default in many sync tools (and in the broken QB Connector for Shopify migration of January 2026 referenced in Webgility / QuickSync threads). It fails here because:
- Mary edits a price in Shopify (legitimate). LWW says new Shopify price wins. But the next QB invoice push has the *old* price encoded in its line item — LWW now reverts.
- A POS sale decrements QB stock from 8→7. Shopify still shows 12 because Shopify hasn't seen the POS sale. LWW will silently align QB's "7" to Shopify's "12" → overselling.

Per-field priority avoids both.

### Why Not a Conflict-Resolution UI for v1

Mary doesn't want to triage merges. The whole reason she's buying this app is "tell me the answer." A UI is the right place to *eventually* show the audit ledger, but the merge itself must be automatic and deterministic. (Add the UI in Milestone 2, not Milestone 1.)

---

## 2. Ingest Scheduling

### Decision: **Hybrid — webhooks primary, scheduled reconciliation as belt-and-suspenders, with different ratios for Shopify vs QuickBooks**

This is the unanimous 2026 consensus across Shopify and Intuit developer docs: webhooks alone are unsafe. Scheduled polling alone is wasteful. Both together is the supported pattern.

### Shopify: webhook-heavy

| Mechanism | When | Topics | Endpoint in this repo |
|-----------|------|--------|----------------------|
| **Webhooks (primary)** | Real-time | `products/create`, `products/update`, `products/delete`, `inventory_levels/update`, `orders/create`, `orders/paid`, `orders/cancelled`, `app/uninstalled` | New: `app/api/webhooks/shopify/route.ts` |
| **Reconciliation poll** | Nightly cron (Vercel Cron) | Full product catalog diff; orders from last 25h window (overlap for safety) | New: `app/api/cron/shopify-reconcile/route.ts` |
| **Initial backfill** | On-demand (replaces seed flow) | 365d orders, full catalog, inventory snapshot | New: `app/api/shopify/backfill/route.ts` |

Shopify webhooks are reliable enough to be primary: sub-10s delivery in steady state, 48h retry with exponential backoff, automatic removal after 19 consecutive failures. The nightly reconcile catches the < 1% gap.

**Critical implementation rules** (from Shopify dev docs):
- Return 2xx within 5s; do heavy work async (write to a queue or just to a Postgres `IngestJob` table and let a worker drain it).
- Verify HMAC signatures on every webhook (`X-Shopify-Hmac-Sha256`).
- Idempotency: deduplicate on `X-Shopify-Webhook-Id` — Shopify retries can deliver the same event twice.
- Never assume ordering. `products/update` may arrive before `products/create` after a Shopify outage.

### QuickBooks Online: poll-heavy

| Mechanism | When | What | Endpoint |
|-----------|------|------|----------|
| **Scheduled poll (primary)** | Every 15 min (Vercel Cron) or hourly to start | `CDC` (change data capture) endpoint over `Item`, `Invoice`, `SalesReceipt`, `Purchase`, `Bill`, `Vendor` | New: `app/api/cron/qb-poll/route.ts` |
| **Webhooks (best-effort)** | When they fire | Same entities — used to shorten latency, NOT as system of record | New: `app/api/webhooks/quickbooks/route.ts` |
| **Initial backfill** | On-demand at connect time | 365d invoices + sales receipts + items + inventory adjustments | New: `app/api/quickbooks/backfill/route.ts` |

Why polling-primary for QB: Intuit webhooks per 2026 developer reports can be delayed *hours* during incidents, arrive out of order, and only tell you *what* changed (not the new value — you still call the API). The CDC endpoint with a cursor (`changedSince=<lastSync>`) is the canonical way to keep QB state fresh and is what Intuit themselves recommend for inventory.

For a daily/hourly forecasting cadence (which the PROJECT.md explicitly out-of-scopes real-time inventory sync), polling every 15-60 min is more than enough.

### Cursor / Idempotency Model

Add an `IngestCursor` table:
```
IngestCursor {
  tenantId        String
  source          enum("shopify"|"quickbooks")
  entity          String  // "orders", "items", "invoices", etc.
  cursor          String  // last updated_at or last event ID
  lastRunAt       DateTime
  lastRunStatus   enum("ok"|"partial"|"failed")
  @@unique([tenantId, source, entity])
}
```

Every ingest job reads/writes this row. Replaces the implicit "last 365 days from now" assumption baked into the current synth script.

---

## 3. Python Sidecar Boundaries

### Decision: **Stateless per-request. Next.js sends all data inline. Sidecar does NOT touch Postgres.**

This is the single most important architectural decision in this milestone, because the wrong call here multiplies complexity by 3x for the rest of the project.

### What the sidecar is

A FastAPI service hosted on Railway (Roy's standard) with one primary endpoint:

```
POST /v1/forecast
Body:
{
  "tenant_id": "cln...",        # opaque, for logging only
  "product_id": "cln...",       # opaque, for logging only
  "product_type": "FRAGRANCE",
  "current_stock": 12,
  "abc_category": "A",
  "history": [                  # 365 days; Next.js sends
    {"date": "2025-05-28", "units": 3, "revenue_kes": 1500},
    ...
  ],
  "lead_time_avg_days": 21,
  "lead_time_std_days": 5,
  "active_promos": [...],
  "calendar_signals": {         # Kenya calendar pre-computed by Next.js
    "upcoming_holidays": [...],
    "upcoming_paydays": [...]
  }
}

Response: ForecastResult exactly matching lib/forecast/simulate-layers.ts:36-49.
```

### Why stateless

1. **The contract already says so.** `lib/forecast/simulate-layers.ts` is a *pure function*. It takes inputs, returns outputs. Honoring that boundary across the network is a one-line change in `app/api/forecast/run/route.ts` (replace `simulateLayeredForecast(input)` with `await sidecarClient.forecast(input)`). PROJECT.md line 92 calls this out as a hard constraint.
2. **Tenant isolation is automatic.** If the sidecar has no DB, it cannot leak data across tenants. There is no "did the SARIMA query forget the WHERE tenantId clause" bug class.
3. **Postgres connection sprawl.** Adding a second service that talks to the same Postgres doubles connection-pool math, introduces a deploy-order dependency (run migration before sidecar deploys), and means two codebases must know the schema.
4. **Scales independently and trivially.** Railway can autoscale the sidecar on CPU. No DB connection ceiling to worry about.
5. **The forecast is cheap to ship inputs for.** 365 days × ~1000 SKUs at ~80 bytes/row = ~30MB. Shipped once per `/api/forecast/run` call, not per request. Acceptable.

### Why NOT a feature store (yet)

A feature store (Feast, Tecton, custom) makes sense when:
- You serve predictions at user-request latency (single SKU, single click, < 100ms).
- Multiple downstream models share features.
- You need point-in-time correctness for training/serving parity.

None of those apply for v1. Forecasts here are batch (1k SKUs in one run, weekly or daily), tolerate seconds of latency, and have one model. Feature store is correct architecture, premature engineering for now. **Revisit in Milestone 3** if real-time per-SKU re-forecasting becomes a product requirement.

### Why NOT have the sidecar query Postgres directly

The temptation: "the sidecar already knows the tenant_id, why not just `SELECT * FROM sales_history WHERE tenant_id = ?`". Cost:
- The schema (Prisma) is now duplicated knowledge in Python.
- Schema migrations require coordinated deploys.
- Tenant isolation is now a Python concern AND a TS concern — twice the auth-bypass surface area.
- The pure-function contract from the existing repo is broken: now the sidecar has side effects (DB reads) and the "swap is one file" promise dies.

Stateless + inputs-over-the-wire keeps all that complexity in Next.js where it already lives.

### Authentication between Next.js → Sidecar

Signed JWT in `Authorization: Bearer ...` header. The token carries:
- `iss`: stock-estimator
- `aud`: forecast-sidecar
- `tenant_id`: opaque (for sidecar logs/metrics only)
- `exp`: short-lived (5 min)

Shared secret in `FORECAST_SIDECAR_SECRET` env var on both sides. No OAuth, no service mesh — overkill for a 2-service system.

### Failure Modes

The sidecar can be down. The bridge must handle that:
- **Cold start / 502:** retry once with 2s backoff, then fall through to `simulateLayeredForecast` mock with a `signals[]` warning entry `{ label: "Forecast model unavailable — using deterministic fallback", emoji: "⚠️" }`. The dashboard still works; Mary still gets *some* number.
- **Timeout:** 30s per-product budget (statsmodels SARIMA fit on 365 points is normally < 1s; allow margin).
- **Forecast determinism:** deal with this BEFORE the Python swap (it's a PROJECT.md Active requirement). The mock's `Math.random()` must die in Phase 1 or 2 so the test for "did the sidecar swap change anything?" is meaningful.

---

## 4. Multi-Tenant Data Flow

### Decision: **Path-based tenant slug in URL (`/shop/[slug]/...`) for v1, with middleware that injects `tenantId` into AsyncLocalStorage. Sidecar receives `tenant_id` as opaque body field.**

Move to subdomain-based (`<slug>.app.simplydone.africa`) in Milestone 2 once DNS + Vercel wildcard are configured. Path-based is dramatically faster to ship.

### Why path-based for v1, not subdomain

| Criterion | Path-based | Subdomain | Header-only |
|-----------|------------|-----------|-------------|
| DNS setup | None | Wildcard + cert per tenant | None |
| Vercel config | None | Wildcard domain + edge config | None |
| Cookie scope | Single domain — easy | Cross-subdomain cookies, `sameSite=lax`, `domain=.app.simplydone.africa` | Single domain |
| URL legibility for Mary | `/shop/beautysquare/dashboard` — fine | `beautysquare.app.simplydone.africa` — slicker | Hidden — bad UX |
| Time to ship v1 | ~2 hours | ~1 day plus DNS round-trip | ~1 hour |
| Future migration cost | Migrate to subdomain via 301 — easy | — | Forced rewrite if anyone bookmarks |

Path-based now, subdomain later. This matches the Next.js team's own multi-tenant guide.

### Resolver Implementation Sketch

`lib/tenant/resolve.ts` — new file, ~30 LOC:

```typescript
// Reads tenant slug from URL, validates against DB, returns tenantId or null.
// Called by middleware.ts on every request; result stashed in AsyncLocalStorage
// AND attached as x-tenant-id header for route handlers that prefer reading
// from request (React Server Components in Next 16 should use ALS).

import { AsyncLocalStorage } from "node:async_hooks";
export const tenantStore = new AsyncLocalStorage<{ tenantId: string }>();

export function getTenantId(): string {
  const ctx = tenantStore.getStore();
  if (!ctx) throw new Error("No tenant in context");
  return ctx.tenantId;
}
```

`middleware.ts` (new):
```typescript
export async function middleware(req: NextRequest) {
  const slug = req.nextUrl.pathname.split("/")[2]; // /shop/[slug]/...
  if (!slug) return NextResponse.redirect(new URL("/shop", req.url));
  const session = await getServerSession(req);   // NextAuth or @auth/core
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  // Authorization: does this session have access to this tenant?
  const membership = await prisma.membership.findFirst({
    where: { userId: session.userId, tenant: { slug } }
  });
  if (!membership) return NextResponse.json({error: "forbidden"}, {status: 403});

  const res = NextResponse.next();
  res.headers.set("x-tenant-id", membership.tenantId);
  return res;
}
```

Route handlers:
```typescript
// Replaces: const tenant = await prisma.tenant.findFirst();
const tenantId = req.headers.get("x-tenant-id");
if (!tenantId) return NextResponse.json({error: "no tenant"}, {status: 401});
```

This is the canonical "header-injected-by-middleware" pattern. It replaces 12+ instances of `prisma.tenant.findFirst()` with one consistent resolver.

### Schema Additions

```
model User {
  id        String       @id @default(cuid())
  email     String       @unique
  // ...
  memberships Membership[]
}

model Membership {
  id        String   @id @default(cuid())
  userId    String
  tenantId  String
  role      String   // "owner"|"manager"|"viewer"
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([userId, tenantId])
  @@index([tenantId])
}

model Tenant {
  // ... existing fields
  slug              String   @unique  // NEW — URL identifier
  sourcePriorities  Json?              // NEW — per-tenant merge config (see §1)
  shopifyDomain     String?
  shopifyAccessToken String?           // ENCRYPT at rest in Milestone 1 hardening
  qbRealmId         String?            // NEW — QuickBooks company ID
  qbAccessToken     String?            // NEW — encrypted
  qbRefreshToken    String?            // NEW — encrypted
  qbTokenExpiresAt  DateTime?          // NEW
  memberships       Membership[]
}
```

### How the Python sidecar knows the tenant

It receives `tenant_id` as a body field. **It uses this for nothing except logging and Prometheus labels.** It does not query Postgres on it. It does not authorize on it. The Next.js server is the authority; the sidecar is a pure compute function.

This is a deliberate boundary that prevents an entire bug class.

### How webhooks resolve their tenant

Both Shopify and QuickBooks webhooks include the shop/realm identifier in the payload (`X-Shopify-Shop-Domain` header; `realmId` in the QB body). The webhook handlers do:

```typescript
const shopDomain = req.headers.get("x-shopify-shop-domain");
const tenant = await prisma.tenant.findUnique({ where: { shopifyDomain: shopDomain } });
if (!tenant) return new Response("unknown shop", { status: 404 });
// ... process with tenant.id
```

This is the one legitimate `findFirst`/`findUnique` that survives — webhooks have no session, so the source domain *is* the tenant key. Treat it as a separate, narrowly-scoped resolver, not a global fallback.

---

## 5. Build Order / Dependencies

### Decision: **5 phases, sequenced by what unblocks what. Phase 1 = ground truth, Phase 2 = production foundation, Phase 3 = Shopify real, Phase 4 = QuickBooks + merge, Phase 5 = Python sidecar.**

Rationale: each phase removes a class of unknown from the next. Shipping the Python sidecar before real Shopify ingest is testable but pointless (no real data to forecast on). Shipping multi-tenant fixes before real Shopify is *required* because the first thing real Shopify does is overwrite the existing single tenant.

### Phase 1: Boot + Determinism + Cleanup (the "verify mocks" phase)

**Goal:** Ground truth. The app runs end-to-end on Postgres, predictions are reproducible, the DB-in-git embarrassment is gone.

- Boot existing app locally. Walk the `/settings → seed → forecast → /dashboard` flow per ARCHITECTURE.md §"End-to-End".
- Postgres swap (per CONCERNS.md §2.1, 2.2): provider flip, `env("DATABASE_URL")`, `.env.example`, scrub `prisma/dev.db` from git history.
- Forecast determinism: kill `Math.random()` in `simulate-layers.ts:162` and `seed-from-beautysquare.ts:61,63`. Make `seed` use a deterministic RNG seeded on tenantId + a fixed integer. Required so the Phase 5 swap-test ("did the Python sidecar change the answer?") has a baseline to diff against.
- Dedupe `assignAbc()` between `app/api/forecast/run/route.ts` and `scripts/run-forecasts.ts` into `lib/forecast/abc.ts` (CONCERNS.md §5.2 drift bomb).

**Unblocks:** everything else. Without this, every later phase fights non-determinism + SQLite + drift.

### Phase 2: Multi-Tenant + Auth Foundation

**Goal:** The 13th `prisma.tenant.findFirst()` is the last one.

- Add `User`, `Membership` models. Add `Tenant.slug`, `Tenant.sourcePriorities`, QB token fields.
- Add NextAuth (or @auth/core v5) — email magic-link is the lightest path. Roy has shipped this on TaxBrain and Umugisha.
- Add `middleware.ts` + `lib/tenant/resolve.ts` per §4.
- Migrate routes: replace every `prisma.tenant.findFirst()` with `getTenantId()` from AsyncLocalStorage, in one PR. Add tenant guard at the top of every handler.
- Hardcoded `"beautysquareke.co"` (settings page + seed script) → URL slug + form input.

**Why before real Shopify:** the moment a second tenant connects Shopify, the current single-tenant overwrite bug (`/api/shop` upsert per CONCERNS.md §4.2) clobbers Beauty Square's row. Multi-tenant must precede the second connector.

**Unblocks:** Phase 3 (Shopify can write to the right tenant), Phase 4 (QB can do the same), Phase 5 (sidecar sees a real tenant_id).

### Phase 3: Real Shopify Ingest

**Goal:** `lib/shopify/client.ts` is no longer reading Prisma.

- Shopify OAuth: install/uninstall, `app/api/auth/shopify/callback/route.ts`, token storage (encrypted), scope verification.
- Replace each method in `ShopifyClient` per the `// MOCK — real impl:` comments. Use GraphQL Admin API (Shopify's REST is deprecated for new apps as of 2024).
- Initial backfill route: `app/api/shopify/backfill/route.ts` — pulls 365d orders, full catalog, inventory snapshot into existing tables.
- Webhook subscriptions on install: `products/*`, `inventory_levels/update`, `orders/*`, `app/uninstalled`.
- Nightly reconcile cron.

**Why before QuickBooks:** Shopify is the simpler integration (one mature SDK; well-documented webhooks; one auth flow). Builds the ingest pattern that QB then copies. Also Beauty Square's Shopify is live and ready; QB sandbox is what Anjay is still fetching.

**Unblocks:** Phase 4 (merge layer needs at least one real source to merge against), Phase 5 (real data to forecast on).

### Phase 4: QuickBooks Ingest + Merge Layer

**Goal:** Two sources writing to one truth, with QB winning for Beauty Square's canonical fields.

- QBO OAuth2 + token refresh job (60-day refresh tokens, 1h access tokens).
- QBO REST client + CDC polling cron (per §2).
- QB webhook handler as opportunistic latency reducer.
- `lib/integrations/merge.ts` — the per-field priority reconciler from §1.
- `SourceClaim` model + minimal "ingest health" panel under `/settings` showing recent conflicts.
- Backfill route: pull 365d QB invoices/sales receipts, dedupe against Shopify orders (by date + amount + customer) where possible.

**Why this order:** without Phase 3, there's nothing to merge with. Without Phase 2, the merge writes to the wrong tenant.

**Unblocks:** Phase 5 (sidecar now sees *real* multi-source-reconciled history).

### Phase 5: Python Forecast Sidecar

**Goal:** `Math.random()` is gone; statsmodels SARIMA + xgboost are computing real forecasts.

- New `forecast-sidecar/` directory in this repo (or sibling repo) with FastAPI app, `pyproject.toml`, `Dockerfile`, Railway config.
- Single endpoint `POST /v1/forecast` per §3 contract.
- JWT auth shared secret.
- `lib/forecast/sidecar-client.ts` — typed HTTP wrapper that returns `ForecastResult`.
- One-line swap in `app/api/forecast/run/route.ts`: `await sidecarClient.forecast(input)` replaces `simulateLayeredForecast(input)`.
- Fallback to mock on sidecar error (warning signal injected into `Signal[]`).
- Snapshot test: same input to mock vs sidecar — check `recommendedQty` is within 25%, alert if it diverges wildly.

**Why last:** all upstream prerequisites are now satisfied. Real tenants (Phase 2), real catalog/orders (Phase 3+4), reconciled inventory truth (Phase 4). The sidecar's only job is to do better math on that data.

**Out of this milestone (per PROJECT.md):** Layer-2 signals beyond mock (Trends + weather), on-order tracking, ABC override UI, multi-channel beyond Shopify+QB, M-Pesa billing.

### Phase Dependency Graph

```
Phase 1 (boot + Postgres + determinism + dedupe)
   │
   ├──→ Phase 2 (multi-tenant + auth)
   │       │
   │       ├──→ Phase 3 (real Shopify)
   │       │       │
   │       │       └──→ Phase 4 (QB + merge layer)  ◄── needs Shopify in place
   │       │               │
   │       │               └──→ Phase 5 (Python sidecar) ◄── needs real data
   │       │
   │       └──→ (Phase 3 can technically start in parallel with Phase 2's
   │            *tail*, once middleware + tenant resolver are merged, but
   │            don't try in practice — single dev, serialize)
```

Critical edges:
- **Phase 1 → all** because non-determinism and SQLite block testing.
- **Phase 2 → Phase 3** because second-tenant onboarding will overwrite first.
- **Phase 3 → Phase 4** because the merge layer needs a real Shopify side to merge against (otherwise it's merging mocks → can't validate).
- **Phase 4 → Phase 5** because the forecast quality story only matters once the forecast sees real, reconciled inventory + sales.

---

## Recommended File Layout (Deltas, Not Greenfield)

```
stock-estimator/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── [...nextauth]/route.ts           # NEW (Phase 2)
│   │   │   └── shopify/callback/route.ts        # NEW (Phase 3)
│   │   │   └── quickbooks/callback/route.ts     # NEW (Phase 4)
│   │   ├── webhooks/
│   │   │   ├── shopify/route.ts                 # NEW (Phase 3)
│   │   │   └── quickbooks/route.ts              # NEW (Phase 4)
│   │   ├── cron/
│   │   │   ├── shopify-reconcile/route.ts       # NEW (Phase 3)
│   │   │   └── qb-poll/route.ts                 # NEW (Phase 4)
│   │   ├── shopify/backfill/route.ts            # NEW (Phase 3)
│   │   ├── quickbooks/backfill/route.ts         # NEW (Phase 4)
│   │   └── (existing 20+ routes — adjusted Phase 2)
│   ├── shop/[slug]/                             # NEW root for tenant-scoped pages (Phase 2)
│   │   ├── dashboard/                            # MOVED from app/dashboard/
│   │   ├── settings/                             # MOVED from app/settings/
│   │   ├── suppliers/                            # MOVED
│   │   ├── promos/                               # MOVED
│   │   ├── simulate/                             # MOVED
│   │   └── reports/                              # MOVED
│   └── (login, pricing, contact stay top-level)
├── middleware.ts                                 # NEW (Phase 2)
├── lib/
│   ├── tenant/
│   │   └── resolve.ts                            # NEW (Phase 2)
│   ├── auth/                                     # NEW (Phase 2)
│   ├── integrations/
│   │   ├── shopify/
│   │   │   ├── client.ts                         # REWRITE (Phase 3)
│   │   │   ├── webhooks.ts                       # NEW (Phase 3)
│   │   │   └── oauth.ts                          # NEW (Phase 3)
│   │   ├── quickbooks/                           # NEW (Phase 4)
│   │   │   ├── client.ts
│   │   │   ├── webhooks.ts
│   │   │   └── oauth.ts
│   │   └── merge.ts                              # NEW (Phase 4)
│   ├── forecast/
│   │   ├── simulate-layers.ts                    # STAYS (contract owner)
│   │   ├── baseline.ts                           # STAYS
│   │   ├── abc.ts                                # NEW (Phase 1 — dedupe)
│   │   └── sidecar-client.ts                     # NEW (Phase 5)
│   └── seed/kenya-calendar.ts                    # STAYS
├── forecast-sidecar/                             # NEW (Phase 5)
│   ├── app/main.py
│   ├── app/models/sarima.py
│   ├── app/models/xgb.py
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── railway.json
└── prisma/
    └── schema.prisma                             # EVOLVES every phase
```

---

## Anti-Patterns Specific to This Domain

### Anti-Pattern 1: "Just shove Python into a Vercel Serverless Function"

**What people do:** Use Vercel's Python runtime to host the FastAPI sidecar in the same project.
**Why wrong:** Cold starts are brutal for statsmodels (slow imports). Vercel's Python is for thin API helpers, not numerical compute. xgboost binaries push the 50MB bundle limit. PROJECT.md line 90 already mandates separate hosting.
**Do instead:** Railway. It's where Roy hosts all his Python services; deploy story is `railway up`.

### Anti-Pattern 2: "Sidecar queries Postgres because it already 'knows' the tenant"

**What people do:** Save one HTTP roundtrip by giving the sidecar `DATABASE_URL`.
**Why wrong:** Loses tenant isolation by design, couples schema, breaks the pure-function contract, doubles deploy coordination. See §3.
**Do instead:** Send history inline. ~30MB per forecast run on a 1k-SKU shop is fine.

### Anti-Pattern 3: "Last-write-wins merge"

**What people do:** When Shopify and QB disagree, take whichever ingested most recently.
**Why wrong:** Whichever source ran its cron last "wins" arbitrarily. Mary's legitimate price edit in Shopify gets reverted by the next QB invoice push that has the old price. POS-only sales get overwritten by Shopify-only inventory. See §1.
**Do instead:** Per-field priority table, persisted per-tenant.

### Anti-Pattern 4: "Webhooks-only because they're 'modern'"

**What people do:** Skip the reconciliation cron because webhooks are real-time.
**Why wrong:** Shopify retires webhooks after 19 consecutive failures. QB webhooks lag *hours* in incidents. Silent data loss compounds over months. See §2.
**Do instead:** Hybrid. Webhooks for latency, polling for completeness.

### Anti-Pattern 5: "One giant ingest endpoint that does Shopify + QB + merge in one request"

**What people do:** `/api/sync/all` does everything serially.
**Why wrong:** A 1-hour run on 1k SKUs hits Vercel function timeout (300s max even with `maxDuration`). One failure rolls back everything. No incremental progress.
**Do instead:** Separate jobs per source per entity. Each has its own cursor. Each is independently retryable. Merge runs as its own job triggered by ingest completion.

### Anti-Pattern 6: "Subdomain tenant resolution before subdomain DNS is configured"

**What people do:** Code the subdomain middleware first, ship later when DNS lands.
**Why wrong:** Local dev becomes painful (must edit /etc/hosts), Vercel preview deploys can't test it, Mary can't be onboarded until DNS is final.
**Do instead:** Path-based now (`/shop/[slug]`), migrate to subdomain in Milestone 2 with a 301 redirect.

---

## Integration Points

### External Services

| Service | Connection | Auth | Ingest Mode | Notes |
|---------|------------|------|-------------|-------|
| Shopify Admin GraphQL | HTTPS | OAuth2 (offline access scope) | Webhooks primary + nightly reconcile | HMAC verify webhooks; idempotency on `X-Shopify-Webhook-Id`; respect 2 calls/sec leaky bucket |
| QuickBooks Online | HTTPS | OAuth2 (refresh token rotation, 60d expiry) | CDC polling primary + opportunistic webhooks | Token refresh 5 min before expiry; backoff on 429; CDC cursor per entity |
| Python Forecast Sidecar | HTTPS | Signed JWT (HS256, shared secret, 5min TTL) | Per-request RPC | Stateless; falls back to TS mock on 5xx |
| Vercel Cron | Vercel-native | `CRON_SECRET` header | — | All scheduled jobs declared in `vercel.json` |
| Postgres (Neon / Vercel Postgres) | Prisma connection pool | Connection string in env | — | Pool size = 10 default; raise if forecast-run goes wide |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|--------------|-------|
| Page ↔ API route | `fetch()` (same-origin) | Cookie session carries auth |
| API route ↔ Prisma | Direct import | `lib/prisma.ts` singleton, always |
| API route ↔ Sidecar | HTTPS + JWT | `lib/forecast/sidecar-client.ts` is the only caller |
| Webhook ↔ Tenant resolver | Domain-keyed `findUnique` (Shopify) or `realmId`-keyed (QB) | The one allowed bypass of session-based tenant resolution |
| Ingest job ↔ Merge layer | Direct in-process call within a route handler or cron | Atomic Prisma `$transaction` for the writes |
| Merge layer ↔ SourceClaim | `prisma.sourceClaim.createMany` | Append-only audit; no UI in this milestone |

---

## Scaling Considerations

Beauty Square is one tenant with ~1k SKUs. Anjay's standing rule is multi-tenant from day one, but real growth past 10 tenants is months away. Right-size for that.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 tenant, 1k SKUs (Beauty Square today) | Everything fits as designed. Forecast run = ~1k sidecar calls = ~5 min total |
| 5-20 tenants, ~10k SKUs total | Move sidecar calls from sequential to batched (sidecar accepts an array of products). Add per-tenant rate-limit on ingest crons so one big tenant doesn't starve others. |
| 50+ tenants, 100k+ SKUs | Job queue (BullMQ on Upstash Redis) replaces the per-route sync runner. Sidecar autoscales horizontally. Per-tenant Postgres partitioning by `tenantId`. Consider feature store if real-time per-SKU re-forecasting becomes a product. |

### First Bottlenecks (Likely Order)

1. **Forecast-run wall time** — 1k sequential HTTP calls to sidecar. Mitigate with batching at the contract level (`POST /v1/forecast/batch`) or parallelizing in TS with `pLimit(8)`.
2. **Shopify rate limit on backfill** — 2 calls/sec leaky bucket. 365d of orders for a busy shop = thousands of calls. Mitigate with cursor pagination + exponential backoff already in the GraphQL client libraries.
3. **Vercel function timeout** — 300s hard cap on Pro plan for cron jobs. Mitigate by chunking ingest jobs into multiple cron entries (e.g. `qb-poll-items`, `qb-poll-invoices`).
4. **Postgres connection pool** — Prisma + Vercel serverless can exhaust connections under burst. Mitigate with Prisma Data Proxy or Neon's pgbouncer-style pooling.

---

## Sources

- [Next.js Multi-tenant Guide (official)](https://nextjs.org/docs/app/guides/multi-tenant) — path vs subdomain vs domain tenancy; middleware + header injection pattern. HIGH confidence.
- [Shopify Webhooks (official)](https://shopify.dev/docs/apps/build/webhooks) — delivery guarantees, retry behavior, HMAC verification. HIGH confidence.
- [Shopify webhooks vs polling: why webhooks win for OMS sync](https://www.sapotacorp.vn/blog/shopify-webhooks-vs-api-polling-integration) — latency + cost comparison; reconciliation pattern. MEDIUM confidence (industry blog, claims aligned with official docs).
- [QuickBooks Webhooks (official Intuit)](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks) — webhook reliability caveats; entity coverage. HIGH confidence.
- [QuickBooks Online API Integration Guide 2026 (Knit.dev)](https://www.getknit.dev/blog/quickbooks-online-api-integration-guide-in-depth) — CDC pattern, polling fallback, 2026-current limits. MEDIUM confidence.
- [Shopify QuickBooks Integration Sync Guide 2026 (QuickSync)](https://quicksync.pro/blog/how-to-sync-shopify-and-quickbooks/) — source-of-truth recommendation; January 2026 connector migration issues. MEDIUM confidence (vendor blog; claims about Jan 2026 mandatory migration corroborated in Layernext + Webgility threads).
- [QuickBooks vs Shopify Inventory Mismatch (Webgility)](https://www.webgility.com/blog/shopify-quickbooks-inventory-management) — real-world conflict cases; reconciliation cadence. MEDIUM confidence.
- [FastAPI + Next.js 15 Full-Stack Architecture](https://dev.to/alexmayhew-dev/fastapi-nextjs-15-the-full-stack-nobodys-building-1hl9) — sidecar pattern justification; service boundaries. MEDIUM confidence (dev community).
- [Deploy XGBoost Model As Service with FastAPI](https://xgboosting.com/deploy-xgboost-model-as-service-with-fastapi/) — stateless inference pattern, request shape. MEDIUM confidence.
- [A Deep Dive into Feature Stores (Taiwo, Medium)](https://medium.com/@samuel-taiwo/a-deep-dive-into-feature-stores-2824d6dbf588) — when feature stores justify themselves vs stateless services. MEDIUM confidence; informs §3 "why not feature store yet".
- [Building Multi-Tenant SaaS 2026 (GSoft Consulting)](https://gsoftconsulting.com/en/blog/building-multi-tenant-saas-2026) — middleware + header injection, cross-subdomain cookie config. MEDIUM confidence.
- [Multi-Tenant Architecture Patterns in Next.js (Achromatic)](https://www.achromatic.dev/blog/multi-tenant-architecture-nextjs) — three resolution strategies compared. MEDIUM confidence.

---

*Architecture research for: multi-source ingest + Python forecast sidecar in an existing Next.js 16 + Prisma monolith*
*Researched: 2026-05-28*
