# Nightly Shopify Reconcile + Inventory-Position View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ABC-grouped inventory-position table to the Reports page (run rate, opening, current, en-route, lead time, days-cover) backed by a new inventory snapshot, then a nightly incremental Shopify reconcile that keeps catalog/inventory/sales fresh and feeds the snapshot history.

**Architecture:** Two features, one shared primitive (`snapshotInventory`). Part A (view) ships first using data already in the DB plus a new `InventorySnapshot` table. Part B (reconcile) adds incremental, cursor-driven, idempotent nightly sync (paginated GraphQL, not Bulk Ops) that calls the same snapshot primitive and re-runs forecasts. Pure logic (position builder, window math, sales bucketing) is extracted into unit-tested functions; DB/HTTP wrappers stay thin and are verified live (matches the repo's pure-vitest convention — no DB test harness exists).

**Tech Stack:** Next.js 16 (App Router), Prisma 6 + Supabase Postgres, TypeScript strict, vitest 4, raw-fetch Shopify Admin client (`lib/shopify/shopify.ts`, client-credentials grant), tenant-safety ESLint rule.

---

## Spec

Source spec: `docs/superpowers/specs/2026-06-05-shopify-reconcile-and-inventory-position-design.md`.

Two deviations from the spec, decided while reading the code (both improvements):
- **Run rate** is computed from `SalesHistory` (trailing-window average), NOT `Product.dailySalesRate` — that field is never set on ingested products (only `abcCategory` is written by forecast-run), so it is 0 for all real products.
- A `runForecastsForTenant(tenantId)` lib is extracted from `scripts/run-forecasts.ts` so reconcile can re-forecast without duplicating ~120 lines.

## File Structure

**Part A — Inventory-Position View**
- Modify `prisma/schema.prisma` — add `InventorySnapshot` model + back-relations on `Tenant` and `Product`.
- Create `prisma/migrations/<ts>_add_inventory_snapshot/migration.sql` — additive migration (diff+deploy).
- Create `lib/inventory/snapshot.ts` — `utcDayKey(date)` (pure) + `snapshotInventory(tenantId)` (DB upsert).
- Create `lib/inventory/snapshot.test.ts` — `utcDayKey` unit tests.
- Create `lib/inventory/position.ts` — pure `buildPositionView(input)` + `resolveOpening(...)` + `daysOfCover(...)`.
- Create `lib/inventory/position.test.ts` — grouping, opening (measured vs estimate), days-cover.
- Create `app/api/inventory-position/route.ts` — tenant-scoped aggregation endpoint.
- Modify `scripts/run-forecasts.ts` — call `snapshotInventory` after the run (see Part B Task B4 for the extraction; in Part A we add the snapshot call to the existing script body).
- Modify `app/shop/[slug]/reports/page.tsx` — add the "Inventory Position" section.

**Part B — Nightly Reconcile**
- Create `lib/shopify/paginate.ts` — cursor-paginated GraphQL helpers + product/order/inventory query strings.
- Create `lib/shopify/reconcile-window.ts` — pure `computeWindowStart(...)`.
- Create `lib/shopify/reconcile-window.test.ts` — day-align / overlap / first-run.
- Create `lib/shopify/sales-window.ts` — pure `bucketSalesByProductDay(...)` + DB `applySalesForWindow(...)`.
- Create `lib/shopify/sales-window.test.ts` — aggregation + idempotency-by-construction.
- Create `lib/forecast/run-batch.ts` — `runForecastsForTenant(tenantId)` (extracted).
- Modify `scripts/run-forecasts.ts` — delegate to `runForecastsForTenant`.
- Modify `app/api/forecast/run/route.ts` — (optional consistency) delegate to `runForecastsForTenant`. **Out of scope unless trivial; leave as-is if it risks behavior change.**
- Create `lib/shopify/reconcile.ts` — `reconcileTenant(tenantId)`.
- Create `scripts/shopify-reconcile.ts` — local CLI trigger.
- Create `app/api/cron/reconcile/route.ts` — `CRON_SECRET`-auth + per-tenant loop.
- Create `vercel.json` — nightly cron (dormant until deploy).

---

## IMPORTANT — environment rules (read once)

- **Stop the dev server** (`localhost:3082`) before any `prisma migrate` or `tsx` DB script — Supabase free-tier session pooler has a tight connection cap; otherwise you get `Can't reach database server`.
- **Migrations:** never `prisma migrate dev` (blocks on data-loss prompts). Use `prisma migrate diff … --script` then `prisma migrate deploy` (see Task A1).
- **Prisma client:** import the singleton `import { prisma } from "@/lib/prisma"` in app/lib code. Scripts may use `new PrismaClient()` (existing convention) but prefer the singleton.
- **Tenant safety:** EVERY Prisma query MUST carry `tenantId` in its `where`/`data`, or the tenant-safety ESLint rule fails `npm run lint`. All queries in this plan do.
- **API route tenant resolution:** `const ctx = await requireTenantOrResponse(); if (ctx instanceof NextResponse) return ctx;` then use `ctx.tenant.id`.
- **Commits:** end each commit message with the repo's trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

# PART A — Inventory-Position View

### Task A1: Add `InventorySnapshot` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_inventory_snapshot/migration.sql`

- [ ] **Step 1: Add the model + back-relations to `prisma/schema.prisma`**

Append this model (place it near `InventoryLevel`):

```prisma
model InventorySnapshot {
  id        String   @id @default(cuid())
  tenantId  String
  productId String
  date      DateTime // UTC midnight of the snapshot day
  onHand    Float

  tenant  Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, date])
  @@index([tenantId, date])
}
```

Add the back-relation field to `model Tenant` (alongside its other relations):

```prisma
  inventorySnapshots InventorySnapshot[]
```

Add the back-relation field to `model Product` (alongside `inventoryLevels`):

```prisma
  inventorySnapshots InventorySnapshot[]
```

- [ ] **Step 2: Validate the schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Stop the dev server, generate the migration SQL**

Ensure `npm run dev` is NOT running. Then create the migration folder and diff:

```bash
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_add_inventory_snapshot"
# Use a fixed name if `date` is awkward on Windows bash; e.g. 20260605120000_add_inventory_snapshot
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "prisma/migrations/20260605120000_add_inventory_snapshot/migration.sql"
```

- [ ] **Step 4: Verify the migration is additive-only**

Run: `grep -E "DROP TABLE|DROP COLUMN|DELETE FROM" prisma/migrations/20260605120000_add_inventory_snapshot/migration.sql`
Expected: no output (additive only — one `CREATE TABLE "InventorySnapshot"`, indexes, FKs).

- [ ] **Step 5: Apply the migration + regenerate client**

```bash
npx prisma migrate deploy
npx prisma generate
```
Expected: `migrate deploy` reports the new migration applied; `generate` succeeds.

- [ ] **Step 6: Confirm the table exists (read-only)**

Run:
```bash
npx tsx -e "import 'dotenv/config';import{prisma}from'./lib/prisma';prisma.inventorySnapshot.count().then(c=>{console.log('snapshots='+c);process.exit(0)})"
```
Expected: `snapshots=0`

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(inventory): add InventorySnapshot model + additive migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: Snapshot primitive (`snapshotInventory`)

**Files:**
- Create: `lib/inventory/snapshot.ts`
- Test: `lib/inventory/snapshot.test.ts`

- [ ] **Step 1: Write the failing test for the pure day-key helper**

`lib/inventory/snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { utcDayKey } from "./snapshot";

describe("utcDayKey", () => {
  it("floors a timestamp to UTC midnight", () => {
    const d = utcDayKey(new Date("2026-06-05T14:33:09.123Z"));
    expect(d.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("is idempotent (already-midnight stays midnight)", () => {
    const d = utcDayKey(new Date("2026-06-05T00:00:00.000Z"));
    expect(d.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("uses the UTC day even for late-evening local times", () => {
    const d = utcDayKey(new Date("2026-06-05T23:59:59.000Z"));
    expect(d.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/inventory/snapshot.test.ts`
Expected: FAIL — `utcDayKey` is not exported / module not found.

- [ ] **Step 3: Implement `lib/inventory/snapshot.ts`**

```ts
/**
 * Inventory snapshot primitive (shared by forecast-run and the nightly reconcile).
 *
 * Writes one row per product for TODAY (UTC midnight key) holding the current
 * on-hand. Idempotent on (productId, date): re-running the same day overwrites,
 * never duplicates. The inventory-position view reads these as "opening stock"
 * at a window's start.
 */
import { prisma } from "@/lib/prisma";

/** Floor a Date to UTC midnight (the snapshot day key). */
export function utcDayKey(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Upsert today's on-hand snapshot for every product of a tenant. */
export async function snapshotInventory(tenantId: string): Promise<{ count: number }> {
  const day = utcDayKey(new Date());
  const products = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, currentStock: true },
  });
  for (const p of products) {
    await prisma.inventorySnapshot.upsert({
      where: { productId_date: { productId: p.id, date: day } },
      create: { tenantId, productId: p.id, date: day, onHand: p.currentStock },
      update: { onHand: p.currentStock },
    });
  }
  return { count: products.length };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/inventory/snapshot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "inventory/snapshot" || echo "snapshot typecheck clean"`
Expected: `snapshot typecheck clean`

- [ ] **Step 6: Commit**

```bash
git add lib/inventory/snapshot.ts lib/inventory/snapshot.test.ts
git commit -m "feat(inventory): snapshotInventory primitive + utcDayKey tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: Wire snapshot into forecast-run + seed today's snapshot

**Files:**
- Modify: `scripts/run-forecasts.ts`

- [ ] **Step 1: Import the primitive in `scripts/run-forecasts.ts`**

Add to the imports at the top:

```ts
import { snapshotInventory } from "../lib/inventory/snapshot";
```

- [ ] **Step 2: Call it at the end of `main()`**

Immediately before the final `console.log(\`Done. ...\`)` line, add:

```ts
  const snap = await snapshotInventory(tenant.id);
  console.log(`Inventory snapshot written for ${snap.count} products.`);
```

- [ ] **Step 3: Run it live to seed today's snapshot (dev server stopped)**

Run: `npx tsx scripts/run-forecasts.ts`
Expected: ends with `Inventory snapshot written for 1100 products.` (count may differ).

- [ ] **Step 4: Verify snapshots exist (read-only)**

Run:
```bash
npx tsx -e "import 'dotenv/config';import{prisma}from'./lib/prisma';prisma.inventorySnapshot.count().then(c=>{console.log('snapshots='+c);process.exit(0)})"
```
Expected: `snapshots=1100` (≈ product count).

- [ ] **Step 5: Commit**

```bash
git add scripts/run-forecasts.ts
git commit -m "feat(inventory): snapshot on-hand after each forecast run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A4: Pure position builder + tests

**Files:**
- Create: `lib/inventory/position.ts`
- Test: `lib/inventory/position.test.ts`

This is the unit-tested core: grouping by ABC, opening resolution (measured snapshot vs estimate), run rate, days-of-cover.

- [ ] **Step 1: Write the failing test `lib/inventory/position.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveOpening, daysOfCover, buildPositionView, type PositionInput } from "./position";

describe("resolveOpening", () => {
  it("uses the measured snapshot when one exists at/before the window start", () => {
    const r = resolveOpening({
      snapshotOnHand: 80,
      currentStock: 50,
      soldInWindow: 40,
    });
    expect(r).toEqual({ openingOnHand: 80, openingEstimated: false });
  });

  it("estimates opening = current + sold when no snapshot exists", () => {
    const r = resolveOpening({
      snapshotOnHand: null,
      currentStock: 50,
      soldInWindow: 40,
    });
    expect(r).toEqual({ openingOnHand: 90, openingEstimated: true });
  });
});

describe("daysOfCover", () => {
  it("divides on-hand by the daily run rate", () => {
    expect(daysOfCover(100, 5)).toBe(20);
  });
  it("returns null when run rate is zero (no false infinity)", () => {
    expect(daysOfCover(100, 0)).toBeNull();
  });
});

describe("buildPositionView", () => {
  const base: PositionInput = {
    windowDays: 30,
    rows: [
      { productId: "p1", title: "A-item", sku: "1", abc: "A", currentStock: 60, onOrder: 10,
        expectedArrivalAt: null, leadTimeAvgDays: 30, leadTimeStdDays: 7,
        soldInWindow: 90, snapshotOnHand: 120 },
      { productId: "p2", title: "C-item", sku: "2", abc: null, currentStock: 5, onOrder: 0,
        expectedArrivalAt: null, leadTimeAvgDays: null, leadTimeStdDays: null,
        soldInWindow: 0, snapshotOnHand: null },
    ],
  };

  it("computes run rate as soldInWindow / windowDays", () => {
    const v = buildPositionView(base);
    const a = v.groups.A.rows[0];
    expect(a.runRate).toBeCloseTo(3); // 90 / 30
  });

  it("groups a null abc under C", () => {
    const v = buildPositionView(base);
    expect(v.groups.C.rows.map(r => r.productId)).toContain("p2");
    expect(v.groups.A.rows.map(r => r.productId)).toContain("p1");
  });

  it("produces group subtotals (count, opening, current, enRoute)", () => {
    const v = buildPositionView(base);
    expect(v.groups.A.subtotal).toEqual({
      count: 1, opening: 120, current: 60, enRoute: 10,
    });
  });

  it("flags estimated opening on the C-item with no snapshot", () => {
    const v = buildPositionView(base);
    const c = v.groups.C.rows[0];
    expect(c.openingEstimated).toBe(true);
    expect(c.openingOnHand).toBe(5); // 5 current + 0 sold
  });

  it("days-of-cover is null when the item has no sales (run rate 0)", () => {
    const v = buildPositionView(base);
    expect(v.groups.C.rows[0].daysOfCover).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/inventory/position.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/inventory/position.ts`**

```ts
/**
 * Pure inventory-position view builder. No Prisma, no Next — the API route fetches
 * rows and hands them here. Run rate is derived from sales over the window (the
 * Product.dailySalesRate field is unset on ingested products, so we do not use it).
 */

export type Abc = "A" | "B" | "C";

export type PositionRowInput = {
  productId: string;
  title: string;
  sku: string;
  abc: Abc | null;
  currentStock: number;
  onOrder: number;
  expectedArrivalAt: Date | string | null;
  leadTimeAvgDays: number | null;
  leadTimeStdDays: number | null;
  soldInWindow: number;
  /** On-hand from the snapshot at/just-before the window start, or null if none. */
  snapshotOnHand: number | null;
};

export type PositionInput = {
  windowDays: number;
  rows: PositionRowInput[];
};

export type PositionRow = {
  productId: string;
  title: string;
  sku: string;
  runRate: number;
  openingOnHand: number;
  openingEstimated: boolean;
  currentStock: number;
  onOrder: number;
  expectedArrivalAt: string | null;
  leadTimeAvgDays: number | null;
  leadTimeStdDays: number | null;
  daysOfCover: number | null;
};

export type PositionGroup = {
  rows: PositionRow[];
  subtotal: { count: number; opening: number; current: number; enRoute: number };
};

export type PositionView = {
  windowDays: number;
  groups: Record<Abc, PositionGroup>;
};

export function resolveOpening(input: {
  snapshotOnHand: number | null;
  currentStock: number;
  soldInWindow: number;
}): { openingOnHand: number; openingEstimated: boolean } {
  if (input.snapshotOnHand !== null) {
    return { openingOnHand: input.snapshotOnHand, openingEstimated: false };
  }
  return { openingOnHand: input.currentStock + input.soldInWindow, openingEstimated: true };
}

export function daysOfCover(onHand: number, dailyRate: number): number | null {
  if (dailyRate <= 0) return null;
  return onHand / dailyRate;
}

export function buildPositionView(input: PositionInput): PositionView {
  const empty = (): PositionGroup => ({
    rows: [],
    subtotal: { count: 0, opening: 0, current: 0, enRoute: 0 },
  });
  const groups: Record<Abc, PositionGroup> = { A: empty(), B: empty(), C: empty() };

  for (const r of input.rows) {
    const abc: Abc = r.abc === "A" || r.abc === "B" ? r.abc : "C";
    const runRate = input.windowDays > 0 ? r.soldInWindow / input.windowDays : 0;
    const { openingOnHand, openingEstimated } = resolveOpening({
      snapshotOnHand: r.snapshotOnHand,
      currentStock: r.currentStock,
      soldInWindow: r.soldInWindow,
    });
    const eta =
      r.expectedArrivalAt == null
        ? null
        : typeof r.expectedArrivalAt === "string"
          ? r.expectedArrivalAt
          : r.expectedArrivalAt.toISOString();

    const row: PositionRow = {
      productId: r.productId,
      title: r.title,
      sku: r.sku,
      runRate,
      openingOnHand,
      openingEstimated,
      currentStock: r.currentStock,
      onOrder: r.onOrder,
      expectedArrivalAt: eta,
      leadTimeAvgDays: r.leadTimeAvgDays,
      leadTimeStdDays: r.leadTimeStdDays,
      daysOfCover: daysOfCover(r.currentStock, runRate),
    };

    const g = groups[abc];
    g.rows.push(row);
    g.subtotal.count += 1;
    g.subtotal.opening += openingOnHand;
    g.subtotal.current += r.currentStock;
    g.subtotal.enRoute += r.onOrder;
  }

  // Sort each group by run rate desc (fastest movers first).
  for (const k of ["A", "B", "C"] as const) {
    groups[k].rows.sort((a, b) => b.runRate - a.runRate);
  }

  return { windowDays: input.windowDays, groups };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/inventory/position.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/inventory/position.ts lib/inventory/position.test.ts
git commit -m "feat(inventory): pure ABC position builder (run rate, opening, days-cover)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A5: `/api/inventory-position` endpoint

**Files:**
- Create: `app/api/inventory-position/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { buildPositionView, type PositionRowInput, type Abc } from "@/lib/inventory/position";
import { utcDayKey } from "@/lib/inventory/snapshot";

export async function GET(req: NextRequest) {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const tenantId = ctx.tenant.id;

  const windowDays = Math.max(
    1,
    Math.min(365, Number.parseInt(req.nextUrl.searchParams.get("window") ?? "30", 10) || 30)
  );

  const now = new Date();
  const windowStart = utcDayKey(new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000));

  const [products, salesAgg, snapshots, trackingSince] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId },
      select: {
        id: true, title: true, sku: true, abcCategory: true, currentStock: true,
        onOrder: true, expectedArrivalAt: true,
        supplier: { select: { leadTimeAvgDays: true, leadTimeStdDays: true } },
      },
    }),
    prisma.salesHistory.groupBy({
      by: ["productId"],
      where: { tenantId, date: { gte: windowStart } },
      _sum: { quantity: true },
    }),
    // The snapshot at/just-before the window start, per product (opening stock).
    prisma.inventorySnapshot.findMany({
      where: { tenantId, date: { lte: windowStart } },
      orderBy: { date: "desc" },
      select: { productId: true, onHand: true, date: true },
    }),
    prisma.inventorySnapshot.findFirst({
      where: { tenantId },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
  ]);

  const soldByProduct = new Map(salesAgg.map((s) => [s.productId, s._sum.quantity ?? 0]));

  // First (most recent ≤ windowStart) snapshot per product.
  const openingByProduct = new Map<string, number>();
  for (const s of snapshots) {
    if (!openingByProduct.has(s.productId)) openingByProduct.set(s.productId, s.onHand);
  }

  const rows: PositionRowInput[] = products.map((p) => ({
    productId: p.id,
    title: p.title,
    sku: p.sku,
    abc: (p.abcCategory as Abc | null) ?? null,
    currentStock: p.currentStock,
    onOrder: p.onOrder,
    expectedArrivalAt: p.expectedArrivalAt,
    leadTimeAvgDays: p.supplier?.leadTimeAvgDays ?? null,
    leadTimeStdDays: p.supplier?.leadTimeStdDays ?? null,
    soldInWindow: soldByProduct.get(p.id) ?? 0,
    snapshotOnHand: openingByProduct.get(p.id) ?? null,
  }));

  const view = buildPositionView({ windowDays, rows });
  return NextResponse.json({ ...view, trackingSince: trackingSince?.date ?? null });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "inventory-position" || echo "route typecheck clean"`
Expected: `route typecheck clean`

- [ ] **Step 3: Lint (tenant-safety gate)**

Run: `npm run lint 2>&1 | tail -5`
Expected: `0 errors` (warnings pre-existing are fine).

- [ ] **Step 4: Commit**

```bash
git add app/api/inventory-position/route.ts
git commit -m "feat(inventory): /api/inventory-position aggregation endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A6: Reports-page "Inventory Position" section

**Files:**
- Modify: `app/shop/[slug]/reports/page.tsx`

The page is a client component using `apiFetch(slug, path)`. Add a second fetch + a section. Keep it self-contained.

- [ ] **Step 1: Add types + state for the position view**

Near the other `type` declarations at the top of the file, add:

```ts
type PositionRow = {
  productId: string; title: string; sku: string; runRate: number;
  openingOnHand: number; openingEstimated: boolean; currentStock: number;
  onOrder: number; expectedArrivalAt: string | null;
  leadTimeAvgDays: number | null; leadTimeStdDays: number | null; daysOfCover: number | null;
};
type PositionGroup = { rows: PositionRow[]; subtotal: { count: number; opening: number; current: number; enRoute: number } };
type PositionView = { windowDays: number; groups: { A: PositionGroup; B: PositionGroup; C: PositionGroup }; trackingSince: string | null };
```

Inside `ReportsPage()`, after the existing `data`/`loading` state:

```ts
  const [position, setPosition] = useState<PositionView | null>(null);
  const [posWindow, setPosWindow] = useState(30);
```

- [ ] **Step 2: Fetch the position view (re-fetch when the window changes)**

Add a second `useEffect` after the existing one:

```ts
  useEffect(() => {
    apiFetch(slug, `/api/inventory-position?window=${posWindow}`)
      .then((r) => r.json())
      .then((d) => setPosition(d))
      .catch(() => setPosition(null));
  }, [posWindow]);
```

- [ ] **Step 3: Render the section**

Add this block inside the page's main content (after the ABC counts block; if unsure, place it just before the closing `</main>`). It uses the existing design tokens (`bg-card`, `border-line`, `text-mute`, `text-ink`) and the `KES`/number helpers already in the file:

```tsx
{position && (
  <section className="max-w-7xl mx-auto px-5 sm:px-8 py-8">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-ink">Inventory Position</h2>
      <div className="flex gap-1">
        {[30, 60, 90].map((w) => (
          <button
            key={w}
            onClick={() => setPosWindow(w)}
            className={`text-2xs px-2 py-1 rounded border ${
              posWindow === w ? "border-ink text-ink" : "border-line text-mute"
            }`}
          >
            {w}d
          </button>
        ))}
      </div>
    </div>
    {position.trackingSince ? (
      <p className="text-2xs text-mute mb-3">
        Opening measured since {new Date(position.trackingSince).toLocaleDateString("en-KE")}; older windows estimated (~).
      </p>
    ) : (
      <p className="text-2xs text-mute mb-3">Opening-stock tracking starts today; openings shown are estimates (~).</p>
    )}
    {(["A", "B", "C"] as const).map((g) => {
      const grp = position.groups[g];
      if (!grp || grp.rows.length === 0) return null;
      return (
        <div key={g} className="mb-6">
          <div className="flex items-center gap-3 text-xs text-mute mb-1">
            <span className="font-semibold text-ink">Class {g}</span>
            <span>{grp.subtotal.count} SKUs</span>
            <span>opening {Math.round(grp.subtotal.opening)}</span>
            <span>on-hand {Math.round(grp.subtotal.current)}</span>
            <span>en route {Math.round(grp.subtotal.enRoute)}</span>
          </div>
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-2xs">
              <thead className="text-mute">
                <tr className="border-b border-line">
                  <th className="text-left p-2">Product</th>
                  <th className="text-right p-2">Run/day</th>
                  <th className="text-right p-2">Opening</th>
                  <th className="text-right p-2">On-hand</th>
                  <th className="text-right p-2">En route</th>
                  <th className="text-right p-2">Lead (d)</th>
                  <th className="text-right p-2">Days cover</th>
                </tr>
              </thead>
              <tbody>
                {grp.rows.map((r) => {
                  const atRisk =
                    r.daysOfCover !== null && r.leadTimeAvgDays !== null && r.daysOfCover < r.leadTimeAvgDays;
                  return (
                    <tr key={r.productId} className="border-b border-line/50">
                      <td className="p-2 text-ink">{r.title}</td>
                      <td className="p-2 text-right">{r.runRate.toFixed(2)}</td>
                      <td className="p-2 text-right">
                        {Math.round(r.openingOnHand)}{r.openingEstimated ? "~" : ""}
                      </td>
                      <td className="p-2 text-right">{Math.round(r.currentStock)}</td>
                      <td className="p-2 text-right">
                        {r.onOrder}
                        {r.expectedArrivalAt ? ` (${new Date(r.expectedArrivalAt).toLocaleDateString("en-KE")})` : ""}
                      </td>
                      <td className="p-2 text-right">
                        {r.leadTimeAvgDays == null ? "—" : `${r.leadTimeAvgDays}±${r.leadTimeStdDays ?? 0}`}
                      </td>
                      <td className={`p-2 text-right ${atRisk ? "text-red-500 font-semibold" : ""}`}>
                        {r.daysOfCover == null ? "—" : Math.round(r.daysOfCover)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    })}
  </section>
)}
```

> Note: if a token class name (e.g. `bg-card`, `text-ink`, `border-line`, `text-mute`, `text-2xs`) does not exist in `app/globals.css`, substitute the nearest existing token used elsewhere in this same file. Do NOT invent new tokens.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "reports/page" || echo "reports page typecheck clean"`
Expected: `reports page typecheck clean`
Run: `npm run lint 2>&1 | tail -5`
Expected: `0 errors`.

- [ ] **Step 5: Commit**

```bash
git add app/shop/[slug]/reports/page.tsx
git commit -m "feat(inventory): ABC inventory-position section on Reports page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A7: Live verification of the view

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (serves `http://localhost:3082`).

- [ ] **Step 2: Hit the endpoint with the authed session**

In the browser, open `http://localhost:3082/shop/beauty-square/reports` and scroll to "Inventory Position". Confirm:
- Three class groups render with subtotals.
- Run/day is non-zero for products that sold; days-cover shows numbers (or "—" for no-sales SKUs).
- Opening values show "~" (estimated) for the 30d window today, since tracking just started.
- At-risk days-cover cells (cover < lead time) are highlighted.

- [ ] **Step 3: Sanity-check the JSON shape (optional, read-only)**

With the dev server up and a valid session cookie, the page fetch is the source of truth; no separate curl needed. If a row looks wrong, inspect `position.groups` in the browser devtools network tab.

- [ ] **Step 4: Stop the dev server** before any further DB scripts.

Part A complete. The view is live.

---

# PART B — Nightly Reconcile

### Task B1: Paginated GraphQL helpers

**Files:**
- Create: `lib/shopify/paginate.ts`

Bulk Operations stay for the one-time backfill; reconcile uses cursor pagination (small nightly deltas, fits the function timeout).

- [ ] **Step 1: Implement `lib/shopify/paginate.ts`**

```ts
/**
 * Cursor-paginated Admin GraphQL reads for the nightly reconcile. Unlike Bulk
 * Operations (server-side, minutes-long, one-per-shop — used only for the initial
 * backfill), these run inline and are sized for small nightly deltas.
 *
 * Each helper pages through `edges`/`pageInfo` until `hasNextPage` is false and
 * returns the flat list of nodes.
 */
import { shopifyGraphql } from "./shopify";

const PAGE = 100;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

async function pageAll<T>(
  shopDomain: string,
  build: (after: string | null) => { query: string; variables: Record<string, unknown> },
  extract: (data: any) => { nodes: T[]; pageInfo: PageInfo }
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  // Hard ceiling to avoid an accidental infinite loop.
  for (let i = 0; i < 1000; i++) {
    const { query, variables } = build(after);
    const data = await shopifyGraphql<any>(shopDomain, query, variables);
    const { nodes, pageInfo } = extract(data);
    out.push(...nodes);
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return out;
}

/** Products whose `updated_at >= sinceIso`, with first variant + featured image. */
export async function fetchProductsSince(shopDomain: string, sinceIso: string) {
  return pageAll(
    shopDomain,
    (after) => ({
      query: `query($after: String, $q: String!) {
        products(first: ${PAGE}, after: $after, query: $q) {
          edges { node {
            id title vendor productType
            featuredImage { url }
            variants(first: 1) { edges { node { id sku price inventoryItem { id } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      variables: { after, q: `updated_at:>=${sinceIso}` },
    }),
    (d) => ({
      nodes: d.products.edges.map((e: any) => ({
        id: e.node.id,
        title: e.node.title,
        vendor: e.node.vendor,
        productType: e.node.productType,
        featuredImage: e.node.featuredImage,
        variants: e.node.variants.edges.map((v: any) => v.node),
      })),
      pageInfo: d.products.pageInfo,
    })
  );
}

/** Orders whose `updated_at >= sinceIso`, with line items. */
export async function fetchOrdersSince(shopDomain: string, sinceIso: string) {
  return pageAll(
    shopDomain,
    (after) => ({
      query: `query($after: String, $q: String!) {
        orders(first: ${PAGE}, after: $after, query: $q) {
          edges { node {
            id name createdAt
            lineItems(first: 50) { edges { node {
              quantity sku product { id } variant { id }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
            } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      variables: { after, q: `updated_at:>=${sinceIso}` },
    }),
    (d) => ({
      nodes: d.orders.edges.map((e: any) => ({
        id: e.node.id,
        name: e.node.name,
        createdAt: e.node.createdAt,
        lineItems: e.node.lineItems.edges.map((l: any) => l.node),
      })),
      pageInfo: d.orders.pageInfo,
    })
  );
}

/** All locations with on_hand inventory levels (full refresh — no cheap delta). */
export async function fetchLocationsWithInventory(shopDomain: string) {
  return pageAll(
    shopDomain,
    (after) => ({
      query: `query($after: String) {
        locations(first: 50, after: $after) {
          edges { node {
            id name isActive
            inventoryLevels(first: 250) { edges { node {
              quantities(names: ["on_hand"]) { name quantity }
              item { id variant { id product { id } } }
            } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      variables: { after },
    }),
    (d) => ({
      nodes: d.locations.edges.map((e: any) => ({
        id: e.node.id,
        name: e.node.name,
        isActive: e.node.isActive,
        inventoryLevels: e.node.inventoryLevels.edges.map((l: any) => l.node),
      })),
      pageInfo: d.locations.pageInfo,
    })
  );
}
```

- [ ] **Step 2: Verify on_hand (not available) + typecheck**

Run: `grep -n 'quantities(names: \["on_hand"\])' lib/shopify/paginate.ts`
Expected: one match.
Run: `grep -nw available lib/shopify/paginate.ts || echo "no available — good"`
Expected: `no available — good`
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "shopify/paginate" || echo "paginate typecheck clean"`
Expected: `paginate typecheck clean`

- [ ] **Step 3: Commit**

```bash
git add lib/shopify/paginate.ts
git commit -m "feat(reconcile): cursor-paginated products/orders/inventory readers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B2: Reconcile window (pure) + test

**Files:**
- Create: `lib/shopify/reconcile-window.ts`
- Test: `lib/shopify/reconcile-window.test.ts`

- [ ] **Step 1: Write the failing test `lib/shopify/reconcile-window.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeWindowStart } from "./reconcile-window";

const NOW = new Date("2026-06-05T09:00:00.000Z");

describe("computeWindowStart", () => {
  it("first run (null cursor) looks back the fallback hours, day-aligned", () => {
    const r = computeWindowStart(null, NOW, { overlapHours: 6, firstRunLookbackHours: 48 });
    // 48h before 2026-06-05T09:00 = 2026-06-03T09:00 -> midnight 2026-06-03
    expect(r.toISOString()).toBe("2026-06-03T00:00:00.000Z");
  });

  it("subtracts the overlap then floors to UTC midnight", () => {
    const cursor = new Date("2026-06-05T05:00:00.000Z");
    const r = computeWindowStart(cursor, NOW, { overlapHours: 6, firstRunLookbackHours: 48 });
    // 05:00 - 6h = 2026-06-04T23:00 -> midnight 2026-06-04
    expect(r.toISOString()).toBe("2026-06-04T00:00:00.000Z");
  });

  it("a cursor later in the day still floors to that day's midnight after overlap", () => {
    const cursor = new Date("2026-06-05T08:00:00.000Z");
    const r = computeWindowStart(cursor, NOW, { overlapHours: 6, firstRunLookbackHours: 48 });
    // 08:00 - 6h = 02:00 -> midnight 2026-06-05
    expect(r.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run lib/shopify/reconcile-window.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/shopify/reconcile-window.ts`**

```ts
/**
 * Compute the day-aligned start of a reconcile window.
 *
 * - First run (no cursor): look back `firstRunLookbackHours` (the backfill already
 *   loaded 365d, so 48h is plenty of overlap).
 * - Subsequent runs: start at the stored cursor minus `overlapHours` of safety
 *   (catches late-arriving / edited records), floored to UTC midnight so whole
 *   days are re-pulled — required for the idempotent day-set sales writer.
 */
export function computeWindowStart(
  cursor: Date | null,
  now: Date,
  opts: { overlapHours: number; firstRunLookbackHours: number }
): Date {
  const base = cursor
    ? new Date(cursor.getTime() - opts.overlapHours * 3600_000)
    : new Date(now.getTime() - opts.firstRunLookbackHours * 3600_000);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run lib/shopify/reconcile-window.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/shopify/reconcile-window.ts lib/shopify/reconcile-window.test.ts
git commit -m "feat(reconcile): day-aligned window computation + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B3: Idempotent sales writer

**Files:**
- Create: `lib/shopify/sales-window.ts`
- Test: `lib/shopify/sales-window.test.ts`

The pure bucketer is unit-tested; the DB `set`-upsert is verified live (Task B6).

- [ ] **Step 1: Write the failing test `lib/shopify/sales-window.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { bucketSalesByProductDay } from "./sales-window";
import type { ShopifyOrderNode } from "./ingest";

const gidMap = new Map<string, string>([
  ["gid://shopify/Product/1", "local-1"],
  ["gid://shopify/Product/2", "local-2"],
]);

const orders: ShopifyOrderNode[] = [
  {
    id: "o1", createdAt: "2026-06-04T10:00:00Z",
    lineItems: [
      { quantity: 2, product: { id: "gid://shopify/Product/1" }, originalUnitPriceSet: { shopMoney: { amount: "100" } } },
      { quantity: 1, product: { id: "gid://shopify/Product/2" }, originalUnitPriceSet: { shopMoney: { amount: "50" } } },
    ],
  },
  {
    id: "o2", createdAt: "2026-06-04T18:00:00Z",
    lineItems: [
      { quantity: 3, product: { id: "gid://shopify/Product/1" }, originalUnitPriceSet: { shopMoney: { amount: "100" } } },
    ],
  },
  {
    id: "o3", createdAt: "2026-06-04T12:00:00Z",
    lineItems: [
      { quantity: 5, product: { id: "gid://shopify/Product/99" }, originalUnitPriceSet: { shopMoney: { amount: "10" } } }, // unknown product — skipped
    ],
  },
];

describe("bucketSalesByProductDay", () => {
  it("sums quantity + revenue per (product, day)", () => {
    const buckets = bucketSalesByProductDay(orders, gidMap);
    // product 1, 2026-06-04 => qty 5 (2+3), revenue 500
    const key = "local-1|2026-06-04";
    expect(buckets.get(key)).toEqual({
      productId: "local-1", dateKey: "2026-06-04", quantity: 5, revenueKes: 500,
    });
  });

  it("keeps separate products on the same day separate", () => {
    const buckets = bucketSalesByProductDay(orders, gidMap);
    expect(buckets.get("local-2|2026-06-04")).toEqual({
      productId: "local-2", dateKey: "2026-06-04", quantity: 1, revenueKes: 50,
    });
  });

  it("skips line items whose product is not in the catalog", () => {
    const buckets = bucketSalesByProductDay(orders, gidMap);
    expect([...buckets.keys()].some((k) => k.startsWith("local-99") || k.includes("/99"))).toBe(false);
  });

  it("is pure — running twice yields identical buckets (idempotent input)", () => {
    const a = bucketSalesByProductDay(orders, gidMap);
    const b = bucketSalesByProductDay(orders, gidMap);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run lib/shopify/sales-window.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/shopify/sales-window.ts`**

```ts
/**
 * Idempotent sales writer for the nightly reconcile.
 *
 * The Plan 03-03 mapper `upsertOrderAsSales` INCREMENTS — correct for the
 * clean-slate cutover, wrong here (overlap windows would double-count). Instead we
 * bucket the window's orders by (product, day) and OVERWRITE (`set`) each day's
 * SalesHistory total. Because the reconcile window re-pulls whole days, the
 * overwrite is exact and re-running is a no-op.
 */
import { prisma } from "@/lib/prisma";
import type { ShopifyOrderNode } from "./ingest";

export type DayBucket = {
  productId: string;
  dateKey: string; // YYYY-MM-DD (UTC)
  quantity: number;
  revenueKes: number;
};

/** Pure: aggregate order line items into (product, day) buckets. */
export function bucketSalesByProductDay(
  orders: ShopifyOrderNode[],
  productIdByGid: Map<string, string>
): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>();
  for (const order of orders) {
    if (!order.createdAt) continue;
    const dateKey = order.createdAt.slice(0, 10); // YYYY-MM-DD
    for (const line of order.lineItems ?? []) {
      const gid = line.product?.id;
      if (!gid) continue;
      const productId = productIdByGid.get(gid);
      if (!productId) continue;
      const qty = line.quantity ?? 0;
      if (qty <= 0) continue;
      const unit = line.originalUnitPriceSet?.shopMoney?.amount
        ? Number.parseFloat(line.originalUnitPriceSet.shopMoney.amount)
        : 0;
      const revenue = Number.isFinite(unit) ? unit * qty : 0;

      const key = `${productId}|${dateKey}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.quantity += qty;
        existing.revenueKes += revenue;
      } else {
        buckets.set(key, { productId, dateKey, quantity: qty, revenueKes: revenue });
      }
    }
  }
  return buckets;
}

/** Overwrite SalesHistory for each bucketed (product, day). Idempotent. */
export async function applySalesForWindow(
  tenantId: string,
  orders: ShopifyOrderNode[],
  productIdByGid: Map<string, string>
): Promise<number> {
  const buckets = bucketSalesByProductDay(orders, productIdByGid);
  let written = 0;
  for (const b of buckets.values()) {
    const date = new Date(`${b.dateKey}T00:00:00.000Z`);
    await prisma.salesHistory.upsert({
      where: { productId_date_channel: { productId: b.productId, date, channel: "shopify" } },
      create: { tenantId, productId: b.productId, date, quantity: b.quantity, revenueKes: b.revenueKes, channel: "shopify" },
      update: { quantity: b.quantity, revenueKes: b.revenueKes }, // SET, not increment
    });
    written++;
  }
  return written;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run lib/shopify/sales-window.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/shopify/sales-window.ts lib/shopify/sales-window.test.ts
git commit -m "feat(reconcile): idempotent day-set sales writer + bucket tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B4: Extract `runForecastsForTenant`

**Files:**
- Create: `lib/forecast/run-batch.ts`
- Modify: `scripts/run-forecasts.ts`

Move the forecast batch body out of the script so reconcile can call it. This is a mechanical extraction — the logic is unchanged.

- [ ] **Step 1: Create `lib/forecast/run-batch.ts` with the extracted logic**

```ts
/**
 * Forecast batch for one tenant — extracted from scripts/run-forecasts.ts so the
 * nightly reconcile can re-forecast without duplicating the pipeline. Logic is
 * identical to the original script body (ABC assign -> layered forecast -> upsert
 * Prediction -> create pending Order for critical/high). Also snapshots inventory.
 */
import { prisma } from "@/lib/prisma";
import { simulateLayeredForecast, type ActivePromo } from "@/lib/forecast/simulate-layers";
import { assignAbc } from "@/lib/forecast/abc";
import { recommendedQty as computeRecommendedQty } from "@/lib/forecast/reorder";
import { tenantDayKey, tenantTodayUtc } from "@/lib/time/tenant-date";
import { snapshotInventory } from "@/lib/inventory/snapshot";

export async function runForecastsForTenant(tenantId: string): Promise<{ created: number; forecastRunId: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, timezone: true } });
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    include: { supplier: true },
  });

  const forecastRunId = crypto.randomUUID();
  const runDateKey = tenantDayKey(tenant.timezone);
  const todayUtc = tenantTodayUtc(tenant.timezone);

  const today = todayUtc;
  const since = new Date(today);
  since.setUTCFullYear(today.getUTCFullYear() - 1);

  const allHistory = await prisma.salesHistory.findMany({
    where: { tenantId: tenant.id, date: { gte: since } },
  });
  const historyByProduct = new Map<string, { date: Date; quantity: number }[]>();
  for (const h of allHistory) {
    if (!historyByProduct.has(h.productId)) historyByProduct.set(h.productId, []);
    historyByProduct.get(h.productId)!.push({ date: h.date, quantity: h.quantity });
  }

  const revenueByProduct = products.map((p) => {
    const hist = historyByProduct.get(p.id) ?? [];
    const last90 = new Date(today);
    last90.setUTCDate(last90.getUTCDate() - 90);
    const recent = hist.filter((h) => h.date >= last90);
    const revenue = recent.reduce((s, h) => s + h.quantity * p.priceKes, 0);
    return { id: p.id, revenue };
  });
  const abcMap = assignAbc(revenueByProduct);

  const activePromos = await prisma.promo.findMany({
    where: {
      tenantId: tenant.id,
      startDate: { lte: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) },
      endDate: { gte: today },
    },
  });
  const promosShaped: ActivePromo[] = activePromos.map((p) => ({
    discountPct: p.discountPct,
    promoType: p.promoType,
    channel: p.channel,
    scope: p.scope,
    scopeValue: p.scopeValue,
  }));

  let created = 0;
  for (const p of products) {
    const history = historyByProduct.get(p.id) ?? [];
    const supplier = p.supplier;
    const leadAvg = supplier?.leadTimeAvgDays ?? 30;
    const leadStd = supplier?.leadTimeStdDays ?? 7;
    const abc = abcMap[p.id] ?? "C";

    const result = simulateLayeredForecast({
      productId: p.id,
      productType: p.productType,
      vendor: p.vendor,
      sku: p.sku,
      currentStock: p.currentStock,
      abcCategory: abc,
      history,
      leadTimeAvg: leadAvg,
      leadTimeStd: leadStd,
      activePromos: promosShaped,
      runDateKey,
    });

    const adjustedRecommendedQty = computeRecommendedQty({
      finalForecast30d: result.finalForecast30d,
      safetyStock: result.safetyStock,
      currentStock: p.currentStock,
      onOrder: p.onOrder,
    });

    await prisma.product.update({ where: { id: p.id }, data: { abcCategory: abc } });

    const prediction = await prisma.prediction.create({
      data: {
        tenantId: tenant.id,
        productId: p.id,
        runDate: todayUtc,
        layer1Forecast30d: result.layer1Forecast30d,
        layer1Confidence: result.layer1Confidence,
        layer2Adjustment: result.layer2Adjustment,
        finalForecast30d: result.finalForecast30d,
        daysUntilStockout: result.daysUntilStockout,
        recommendedQty: adjustedRecommendedQty,
        safetyStock: result.safetyStock,
        reorderPoint: result.reorderPoint,
        confidence: result.confidence,
        reasoning: result.reasoning,
        urgency: result.urgency,
        signals: JSON.stringify(result.signals),
        forecastRunId,
        regime: null,
      },
    });

    if (adjustedRecommendedQty > 0 && (result.urgency === "critical" || result.urgency === "high")) {
      await prisma.order.create({
        data: { tenantId: tenant.id, predictionId: prediction.id, status: "pending" },
      });
    }
    created++;
  }

  await snapshotInventory(tenant.id);
  return { created, forecastRunId };
}
```

- [ ] **Step 2: Replace the body of `scripts/run-forecasts.ts` to delegate**

Rewrite the whole file as:

```ts
import { PrismaClient } from "@prisma/client";
import { runForecastsForTenant } from "../lib/forecast/run-batch";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant — seed first");
  const { created, forecastRunId } = await runForecastsForTenant(tenant.id);
  console.log(`Done. ${created} forecasts created. forecastRunId=${forecastRunId}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "run-batch|run-forecasts" || echo "forecast extraction typecheck clean"`
Expected: `forecast extraction typecheck clean`

- [ ] **Step 4: Run forecasts live to confirm parity (dev server stopped)**

Run: `npx tsx scripts/run-forecasts.ts`
Expected: `Done. N forecasts created.` with N ≈ previous run; no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/run-batch.ts scripts/run-forecasts.ts
git commit -m "refactor(forecast): extract runForecastsForTenant for reuse by reconcile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B5: `reconcileTenant` orchestrator

**Files:**
- Create: `lib/shopify/reconcile.ts`

- [ ] **Step 1: Implement `lib/shopify/reconcile.ts`**

```ts
/**
 * Nightly incremental reconcile for one tenant. Non-destructive (no cutover): it
 * refreshes products + on_hand inventory + recent sales from Shopify via paginated
 * GraphQL, advancing per-resource cursors so a crash re-pulls only the unfinished
 * resource next run. Then snapshots inventory + re-forecasts.
 */
import { prisma } from "@/lib/prisma";
import {
  fetchProductsSince,
  fetchOrdersSince,
  fetchLocationsWithInventory,
} from "./paginate";
import {
  upsertProductFromShopify,
  upsertLocationFromShopify,
  upsertInventoryLevel,
  type ShopifyProductNode,
  type ShopifyLocationNode,
  type ShopifyOrderNode,
} from "./ingest";
import { applySalesForWindow } from "./sales-window";
import { computeWindowStart } from "./reconcile-window";
import { runForecastsForTenant } from "@/lib/forecast/run-batch";

const OVERLAP_HOURS = 6;
const FIRST_RUN_LOOKBACK_HOURS = 48;

export type ReconcileResult = {
  windowStart: string;
  products: number;
  locations: number;
  inventoryLevels: number;
  salesRows: number;
  orders: number;
  forecastsCreated: number;
};

async function getCursor(tenantId: string, resource: string): Promise<Date | null> {
  const row = await prisma.ingestCursor.findUnique({
    where: { tenantId_source_resource: { tenantId, source: "shopify", resource } },
    select: { cursor: true },
  });
  return row?.cursor ?? null;
}

async function setCursor(tenantId: string, resource: string, value: Date): Promise<void> {
  await prisma.ingestCursor.upsert({
    where: { tenantId_source_resource: { tenantId, source: "shopify", resource } },
    create: { tenantId, source: "shopify", resource, cursor: value },
    update: { cursor: value },
  });
}

/** Sum on_hand across all locations, keyed by Shopify product gid. */
function sumOnHandByProductGid(locations: ShopifyLocationNode[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const loc of locations) {
    for (const level of loc.inventoryLevels ?? []) {
      const gid = level.item?.variant?.product?.id;
      if (!gid) continue;
      const onHand = level.quantities?.find((q) => q.name === "on_hand")?.quantity ?? 0;
      out.set(gid, (out.get(gid) ?? 0) + onHand);
    }
  }
  return out;
}

export async function reconcileTenant(tenantId: string): Promise<ReconcileResult> {
  const connection = await prisma.shopifyConnection.findUnique({ where: { tenantId } });
  if (!connection || connection.uninstalledAt) {
    throw new Error(`Tenant ${tenantId} has no live Shopify connection`);
  }
  const shopDomain = connection.shopDomain;
  const runStart = new Date();

  // ── Products (changed since cursor) ─────────────────────────────────────────
  const productsCursor = await getCursor(tenantId, "products");
  const productsSince = computeWindowStart(productsCursor, runStart, {
    overlapHours: OVERLAP_HOURS,
    firstRunLookbackHours: FIRST_RUN_LOOKBACK_HOURS,
  });
  const products = (await fetchProductsSince(shopDomain, productsSince.toISOString())) as ShopifyProductNode[];

  // ── Inventory (full refresh) ────────────────────────────────────────────────
  const locations = (await fetchLocationsWithInventory(shopDomain)) as ShopifyLocationNode[];
  const onHandByGid = sumOnHandByProductGid(locations);

  // Upsert products with their summed on_hand as currentStock.
  const productIdByGid = new Map<string, string>();
  for (const p of products) {
    const localId = await upsertProductFromShopify(tenantId, p, onHandByGid.get(p.id) ?? 0);
    productIdByGid.set(p.id, localId);
  }
  // For products NOT in this delta, still refresh currentStock from on_hand.
  if (onHandByGid.size > 0) {
    const known = await prisma.product.findMany({
      where: { tenantId },
      select: { id: true, shopifyProductId: true },
    });
    for (const k of known) {
      if (!productIdByGid.has(k.shopifyProductId) && onHandByGid.has(k.shopifyProductId)) {
        await prisma.product.update({
          where: { id: k.id },
          data: { currentStock: onHandByGid.get(k.shopifyProductId)! },
        });
        productIdByGid.set(k.shopifyProductId, k.id);
      } else if (!productIdByGid.has(k.shopifyProductId)) {
        productIdByGid.set(k.shopifyProductId, k.id);
      }
    }
  }
  await setCursor(tenantId, "products", runStart);

  // Locations + inventory levels (primary = first active).
  let inventoryLevels = 0;
  const primaryGid = locations.find((l) => l.isActive)?.id ?? locations[0]?.id ?? null;
  for (const loc of locations) {
    const locationId = await upsertLocationFromShopify(tenantId, loc, { isPrimary: loc.id === primaryGid });
    for (const level of loc.inventoryLevels ?? []) {
      const gid = level.item?.variant?.product?.id;
      if (!gid) continue;
      const productId = productIdByGid.get(gid);
      if (!productId) continue;
      const onHand = level.quantities?.find((q) => q.name === "on_hand")?.quantity ?? 0;
      await upsertInventoryLevel(tenantId, locationId, productId, onHand);
      inventoryLevels++;
    }
  }

  // ── Orders (changed since cursor) -> idempotent day-set sales ────────────────
  const ordersCursor = await getCursor(tenantId, "orders");
  const ordersSince = computeWindowStart(ordersCursor, runStart, {
    overlapHours: OVERLAP_HOURS,
    firstRunLookbackHours: FIRST_RUN_LOOKBACK_HOURS,
  });
  const orders = (await fetchOrdersSince(shopDomain, ordersSince.toISOString())) as ShopifyOrderNode[];
  const salesRows = await applySalesForWindow(tenantId, orders, productIdByGid);
  await setCursor(tenantId, "orders", runStart);

  // ── Snapshot + re-forecast ──────────────────────────────────────────────────
  const { created: forecastsCreated } = await runForecastsForTenant(tenantId);

  return {
    windowStart: productsSince.toISOString(),
    products: products.length,
    locations: locations.length,
    inventoryLevels,
    salesRows,
    orders: orders.length,
    forecastsCreated,
  };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "shopify/reconcile" || echo "reconcile typecheck clean"`
Expected: `reconcile typecheck clean`
Run: `npm run lint 2>&1 | tail -5`
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
git add lib/shopify/reconcile.ts
git commit -m "feat(reconcile): reconcileTenant orchestrator (incremental, non-destructive)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B6: Local CLI trigger + live idempotency check

**Files:**
- Create: `scripts/shopify-reconcile.ts`

- [ ] **Step 1: Implement `scripts/shopify-reconcile.ts`**

```ts
/**
 * Local trigger for the nightly reconcile (run with the dev server stopped —
 * Supabase pooler cap). The production trigger is app/api/cron/reconcile.
 *
 *   npx tsx scripts/shopify-reconcile.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { reconcileTenant } from "../lib/shopify/reconcile";

async function main() {
  const tenants = await prisma.shopifyConnection.findMany({
    where: { uninstalledAt: null },
    select: { tenantId: true },
  });
  for (const t of tenants) {
    const r = await reconcileTenant(t.tenantId);
    console.log(`reconciled ${t.tenantId}:`, JSON.stringify(r));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it live (dev server stopped)**

Run: `npx tsx scripts/shopify-reconcile.ts`
Expected: a line like `reconciled <id>: {"windowStart":...,"products":N,"locations":4,"inventoryLevels":...,"salesRows":M,"orders":O,"forecastsCreated":P}` with no errors.

- [ ] **Step 3: Capture SalesHistory total, then run AGAIN (idempotency)**

```bash
npx tsx -e "import 'dotenv/config';import{prisma}from'./lib/prisma';prisma.tenant.findFirst({select:{id:true}}).then(t=>prisma.salesHistory.count({where:{tenantId:t.id}})).then(c=>{console.log('sales_before='+c);process.exit(0)})"
npx tsx scripts/shopify-reconcile.ts
npx tsx -e "import 'dotenv/config';import{prisma}from'./lib/prisma';prisma.tenant.findFirst({select:{id:true}}).then(t=>prisma.salesHistory.count({where:{tenantId:t.id}})).then(c=>{console.log('sales_after='+c);process.exit(0)})"
```
Expected: `sales_before` and `sales_after` are within the small overlap window's range and do NOT inflate on the second run for the same days (the `set` writer overwrites; counts for already-present days are stable). A small increase is only acceptable if genuinely new orders/days appeared between runs.

- [ ] **Step 4: Commit**

```bash
git add scripts/shopify-reconcile.ts
git commit -m "feat(reconcile): local CLI trigger + live idempotency verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B7: Cron route + `CRON_SECRET` + `vercel.json`

**Files:**
- Create: `app/api/cron/reconcile/route.ts`
- Create: `vercel.json`
- Modify: `.env` (add `CRON_SECRET`; NOT committed)

- [ ] **Step 1: Add `CRON_SECRET` to `.env`**

Append a strong random secret (do not commit `.env`):

```
CRON_SECRET=<generate: openssl rand -hex 32>
```

- [ ] **Step 2: Implement `app/api/cron/reconcile/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reconcileTenant } from "@/lib/shopify/reconcile";

// Paginated reconcile + re-forecast; allow a long ceiling.
export const maxDuration = 300;

/**
 * GET /api/cron/reconcile — system endpoint for the nightly Vercel Cron.
 * Auth: `Authorization: Bearer <CRON_SECRET>` (no user session). Loops every
 * tenant with a live Shopify connection; one tenant's failure does not abort the
 * rest.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenants = await prisma.shopifyConnection.findMany({
    where: { uninstalledAt: null },
    select: { tenantId: true },
  });

  const results: Array<{ tenantId: string; ok: boolean; detail?: unknown }> = [];
  for (const t of tenants) {
    try {
      const r = await reconcileTenant(t.tenantId);
      results.push({ tenantId: t.tenantId, ok: true, detail: r });
    } catch (err) {
      results.push({ tenantId: t.tenantId, ok: false, detail: (err as Error).message });
    }
  }
  return NextResponse.json({ ok: true, tenants: results.length, results });
}
```

- [ ] **Step 3: Create `vercel.json` (cron is dormant until deploy)**

```json
{
  "crons": [
    { "path": "/api/cron/reconcile", "schedule": "0 23 * * *" }
  ]
}
```

> Vercel sends Cron requests with an `Authorization: Bearer <CRON_SECRET>` header automatically when `CRON_SECRET` is set in the project's env (Vercel's documented convention), so the route's check works for both Vercel Cron and manual calls. `0 23 * * *` UTC = 02:00 EAT. Nightly fits the Vercel Hobby daily-cron limit.

- [ ] **Step 4: Verify auth locally (dev server up)**

Start `npm run dev`, then:

```bash
curl -s -o /dev/null -w "no_auth=%{http_code}\n" http://localhost:3082/api/cron/reconcile
```
Expected: `no_auth=401`.

(Do NOT run the authorized call casually — it triggers a full reconcile + re-forecast. The CLI in Task B6 already proved the path. If you want to confirm the authorized branch, stop dev first is not possible while serving; instead trust the 401 + the CLI run.)

- [ ] **Step 5: Typecheck + lint, then stop dev server**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "cron/reconcile" || echo "cron route typecheck clean"`
Expected: `cron route typecheck clean`
Run: `npm run lint 2>&1 | tail -5`
Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/reconcile/route.ts vercel.json
git commit -m "feat(reconcile): CRON_SECRET-guarded cron route + nightly vercel.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B8: Final gates + summary

**Files:**
- Create: `docs/superpowers/plans/2026-06-05-reconcile-and-inventory-position-SUMMARY.md` (or update STATE.md per repo convention)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all green (existing + new: snapshot, position, reconcile-window, sales-window).

- [ ] **Step 2: Typecheck + lint (full)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.
Run: `npm run lint 2>&1 | tail -5`
Expected: `0 errors`.

- [ ] **Step 3: Write a short summary** (counts from the live reconcile + view, the deviations, and the cursor/snapshot behavior) and commit.

```bash
git add docs/superpowers/plans
git commit -m "docs(reconcile): implementation summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (author checklist — completed)

- **Spec coverage:** InventorySnapshot (A1), snapshot primitive (A2, wired A3), opening measured+estimate (A4 `resolveOpening`, A5 query), ABC grouping + subtotals + days-cover + lead time + en-route ETA (A4/A5/A6), Reports section + window selector (A6), incremental reconcile with cursors (B5), paginated not bulk (B1), idempotent day-set sales writer (B3), full inventory refresh (B5), snapshot+re-forecast in reconcile (B5 via run-batch), cron route + CRON_SECRET + vercel.json nightly (B7), per-tenant isolation (B7 loop), tests (A2/A4/B2/B3). All spec sections map to a task.
- **Deviations recorded:** run rate from SalesHistory (not the stale `dailySalesRate` field); `runForecastsForTenant` extraction. Both noted at top + in tasks.
- **Type consistency:** `ShopifyProductNode/LocationNode/OrderNode` reused from `lib/shopify/ingest.ts`; `upsertProductFromShopify/upsertLocationFromShopify/upsertInventoryLevel` signatures match Plan 03-03; `PositionRowInput`/`buildPositionView` consistent between A4 and A5; `computeWindowStart` opts (`overlapHours`,`firstRunLookbackHours`) consistent B2↔B5; `applySalesForWindow(tenantId, orders, productIdByGid)` consistent B3↔B5.
- **Placeholder scan:** none — every code step shows full code; the only judgement call (design-token substitution in A6) is bounded with an explicit "use existing tokens, don't invent" rule.

## Risks / notes for the executor
- `app/api/forecast/run/route.ts` duplicates forecast logic; this plan does NOT refactor it (out of scope) to avoid behavior drift. It keeps working as-is. Optionally delegate it to `runForecastsForTenant` later.
- The inventory full-refresh sets `currentStock` from on_hand for every product each night; if a Shopify product was deleted, its local row is left stale (not removed) — acceptable for nightly reconcile (deletions are handled by the future uninstall/webhook path).
- Design tokens in A6 must match `app/globals.css`; verify before committing the UI.
```
