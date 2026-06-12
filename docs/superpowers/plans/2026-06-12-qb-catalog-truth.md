# QuickBooks Catalog Truth (Track A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make QuickBooks (via an n8n feed) the authority on which Shopify products are "real" — soft-flag products QB has no record of out of the buy list (never delete, never flag on stock level), with a review bucket + owner override.

**Architecture:** An n8n workflow matches QB items → Shopify by name and POSTs a SKU-keyed feed to a new bearer-secured endpoint. A pure flag function decides which products to (re)activate vs. soft-deactivate — respecting `source="shopify"` scope, owner overrides, and a >60% abort guard. Inactive products simply get no forecast, so they vanish from dashboard/planner automatically; a small review page lists them with a "Keep active" override.

**Tech Stack:** Next.js 16 App Router, Prisma 6 (Postgres/Supabase), Zod, Vitest. No new deps. Membership only — cost stays on the existing COGS upload; QB stock override is out of scope (per spec).

**Spec:** `docs/superpowers/specs/2026-06-12-qb-catalog-truth-design.md`

**Deviation from spec (intentional, YAGNI):** drop the `Product.qbName` column. The review view shows the flagged product's own Shopify title + sales + stock — enough to investigate "why flagged" — and persisting QB's name would force a per-row write loop (the project's documented Vercel→Supabase timeout pattern). Membership writes stay 2 batched `updateMany` calls. Cost-via-feed is deferred (COGS upload already ships it).

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | `Product.active/activeOverride/qbMatchedAt`; `QbSyncRun` model; `Tenant.qbSyncRuns` |
| `prisma/migrations/20260612030000_qb_catalog_truth/migration.sql` (create) | additive, live-safe DDL |
| `lib/qb/catalog-flags.ts` (create) | pure `computeCatalogFlags()` — the decision heart |
| `lib/qb/catalog-flags.test.ts` (create) | unit tests for the flag logic |
| `app/api/qb/catalog/route.ts` (create) | `POST` feed ingest (bearer secret, batched writes, QbSyncRun) |
| `app/api/qb/status/route.ts` (create) | `GET` last run + current flagged count (Settings card) |
| `app/api/qb/flagged/route.ts` (create) | `GET` list of active=false products for the review page |
| `app/api/forecast/run/route.ts` (modify) | skip `active=false` |
| `lib/forecast/run-batch.ts` (modify) | skip `active=false` |
| `app/api/products/[id]/route.ts` (modify) | PATCH accepts `active` + `activeOverride` |
| `app/shop/[slug]/not-in-quickbooks/page.tsx` (create) | review list + "Keep active" |
| `app/shop/[slug]/settings/page.tsx` (modify) | real QuickBooks (clean-data) card |
| `docs/n8n-qb-catalog-feed-prompt.md` (create) | n8n build-prompt deliverable |

---

## Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (Product model ~line 50-90; Tenant model)
- Create: `prisma/migrations/20260612030000_qb_catalog_truth/migration.sql`

- [ ] **Step 1: Add Product fields** — in `prisma/schema.prisma`, inside `model Product`, after the `importCategory` line (73):

```prisma
  importCategory    String?   // "LOCAL" | "KOREAN" | "WESTERN"; null = unclassified (treated LOCAL)
  active            Boolean   @default(true)  // false = not in QB (or owner-deactivated) → out of the buy list
  activeOverride    Boolean   @default(false) // owner pinned active; the QB flagger must never deactivate it
  qbMatchedAt       DateTime? // last time the QB feed confirmed this product (null = never)
```

And add an index alongside the existing `@@index` lines (after line 89):

```prisma
  @@index([tenantId, importCategory])
  @@index([tenantId, active])
```

- [ ] **Step 2: Add QbSyncRun model + Tenant relation** — append a new model (near the other models) and add the back-relation to `model Tenant`:

```prisma
model QbSyncRun {
  id            String   @id @default(cuid())
  tenantId      String
  at            DateTime @default(now())
  matched       Int      @default(0)
  flagged       Int      @default(0)
  weak          Int      @default(0)
  totalProducts Int      @default(0)
  aborted       Boolean  @default(false)
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, at])
}
```

In `model Tenant`, add to its relation list (alongside the other `X[]` relations):

```prisma
  qbSyncRuns QbSyncRun[]
```

- [ ] **Step 3: Write the migration SQL** — create `prisma/migrations/20260612030000_qb_catalog_truth/migration.sql`:

```sql
-- QB catalog truth: membership flags + last-confirmed timestamp + sync-run audit.
-- Additive + live-safe: existing rows default to active=true (no behavior change
-- until the first QB feed runs). Out-of-stock has NO effect on `active`.
ALTER TABLE "Product" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN "activeOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "qbMatchedAt" TIMESTAMP(3);
CREATE INDEX "Product_tenantId_active_idx" ON "Product"("tenantId", "active");

CREATE TABLE "QbSyncRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "weak" INTEGER NOT NULL DEFAULT 0,
    "totalProducts" INTEGER NOT NULL DEFAULT 0,
    "aborted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "QbSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QbSyncRun_tenantId_at_idx" ON "QbSyncRun"("tenantId", "at");
ALTER TABLE "QbSyncRun" ADD CONSTRAINT "QbSyncRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply + regenerate** — STOP the dev server first (Supabase pooler connection cap — project gotcha):

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: "1 migration applied" (20260612030000_qb_catalog_truth) + "Generated Prisma Client".

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260612030000_qb_catalog_truth
git commit -m "feat(qb): schema for catalog-truth — Product.active/activeOverride/qbMatchedAt + QbSyncRun"
```

---

## Task 2: Pure flag logic (the decision heart) — TDD

**Files:**
- Create: `lib/qb/catalog-flags.ts`
- Test: `lib/qb/catalog-flags.test.ts`

- [ ] **Step 1: Write the failing tests** — `lib/qb/catalog-flags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeCatalogFlags, type CatalogProduct } from "./catalog-flags";

const p = (over: Partial<CatalogProduct>): CatalogProduct => ({
  id: "p", sku: "S", source: "shopify", active: true, activeOverride: false, ...over,
});

describe("computeCatalogFlags", () => {
  it("activates a product whose SKU is in the QB feed", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: "111" })], ["111"]);
    expect(r.activate).toEqual(["a"]);
    expect(r.deactivate).toEqual([]);
  });

  it("keeps an in-QB product active REGARDLESS of stock (stock plays no role)", () => {
    // No stock field exists in the input — proof that membership alone decides.
    const r = computeCatalogFlags([p({ id: "a", sku: "111" })], ["111"]);
    expect(r.activate).toContain("a");
    expect(r.deactivate).not.toContain("a");
  });

  it("deactivates a Shopify product missing from the feed", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: "999" })], ["111"]);
    expect(r.deactivate).toEqual(["a"]);
  });

  it("never deactivates an owner-pinned product (activeOverride)", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: "999", activeOverride: true })], ["111"]);
    expect(r.deactivate).toEqual([]);
  });

  it("never deactivates a non-shopify product (e.g. odoo) missing from the feed", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: "999", source: "odoo" })], ["111"]);
    expect(r.deactivate).toEqual([]);
  });

  it("matches SKU case-insensitively and trimmed", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: " AbC " })], ["abc"]);
    expect(r.activate).toEqual(["a"]);
  });

  it("ABORTS (no deactivations) when the feed would flag >60% of the Shopify catalog", () => {
    const prods = [
      p({ id: "a", sku: "1" }), p({ id: "b", sku: "2" }),
      p({ id: "c", sku: "3" }), p({ id: "d", sku: "4" }),
    ];
    // feed has only "1" → 3 of 4 (75%) would be flagged → abort
    const r = computeCatalogFlags(prods, ["1"]);
    expect(r.aborted).toBe(true);
    expect(r.deactivate).toEqual([]);
    expect(r.counts.flagged).toBe(0);
    expect(r.activate).toEqual(["a"]); // matched still reported
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/qb/catalog-flags.test.ts`
Expected: FAIL — "Failed to resolve import ./catalog-flags".

- [ ] **Step 3: Implement** — `lib/qb/catalog-flags.ts`:

```ts
/**
 * Pure decision for QB catalog-truth (Track A). Given the tenant's products and
 * the set of SKUs present in the latest QB feed, decide which products to confirm
 * active vs. soft-deactivate. Membership in the feed is the ONLY signal — stock is
 * deliberately absent so an out-of-stock-but-in-QB product can never be flagged.
 */
export type CatalogProduct = {
  id: string;
  sku: string;
  source: string;
  active: boolean;
  activeOverride: boolean;
};

export type CatalogFlagResult = {
  activate: string[];   // ids → set active=true + qbMatchedAt=now
  deactivate: string[]; // ids → set active=false
  aborted: boolean;     // guard tripped: feed looks partial/broken
  counts: { matched: number; flagged: number; totalShopify: number };
};

const norm = (s: string) => s.trim().toLowerCase();

export function computeCatalogFlags(
  products: CatalogProduct[],
  feedSkus: Iterable<string>,
  opts: { abortThreshold?: number } = {}
): CatalogFlagResult {
  const threshold = opts.abortThreshold ?? 0.6;
  const feed = new Set<string>();
  for (const s of feedSkus) {
    const k = norm(s);
    if (k) feed.add(k);
  }

  const activate: string[] = [];
  const deactivate: string[] = [];
  let totalShopify = 0;

  for (const prod of products) {
    if (prod.source === "shopify") totalShopify++;
    if (feed.has(norm(prod.sku))) {
      activate.push(prod.id); // confirm + refresh qbMatchedAt (idempotent)
    } else if (prod.source === "shopify" && !prod.activeOverride) {
      deactivate.push(prod.id);
    }
  }

  // A broken/partial QB pull must never nuke the catalog.
  const flaggedShare = totalShopify > 0 ? deactivate.length / totalShopify : 0;
  const aborted = flaggedShare > threshold;

  return {
    activate,
    deactivate: aborted ? [] : deactivate,
    aborted,
    counts: { matched: activate.length, flagged: aborted ? 0 : deactivate.length, totalShopify },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/qb/catalog-flags.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/qb/catalog-flags.ts lib/qb/catalog-flags.test.ts
git commit -m "feat(qb): pure computeCatalogFlags — membership-only, override-safe, >60% abort guard"
```

---

## Task 3: Feed ingest endpoint

**Files:**
- Create: `app/api/qb/catalog/route.ts`

- [ ] **Step 1: Implement the endpoint** — `app/api/qb/catalog/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { computeCatalogFlags } from "@/lib/qb/catalog-flags";

export const maxDuration = 120;

/**
 * POST /api/qb/catalog — system endpoint for the n8n "QuickBooks catalog feed".
 * Auth: `Authorization: Bearer <QB_FEED_SECRET>` (no user session). The feed is
 * the authoritative list of QB products, already matched to Shopify SKUs upstream.
 * Marks matched products active (+qbMatchedAt), soft-deactivates Shopify products
 * absent from the feed (unless owner-pinned), and records a QbSyncRun. Never
 * deletes; out-of-stock has no effect.
 */
const Body = z.object({
  slug: z.string().min(1),
  rows: z
    .array(
      z.object({
        sku: z.string(),
        qbName: z.string().optional(),
        qtyOnHand: z.number().optional(),
        cost: z.number().optional(),
        matchConfidence: z.number().optional(),
      })
    )
    .max(20000),
  weak: z.number().int().nonnegative().optional(),
});

export async function POST(req: NextRequest) {
  const secret = process.env.QB_FEED_SECRET;
  const authz = req.headers.get("authorization");
  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, rows, weak = 0 } = parsed.data;

  // eslint-disable-next-line tenant-safety/require-tenant-scope -- system feed resolves the tenant by slug + bearer secret
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return NextResponse.json({ error: "unknown shop" }, { status: 404 });

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, sku: true, source: true, active: true, activeOverride: true },
  });

  const { activate, deactivate, aborted, counts } = computeCatalogFlags(
    products,
    rows.map((r) => r.sku)
  );

  if (!aborted) {
    // Two batched writes — never a per-row loop (Vercel→Supabase timeout rule).
    if (activate.length) {
      await prisma.product.updateMany({
        where: { tenantId: tenant.id, id: { in: activate } },
        data: { active: true, qbMatchedAt: new Date() },
      });
    }
    if (deactivate.length) {
      await prisma.product.updateMany({
        where: { tenantId: tenant.id, id: { in: deactivate } },
        data: { active: false },
      });
    }
  }

  const run = await prisma.qbSyncRun.create({
    data: {
      tenantId: tenant.id,
      matched: counts.matched,
      flagged: counts.flagged,
      weak,
      totalProducts: products.length,
      aborted,
    },
  });

  return NextResponse.json({
    ok: !aborted,
    aborted,
    matched: counts.matched,
    flagged: counts.flagged,
    weak,
    totalProducts: products.length,
    runId: run.id,
    ...(aborted
      ? { warning: "Feed would flag >60% of the catalogue — treated as partial/broken. No changes applied." }
      : {}),
  });
}
```

- [ ] **Step 2: Add the secret to env** — append to `.env` (local) and set in Vercel:

```bash
echo "QB_FEED_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")" >> .env
```
Note for deploy: add the same `QB_FEED_SECRET` to Vercel project env (Production) before the n8n feed runs.

- [ ] **Step 3: Verify typecheck + a local smoke** — STOP the dev server is NOT needed (read+write via pooler is fine for a single request); start it: `npm run dev` (port 3082), then:

```bash
curl -s -X POST http://localhost:3082/api/qb/catalog \
  -H "Authorization: Bearer $(grep QB_FEED_SECRET .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"slug":"beauty-square","rows":[{"sku":"NONEXISTENT-SKU"}]}'
```
Expected: JSON with `aborted:true` (1 SKU vs full catalog → >60% would flag → guard trips, no writes) and a `warning`. This proves auth + guard without mutating data.

- [ ] **Step 4: Commit**

```bash
git add app/api/qb/catalog/route.ts .env
git commit -m "feat(qb): POST /api/qb/catalog feed ingest — bearer secret, batched flags, QbSyncRun + abort guard"
```
(Confirm `.env` is gitignored before committing; if so, drop it from the `git add` and just document the var.)

---

## Task 4: Forecasts skip inactive products

**Files:**
- Modify: `app/api/forecast/run/route.ts:16-19`
- Modify: `lib/forecast/run-batch.ts:30-31`

- [ ] **Step 1: Gate the manual rerun** — in `app/api/forecast/run/route.ts`, change the product query:

```ts
  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id, active: true },
    include: { supplier: true },
  });
```

- [ ] **Step 2: Gate the batch (cron) forecast** — in `lib/forecast/run-batch.ts` (~line 30):

```ts
  const products = await prisma.product.findMany({
    where: { tenantId, active: true },
```
(Keep the rest of the existing `select`/`include` unchanged — only add `active: true` to the `where`.)

- [ ] **Step 3: Verify typecheck + existing tests still pass**

Run: `npx tsc --noEmit && npx vitest run lib/forecast`
Expected: tsc clean; forecast suites green (flag adds no behavior for active=true rows — the default).

- [ ] **Step 4: Commit**

```bash
git add app/api/forecast/run/route.ts lib/forecast/run-batch.ts
git commit -m "feat(qb): forecasts skip active=false — flagged products drop off the buy list automatically"
```

---

## Task 5: Review surface + owner override

**Files:**
- Modify: `app/api/products/[id]/route.ts` (PATCH allow `active` + `activeOverride`)
- Create: `app/api/qb/flagged/route.ts`
- Create: `app/shop/[slug]/not-in-quickbooks/page.tsx`

- [ ] **Step 1: Extend the product PATCH** — in `app/api/products/[id]/route.ts`, widen the accepted body (the handler already does tenant-scoped `updateMany`). Replace the `data` type + assignment block:

```ts
  const body = await req.json().catch(() => ({}));
  const data: {
    supplierId?: string | null;
    leadTimeDays?: number | null;
    importCategory?: string | null;
    active?: boolean;
    activeOverride?: boolean;
  } = {};
  if ("supplierId" in body) data.supplierId = typeof body.supplierId === "string" ? body.supplierId : null;
  if ("leadTimeDays" in body) {
    const n = Number.parseInt(body.leadTimeDays, 10);
    data.leadTimeDays = Number.isFinite(n) && n > 0 ? n : null;
  }
  if ("importCategory" in body) {
    const v = typeof body.importCategory === "string" ? body.importCategory.toUpperCase() : null;
    data.importCategory = v === "LOCAL" || v === "KOREAN" || v === "WESTERN" ? v : null;
  }
  if ("active" in body) data.active = !!body.active;
  if ("activeOverride" in body) data.activeOverride = !!body.activeOverride;
```

- [ ] **Step 2: Create the flagged-list endpoint** — `app/api/qb/flagged/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/** GET /api/qb/flagged — products soft-flagged as "not in QuickBooks" (active=false),
 *  with the signals an owner needs to decide whether to keep them. Tenant-scoped,
 *  read-only (any member; the review link lives on the owner-only Settings card). */
export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id, active: false },
    select: { id: true, title: true, sku: true, vendor: true, currentStock: true, activeOverride: true },
    orderBy: { title: "asc" },
  });

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);
  const sales = await prisma.salesHistory.groupBy({
    by: ["productId"],
    where: { tenantId: tenant.id, date: { gte: since } },
    _sum: { quantity: true },
  });
  const sold90 = new Map(sales.map((s) => [s.productId, s._sum.quantity ?? 0]));

  return NextResponse.json({
    products: products.map((p) => ({ ...p, sold90: sold90.get(p.id) ?? 0 })),
  });
}
```

- [ ] **Step 3: Create the review page** — `app/shop/[slug]/not-in-quickbooks/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type Flagged = {
  id: string; title: string; sku: string; vendor: string | null;
  currentStock: number; activeOverride: boolean; sold90: number;
};

export default function NotInQuickBooksPage() {
  const { slug } = useParams<{ slug: string }>();
  const [rows, setRows] = useState<Flagged[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await apiFetch(slug, "/api/qb/flagged").then((x) => (x.ok ? x.json() : { products: [] }));
    setRows(r.products ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function keepActive(id: string) {
    setBusy(id);
    try {
      await apiFetch(slug, `/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true, activeOverride: true }),
      });
      await load();
    } finally { setBusy(null); }
  }

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 py-7">
        <div className="mb-6">
          <div className="text-2xs uppercase tracking-wider text-mute">Catalogue review</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">Not in QuickBooks</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-2xl">
            QuickBooks has no record of these products, so they&apos;re held out of the buy list.
            Out-of-stock items still in QB are NOT here. If one is real, keep it active.
          </p>
        </div>

        {loading ? (
          <div className="skeleton h-40" />
        ) : rows.length === 0 ? (
          <div className="card p-8 text-center text-sm text-mute">
            Nothing flagged — every product is in QuickBooks.{" "}
            <Link href={`/shop/${slug}/dashboard`} className="text-accent-700 hover:underline">Back to dashboard</Link>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-line text-2xs uppercase tracking-wider text-mute">
              {rows.length} flagged
            </div>
            <div className="divide-y divide-line max-h-[70vh] overflow-y-auto">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <Link href={`/shop/${slug}/dashboard/product/${r.id}`} className="text-sm font-medium truncate block hover:underline">
                      {r.title}
                    </Link>
                    <div className="text-2xs text-mute num">
                      {r.sku} · {r.vendor || "—"} · stock {r.currentStock.toFixed(0)} · 90d sold {r.sold90.toFixed(0)}
                    </div>
                  </div>
                  <button
                    onClick={() => keepActive(r.id)}
                    disabled={busy === r.id}
                    className="btn-ghost text-sm disabled:opacity-50 shrink-0"
                  >
                    {busy === r.id ? "…" : "Keep active"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit`; then with `npm run dev`, visit `/shop/beauty-square/not-in-quickbooks` (signed in as owner): the page renders (empty until a feed flags anything). PATCH a product manually to `active:false` via the catalog endpoint test to see a row appear, then "Keep active" clears it.

- [ ] **Step 5: Commit**

```bash
git add app/api/products/[id]/route.ts app/api/qb/flagged/route.ts "app/shop/[slug]/not-in-quickbooks/page.tsx"
git commit -m "feat(qb): Not-in-QuickBooks review page + Keep-active override (PATCH active/activeOverride)"
```

---

## Task 6: Settings — QuickBooks (clean data) card

**Files:**
- Create: `app/api/qb/status/route.ts`
- Modify: `app/shop/[slug]/settings/page.tsx` (add a card in the `<div className="space-y-4">` stack, after the Cost-of-goods card)

- [ ] **Step 1: Create the status endpoint** — `app/api/qb/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/** GET /api/qb/status — last QB feed run + current flagged count (Settings card). */
export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const [last, flaggedNow] = await Promise.all([
    prisma.qbSyncRun.findFirst({ where: { tenantId: tenant.id }, orderBy: { at: "desc" } }),
    prisma.product.count({ where: { tenantId: tenant.id, active: false } }),
  ]);
  return NextResponse.json({ last, flaggedNow });
}
```

- [ ] **Step 2: Add the card component** — in `app/shop/[slug]/settings/page.tsx`, add this component (near `CostUploadCard`) and render `<QuickBooksCard slug={slug} />` immediately after `<CostUploadCard slug={slug} />` in the JSX stack:

```tsx
type QbStatus = {
  last: { at: string; matched: number; flagged: number; weak: number; totalProducts: number; aborted: boolean } | null;
  flaggedNow: number;
};

function QuickBooksCard({ slug }: { slug: string }) {
  const [s, setS] = useState<QbStatus | null>(null);
  useEffect(() => {
    apiFetch(slug, "/api/qb/status").then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null));
  }, [slug]);

  return (
    <Section
      title="QuickBooks (clean data)"
      description="QuickBooks decides which products are real. The n8n catalogue feed POSTs here; products QuickBooks doesn't have are held out of the buy list (never deleted, never on stock level)."
    >
      {s?.last ? (
        <div className="text-sm text-ink-soft">
          Last sync {new Date(s.last.at).toLocaleString()} · <span className="num">{s.last.matched}</span> matched ·{" "}
          <span className="num">{s.flaggedNow}</span> held out
          {s.last.weak > 0 && <> · <span className="num">{s.last.weak}</span> weak matches</>}
          {s.last.aborted && <span className="text-status-warn"> · last feed refused (looked partial)</span>}
        </div>
      ) : (
        <div className="text-sm text-mute">No QuickBooks feed yet. Wire the n8n catalogue feed to <span className="num">POST /api/qb/catalog</span>.</div>
      )}
      {(s?.flaggedNow ?? 0) > 0 && (
        <Link href={`/shop/${slug}/not-in-quickbooks`} className="inline-block mt-3 text-2xs font-medium text-accent-700 hover:underline">
          Review {s?.flaggedNow} not in QuickBooks →
        </Link>
      )}
    </Section>
  );
}
```
(`useState`, `useEffect`, `Link`, `apiFetch`, `Section` are already imported in this file.)

- [ ] **Step 3: Verify** — `npx tsc --noEmit`; `npm run dev` → Settings shows the QuickBooks card ("No QuickBooks feed yet" until the first run).

- [ ] **Step 4: Commit**

```bash
git add app/api/qb/status/route.ts "app/shop/[slug]/settings/page.tsx"
git commit -m "feat(qb): Settings QuickBooks (clean data) card + GET /api/qb/status"
```

---

## Task 7: n8n build-prompt deliverable

**Files:**
- Create: `docs/n8n-qb-catalog-feed-prompt.md`

- [ ] **Step 1: Write the build-prompt** — `docs/n8n-qb-catalog-feed-prompt.md`:

````markdown
# n8n build-prompt — QuickBooks → Wezesha catalogue feed

Reuses the existing QuickBooks credential on the Beauty Square reconciliation
workflows. Matches QB items → Shopify by NAME (QB's SKU is empty), then POSTs a
SKU-keyed feed to Wezesha, which decides what's "real". Weak matches are reported,
not asserted.

## Prompt

> Build an n8n workflow "Beauty Square — QuickBooks → Wezesha catalogue feed".
>
> 1. Schedule Trigger (daily) + Manual Trigger.
> 2. QuickBooks node (existing credential): `resource: item, operation: getAll, returnAll: true`.
> 3. HTTP Request → Shopify GraphQL: page all product variants (`sku`, `product{title}`),
>    same pattern as the recon workflow's "Pull Shopify" node. Build a name→sku map.
> 4. Code node "Match": for each QB item, normalise its `Name` and look up the Shopify
>    variant by exact normalised title; if no exact hit, take the best token-overlap match
>    and mark it `weak` when overlap < 55% (same scoring as the recon workflow). Emit
>    `{ sku, qbName, qtyOnHand: it.QtyOnHand, cost: it.PurchaseCost, matchConfidence }`
>    only for confident matches; count the weak ones.
> 5. HTTP Request → `POST https://wezesha-restock-os.vercel.app/api/qb/catalog`
>    header `Authorization: Bearer <QB_FEED_SECRET>`, JSON body
>    `{ "slug": "beauty-square", "rows": [...], "weak": <count> }`.
>
> Notes: send the FULL QB item list every run (the endpoint's >60% guard rejects a
> partial pull). `slug` is the shop slug in Wezesha. Cost is optional here (Wezesha
> already has a cost upload) — include it if easy.
````

- [ ] **Step 2: Commit**

```bash
git add docs/n8n-qb-catalog-feed-prompt.md
git commit -m "docs(qb): n8n QuickBooks→Wezesha catalogue feed build-prompt"
```

---

## Final verification (whole feature)

- [ ] `npx tsc --noEmit` → clean
- [ ] `npm run lint` → 0 errors
- [ ] `npx vitest run` → green (includes the 7 new flag tests)
- [ ] End-to-end on prod-like data:
  1. Migration applied; existing products all `active=true` (no behavior change).
  2. POST a feed with a realistic SKU set → response `matched`/`flagged` sane, a `QbSyncRun` row exists, NOT aborted.
  3. A product in the feed but `currentStock=0` stays `active=true` (the locked rule).
  4. A Shopify product absent from the feed → `active=false` → run `forecast/run` → it's gone from dashboard/planner; visible on `/not-in-quickbooks`.
  5. "Keep active" on one flagged product → returns to the buy list and survives the next feed (activeOverride).
  6. Partial feed (few SKUs) → `aborted:true`, no products deactivated.
  7. Settings QuickBooks card shows last-sync counts + the review link.

## Deferred (explicitly not in this plan)

- QB-driven **stock override** (stock stays Shopify).
- **Cost via the feed** (COGS upload already covers it; feed `cost` is accepted but not yet written).
- **Dellwest POS sales** (Track B — separate spec; needs Dellwest to whitelist the puller's IP).
