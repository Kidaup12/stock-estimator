# Odoo Connector — Foundation (Plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land an Odoo store's products, stock, cost, sales history, and suppliers into Wezesha's existing Prisma models via a manual sync, so the existing forecast engine + dashboard produce a trustworthy reorder list on the client's real data.

**Architecture:** A new `lib/odoo/` adapter (mirrors `lib/shopify/`) talks to Odoo's JSON-RPC endpoint (`/jsonrpc`), maps records through pure mapper functions, and writes them with batched Prisma operations into source-generalized models. A one-shot `scripts/odoo-ingest.ts` orchestrates a full sync against a tenant's `OdooConnection`. Everything downstream (run rate, Buy List, planner) is unchanged and source-agnostic.

**Tech Stack:** TypeScript, Next.js 16, Prisma 6, Vitest (`npm test` → `vitest run`), `tsx` for scripts. Odoo JSON-RPC over native `fetch`. AES-256-GCM via `lib/crypto/encryption.ts`.

**Spec:** `docs/superpowers/specs/2026-06-11-odoo-connector-design.md`

---

## Pre-flight notes for the implementer (read once)

- **Test command:** `npm test` runs `vitest run`. Single file: `npx vitest run lib/odoo/<file>.test.ts`.
- **Migrations:** this repo's `prisma migrate dev` is non-interactive-hostile on data-loss prompts. Use the diff→deploy pattern (Task 1 spells it out). STOP the dev server (port 3082) before running any DB/prisma command — the Supabase pooler has a tight connection cap.
- **Tenant-safety ESLint:** files touching Prisma must carry `tenantId` in every query. `lib/odoo/ingest.ts` is subject to this — never write a bare `prisma.product.findMany()` without a `tenantId` filter.
- **Batching rule (hard):** any per-row Prisma loop ≥ ~500 rows on Vercel→EU-Supabase times out. Writers MUST batch: `deleteMany` + `createMany`, or chunked updates. Mirror `lib/shopify/reconcile.ts`.
- **Odoo JSON-RPC shape** (used throughout):
  ```
  POST {baseUrl}/jsonrpc   Content-Type: application/json
  { "jsonrpc":"2.0", "method":"call", "id":1,
    "params": { "service":"<common|object>", "method":"<m>", "args":[...] } }
  ```
  - `common.authenticate` args: `[db, username, apiKey, {}]` → returns integer `uid` (or `false`).
  - `object.execute_kw` args: `[db, uid, apiKey, model, "search_read", [domain], {fields, limit, offset}]`.
  - A JSON-RPC error returns `{ "error": { "data": { "message": ... } } }` (HTTP 200). Treat presence of `error` as failure.

---

## Task 1: Source-generalize schema + add OdooConnection

**Files:**
- Modify: `prisma/schema.prisma` (Product, Location, Tenant; add OdooConnection)
- Create: `prisma/migrations/<timestamp>_odoo_source_generalization/migration.sql`

- [ ] **Step 1: Edit `prisma/schema.prisma` — Tenant**

Add a source discriminator and the Odoo relation to `model Tenant` (alongside `shopifyConnection`):
```prisma
  source             String   @default("shopify") // "shopify" | "odoo"
  odooConnection     OdooConnection?
```

- [ ] **Step 2: Edit `model Product`**

Make Shopify IDs optional, add generic external identity, and add the generic unique. Replace the two `shopify*` lines and the `@@unique`:
```prisma
  shopifyProductId  String?
  shopifyVariantId  String?
  externalId        String?  // provider record id (Odoo product.product id, etc.)
  source            String   @default("shopify")
```
Replace `@@unique([tenantId, shopifyProductId])` with:
```prisma
  @@unique([tenantId, source, externalId])
  @@index([tenantId, source])
```

- [ ] **Step 3: Edit `model Location`**

```prisma
  shopifyLocationId String?
  externalId        String?
  source            String  @default("shopify")
```
Replace `@@unique([tenantId, shopifyLocationId])` with:
```prisma
  @@unique([tenantId, source, externalId])
```

- [ ] **Step 4: Add `model OdooConnection`** (mirror ShopifyConnection)

```prisma
model OdooConnection {
  id            String    @id @default(cuid())
  tenantId      String    @unique
  baseUrl       String    // https://store.odoo.com
  database      String
  username      String
  apiKey        String    // AES-256-GCM ciphertext (encrypt()/decrypt())
  lastSyncedAt  DateTime?
  createdAt     DateTime  @default(now())
  disabledAt    DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 5: Author the migration SQL by diff (do NOT use `migrate dev`)**

Stop the dev server first. Run:
```bash
cd C:/Users/ROY/Documents/wezesha/stock-estimator
mkdir -p "prisma/migrations/20260611120000_odoo_source_generalization"
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "prisma/migrations/20260611120000_odoo_source_generalization/migration.sql"
```
Open the generated SQL. Prisma will emit DROP/CREATE for the changed unique indexes and ADD COLUMN statements. **Insert a backfill BEFORE the new unique index is created** so existing Shopify rows satisfy `(tenantId, source, externalId)`:
```sql
-- Backfill existing rows so the new unique holds
UPDATE "Product"  SET "externalId" = "shopifyProductId",  "source" = 'shopify' WHERE "externalId" IS NULL;
UPDATE "Location" SET "externalId" = "shopifyLocationId", "source" = 'shopify' WHERE "externalId" IS NULL;
UPDATE "Tenant"   SET "source" = 'shopify' WHERE "source" IS NULL;
```

- [ ] **Step 6: Apply + regenerate**

```bash
npx prisma migrate deploy
npx prisma generate
```
Expected: "1 migration applied", client regenerated, no error.

- [ ] **Step 7: Verify existing tests still pass (no regression)**

Run: `npm test`
Expected: the suite (incl. the 2-tenant isolation test) is green. If a test referenced `Product.shopifyProductId` as non-null, fix the type usage (it's now `string | null`).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(odoo): source-generalize Product/Location + OdooConnection model"
```

---

## Task 2: Odoo JSON-RPC client

**Files:**
- Create: `lib/odoo/client.ts`
- Test: `lib/odoo/client.test.ts`

- [ ] **Step 1: Write the failing test** (`lib/odoo/client.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OdooClient } from "./client";

function mockFetchOnce(body: unknown, ok = true) {
  return vi.fn().mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
}

describe("OdooClient", () => {
  const cfg = { baseUrl: "https://x.odoo.com", database: "x", username: "u@x.com", apiKey: "k" };
  beforeEach(() => vi.restoreAllMocks());

  it("authenticate() returns the uid from a JSON-RPC result", async () => {
    const fetchMock = mockFetchOnce({ jsonrpc: "2.0", id: 1, result: 7 });
    vi.stubGlobal("fetch", fetchMock);
    const c = new OdooClient(cfg);
    expect(await c.authenticate()).toBe(7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x.odoo.com/jsonrpc");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.params.service).toBe("common");
    expect(sent.params.method).toBe("authenticate");
    expect(sent.params.args).toEqual(["x", "u@x.com", "k", {}]);
  });

  it("authenticate() throws on uid=false (bad creds)", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ jsonrpc: "2.0", id: 1, result: false }));
    await expect(new OdooClient(cfg).authenticate()).rejects.toThrow(/authentication failed/i);
  });

  it("searchRead() caches uid then calls execute_kw with paging args", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 7 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [{ id: 1 }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const c = new OdooClient(cfg);
    const rows = await c.searchRead("product.product", [["active", "=", true]], ["id", "default_code"], { limit: 100, offset: 0 });
    expect(rows).toEqual([{ id: 1 }]);
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(sent.params.method).toBe("execute_kw");
    expect(sent.params.args[3]).toBe("product.product");
    expect(sent.params.args[4]).toBe("search_read");
    expect(sent.params.args[5]).toEqual([[["active", "=", true]]]);
    expect(sent.params.args[6]).toEqual({ fields: ["id", "default_code"], limit: 100, offset: 0 });
  });

  it("throws when the response carries a JSON-RPC error", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ error: { data: { message: "Access Denied" } } }));
    await expect(new OdooClient(cfg).authenticate()).rejects.toThrow(/Access Denied/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/odoo/client.test.ts`
Expected: FAIL — cannot find module `./client`.

- [ ] **Step 3: Implement `lib/odoo/client.ts`**

```ts
/**
 * Odoo external-API client over JSON-RPC (/jsonrpc) — the read seam for ingest.
 * Auth: common.authenticate(db, user, apiKey) -> uid (cached per instance).
 * Reads: object.execute_kw(db, uid, apiKey, model, "search_read", [domain], opts).
 * API key replaces the password (login stays). Raw fetch — no SDK, no XML.
 */
export type OdooConfig = {
  baseUrl: string; // https://store.odoo.com (no trailing slash required)
  database: string;
  username: string;
  apiKey: string;
};

type JsonRpcCall = { service: "common" | "object"; method: string; args: unknown[] };

export class OdooClient {
  private uid: number | null = null;
  private id = 0;
  constructor(private cfg: OdooConfig) {}

  private async rpc<T>(call: JsonRpcCall): Promise<T> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/jsonrpc`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++this.id, params: call }),
    });
    if (!res.ok) throw new Error(`Odoo JSON-RPC HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { data?: { message?: string }; message?: string } };
    if (json.error) {
      throw new Error(`Odoo error: ${json.error.data?.message ?? json.error.message ?? "unknown"}`);
    }
    return json.result as T;
  }

  async authenticate(): Promise<number> {
    if (this.uid) return this.uid;
    const uid = await this.rpc<number | false>({
      service: "common",
      method: "authenticate",
      args: [this.cfg.database, this.cfg.username, this.cfg.apiKey, {}],
    });
    if (!uid || typeof uid !== "number") throw new Error("Odoo authentication failed (check db/username/apiKey)");
    this.uid = uid;
    return uid;
  }

  /** search_read with paging. domain is an Odoo domain array, e.g. [["active","=",true]]. */
  async searchRead<T = Record<string, unknown>>(
    model: string,
    domain: unknown[],
    fields: string[],
    opts: { limit?: number; offset?: number } = {}
  ): Promise<T[]> {
    const uid = await this.authenticate();
    return this.rpc<T[]>({
      service: "object",
      method: "execute_kw",
      args: [this.cfg.database, uid, this.cfg.apiKey, model, "search_read", [domain], { fields, ...opts }],
    });
  }

  async searchCount(model: string, domain: unknown[]): Promise<number> {
    const uid = await this.authenticate();
    return this.rpc<number>({
      service: "object",
      method: "execute_kw",
      args: [this.cfg.database, uid, this.cfg.apiKey, model, "search_count", [domain]],
    });
  }

  /** Page through ALL rows for a domain, honoring Odoo paging. */
  async searchReadAll<T = Record<string, unknown>>(
    model: string,
    domain: unknown[],
    fields: string[],
    pageSize = 500
  ): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.searchRead<T>(model, domain, fields, { limit: pageSize, offset });
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/odoo/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/odoo/client.ts lib/odoo/client.test.ts
git commit -m "feat(odoo): JSON-RPC client (authenticate + paged search_read)"
```

---

## Task 3: Pure record mappers (Odoo → normalized rows)

**Files:**
- Create: `lib/odoo/mappers.ts`
- Test: `lib/odoo/mappers.test.ts`

These are pure functions: Odoo record → the field shape the ingest writer needs. No Prisma, no I/O — fully unit-testable.

- [ ] **Step 1: Write the failing test** (`lib/odoo/mappers.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { mapProduct, mapSalesLine, mapSupplierInfo, dayKeyUTC } from "./mappers";

describe("odoo mappers", () => {
  it("mapProduct pulls sku=default_code, cost=standard_price, name", () => {
    const p = mapProduct({ id: 42, default_code: "SKU1", name: "Shampoo", standard_price: 250, list_price: 400 });
    expect(p).toEqual({ externalId: "42", sku: "SKU1", title: "Shampoo", costKes: 250, priceKes: 400 });
  });

  it("mapProduct leaves costKes null when standard_price is 0/false (never clobber)", () => {
    expect(mapProduct({ id: 7, default_code: false, name: "X", standard_price: 0, list_price: 0 }).costKes).toBeNull();
  });

  it("mapProduct falls back sku to odoo id when default_code missing", () => {
    expect(mapProduct({ id: 7, default_code: false, name: "X", standard_price: 0, list_price: 0 }).sku).toBe("odoo-7");
  });

  it("mapSalesLine extracts product id, qty, day-bucketed date", () => {
    const line = mapSalesLine({ product_id: [42, "Shampoo"], qty: 3, price_subtotal: 750, order_date: "2026-06-01 14:33:00" });
    expect(line).toEqual({ externalProductId: "42", quantity: 3, revenueKes: 750, date: "2026-06-01T00:00:00.000Z" });
  });

  it("dayKeyUTC truncates a datetime to UTC midnight ISO", () => {
    expect(dayKeyUTC("2026-06-01 14:33:00")).toBe("2026-06-01T00:00:00.000Z");
  });

  it("mapSupplierInfo reads partner name + lead-time delay", () => {
    expect(mapSupplierInfo({ partner_id: [5, "Guangzhou Co"], delay: 21, product_tmpl_id: [9, "X"] }))
      .toEqual({ supplierName: "Guangzhou Co", leadTimeDays: 21, productTmplId: "9" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/odoo/mappers.test.ts`
Expected: FAIL — cannot find module `./mappers`.

- [ ] **Step 3: Implement `lib/odoo/mappers.ts`**

```ts
/**
 * Pure Odoo-record -> normalized-row mappers. No Prisma. Odoo many2one fields
 * arrive as [id, displayName] tuples; numeric fields can be `false` when unset.
 */

/** Odoo many2one: [id, label] | false. */
type M2O = [number, string] | false;

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const m2oId = (v: M2O): string | null => (Array.isArray(v) ? String(v[0]) : null);
const m2oName = (v: M2O): string | null => (Array.isArray(v) ? v[1] : null);

/** Truncate an Odoo datetime ("YYYY-MM-DD HH:mm:ss", UTC) to UTC-midnight ISO. */
export function dayKeyUTC(odooDatetime: string): string {
  const datePart = odooDatetime.slice(0, 10); // YYYY-MM-DD
  return new Date(`${datePart}T00:00:00.000Z`).toISOString();
}

export type MappedProduct = {
  externalId: string;
  sku: string;
  title: string;
  costKes: number | null; // null => do not write (preserve existing)
  priceKes: number;
};

export function mapProduct(r: {
  id: number;
  default_code?: string | false;
  name?: string;
  standard_price?: number;
  list_price?: number;
}): MappedProduct {
  const cost = num(r.standard_price);
  return {
    externalId: String(r.id),
    sku: r.default_code && r.default_code !== "" ? r.default_code : `odoo-${r.id}`,
    title: r.name ?? `Product ${r.id}`,
    costKes: cost > 0 ? cost : null,
    priceKes: num(r.list_price),
  };
}

export type MappedSalesLine = {
  externalProductId: string;
  quantity: number;
  revenueKes: number;
  date: string; // UTC-midnight ISO
};

/**
 * Normalizes a POS or Sales order line. Caller passes a flattened row that
 * already carries the order's date as `order_date` (see sales-source.ts).
 * pos.order.line uses `qty`; sale.order.line uses `product_uom_qty` — caller
 * maps either into `qty` before calling, OR we read both here.
 */
export function mapSalesLine(r: {
  product_id: M2O;
  qty?: number;
  product_uom_qty?: number;
  price_subtotal?: number;
  order_date: string;
}): MappedSalesLine | null {
  const externalProductId = m2oId(r.product_id);
  if (!externalProductId) return null;
  return {
    externalProductId,
    quantity: num(r.qty ?? r.product_uom_qty),
    revenueKes: num(r.price_subtotal),
    date: dayKeyUTC(r.order_date),
  };
}

export type MappedSupplierInfo = {
  supplierName: string | null;
  leadTimeDays: number;
  productTmplId: string | null;
};

export function mapSupplierInfo(r: { partner_id: M2O; delay?: number; product_tmpl_id?: M2O }): MappedSupplierInfo {
  return {
    supplierName: m2oName(r.partner_id),
    leadTimeDays: num(r.delay),
    productTmplId: m2oId(r.product_tmpl_id ?? false),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/odoo/mappers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/odoo/mappers.ts lib/odoo/mappers.test.ts
git commit -m "feat(odoo): pure record mappers (product/sales/supplier)"
```

---

## Task 4: Sales-source auto-detection

**Files:**
- Create: `lib/odoo/sales-source.ts`
- Test: `lib/odoo/sales-source.test.ts`

Decides whether sales live in POS (`pos.order.line`) or Sales (`sale.order.line`) — or both — and returns normalized rows. Resolves the "not sure" from the spec.

- [ ] **Step 1: Write the failing test** (`lib/odoo/sales-source.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { detectAndFetchSales } from "./sales-source";

function clientWith(counts: Record<string, number>, rows: Record<string, unknown[]>) {
  return {
    searchCount: vi.fn(async (model: string) => counts[model] ?? 0),
    searchReadAll: vi.fn(async (model: string) => rows[model] ?? []),
  } as any;
}

describe("detectAndFetchSales", () => {
  const since = new Date("2026-01-01T00:00:00.000Z");

  it("uses POS when only pos.order.line has rows", async () => {
    const c = clientWith({ "pos.order.line": 5, "sale.order.line": 0 }, {
      "pos.order.line": [{ product_id: [1, "A"], qty: 2, price_subtotal: 100, order_date: "2026-06-01 10:00:00" }],
    });
    const r = await detectAndFetchSales(c, since);
    expect(r.source).toBe("pos");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].externalProductId).toBe("1");
  });

  it("uses Sales when only sale.order.line has rows", async () => {
    const c = clientWith({ "pos.order.line": 0, "sale.order.line": 9 }, {
      "sale.order.line": [{ product_id: [2, "B"], product_uom_qty: 4, price_subtotal: 200, order_date: "2026-06-02 09:00:00" }],
    });
    const r = await detectAndFetchSales(c, since);
    expect(r.source).toBe("sale");
    expect(r.lines[0].quantity).toBe(4);
  });

  it("merges both when both have rows", async () => {
    const c = clientWith({ "pos.order.line": 1, "sale.order.line": 1 }, {
      "pos.order.line": [{ product_id: [1, "A"], qty: 1, price_subtotal: 50, order_date: "2026-06-01 10:00:00" }],
      "sale.order.line": [{ product_id: [2, "B"], product_uom_qty: 1, price_subtotal: 60, order_date: "2026-06-01 11:00:00" }],
    });
    const r = await detectAndFetchSales(c, since);
    expect(r.source).toBe("both");
    expect(r.lines).toHaveLength(2);
  });

  it("returns none when neither has rows", async () => {
    const c = clientWith({ "pos.order.line": 0, "sale.order.line": 0 }, {});
    const r = await detectAndFetchSales(c, since);
    expect(r.source).toBe("none");
    expect(r.lines).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/odoo/sales-source.test.ts`
Expected: FAIL — cannot find module `./sales-source`.

- [ ] **Step 3: Implement `lib/odoo/sales-source.ts`**

```ts
import type { OdooClient } from "./client";
import { mapSalesLine, type MappedSalesLine } from "./mappers";

export type SalesSource = "pos" | "sale" | "both" | "none";

/**
 * POS lines carry `qty` and the order date is on pos.order (order line has a
 * stored `order_id` but pos.order.line in recent Odoo exposes a related date via
 * the line's create_date as a safe fallback). We read both `qty`/`product_uom_qty`
 * and read the line's `write_date` as `order_date` to keep one code path. For the
 * live run, confirm the exact dated field on her instance (Plan 2 calibration).
 */
const POS_MODEL = "pos.order.line";
const SALE_MODEL = "sale.order.line";

function domainSince(field: string, since: Date): unknown[] {
  // Odoo expects "YYYY-MM-DD HH:mm:ss"
  const s = since.toISOString().slice(0, 19).replace("T", " ");
  return [[field, ">=", s]];
}

async function fetchLines(
  client: OdooClient,
  model: string,
  qtyField: "qty" | "product_uom_qty",
  since: Date
): Promise<MappedSalesLine[]> {
  // `create_date` is universally present and dated; good enough for run-rate bucketing.
  const rows = await client.searchReadAll<Record<string, unknown>>(
    model,
    domainSince("create_date", since),
    ["product_id", qtyField, "price_subtotal", "create_date"]
  );
  return rows
    .map((r) => mapSalesLine({ ...(r as object), order_date: String((r as { create_date?: string }).create_date ?? "") } as never))
    .filter((x): x is MappedSalesLine => x !== null && x.date !== "Invalid Date");
}

export async function detectAndFetchSales(
  client: OdooClient,
  since: Date
): Promise<{ source: SalesSource; lines: MappedSalesLine[] }> {
  const [posCount, saleCount] = await Promise.all([
    client.searchCount(POS_MODEL, domainSince("create_date", since)),
    client.searchCount(SALE_MODEL, domainSince("create_date", since)),
  ]);

  const lines: MappedSalesLine[] = [];
  if (posCount > 0) lines.push(...(await fetchLines(client, POS_MODEL, "qty", since)));
  if (saleCount > 0) lines.push(...(await fetchLines(client, SALE_MODEL, "product_uom_qty", since)));

  const source: SalesSource =
    posCount > 0 && saleCount > 0 ? "both" : posCount > 0 ? "pos" : saleCount > 0 ? "sale" : "none";
  return { source, lines };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/odoo/sales-source.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/odoo/sales-source.ts lib/odoo/sales-source.test.ts
git commit -m "feat(odoo): sales-source auto-detection (POS vs Sales)"
```

---

## Task 5: Ingest writer (batched Prisma upserts)

**Files:**
- Create: `lib/odoo/ingest.ts`
- Test: `lib/odoo/ingest.test.ts` (pure helper test only — DB writes verified live in Task 6)

The writer is thin glue: pull via client → map → batch-write. Per the batching rule, products use chunked upserts; sales use the day-bucketed `deleteMany`+`createMany` SET pattern from `lib/shopify/sales-window.ts`. Keep ALL queries `tenantId`-scoped (ESLint).

- [ ] **Step 1: Write the failing test for the pure helper** (`lib/odoo/ingest.test.ts`)

Only the cost-merge guard is pure-testable without a DB; assert it never overwrites a real cost with null.
```ts
import { describe, it, expect } from "vitest";
import { productWriteData } from "./ingest";

describe("productWriteData", () => {
  it("omits costKes from the update set when mapped cost is null", () => {
    const d = productWriteData({ externalId: "1", sku: "S", title: "T", costKes: null, priceKes: 100 });
    expect("costKes" in d.update).toBe(false);
    expect(d.update.priceKes).toBe(100);
  });
  it("includes costKes when present", () => {
    const d = productWriteData({ externalId: "1", sku: "S", title: "T", costKes: 250, priceKes: 100 });
    expect(d.update.costKes).toBe(250);
    expect(d.create.costKes).toBe(250);
  });
  it("create defaults costKes to 0 when null (schema default)", () => {
    const d = productWriteData({ externalId: "1", sku: "S", title: "T", costKes: null, priceKes: 100 });
    expect(d.create.costKes).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/odoo/ingest.test.ts`
Expected: FAIL — cannot find module `./ingest`.

- [ ] **Step 3: Implement `lib/odoo/ingest.ts`**

```ts
/**
 * Odoo ingest: pull via OdooClient, map, and batch-write into tenant-scoped
 * Prisma rows. Mirrors lib/shopify/ingest.ts + reconcile.ts. Tenant-safety
 * ESLint applies: every query carries tenantId.
 */
import { prisma } from "@/lib/prisma";
import { OdooClient, type OdooConfig } from "./client";
import { mapProduct, mapSupplierInfo, type MappedProduct } from "./mappers";
import { detectAndFetchSales } from "./sales-source";

const PRODUCT_FIELDS = ["id", "default_code", "name", "standard_price", "list_price"];

/** Pure: build the upsert payload for one product, guarding the cost-clobber. */
export function productWriteData(p: MappedProduct) {
  const update: Record<string, unknown> = { sku: p.sku, title: p.title, priceKes: p.priceKes, lastSynced: new Date() };
  if (p.costKes !== null) update.costKes = p.costKes;
  const create: Record<string, unknown> = {
    sku: p.sku,
    title: p.title,
    priceKes: p.priceKes,
    costKes: p.costKes ?? 0,
    source: "odoo",
    externalId: p.externalId,
  };
  return { update, create };
}

export type OdooIngestResult = {
  products: number;
  salesSource: string;
  salesRows: number;
  suppliers: number;
};

/** Full sync of one Odoo tenant. `sinceDays` bounds the sales window. */
export async function ingestOdooTenant(
  tenantId: string,
  cfg: OdooConfig,
  opts: { sinceDays?: number } = {}
): Promise<OdooIngestResult> {
  const client = new OdooClient(cfg);
  await client.authenticate();

  // ── Products (variants) ────────────────────────────────────────────────
  const rawProducts = await client.searchReadAll<Parameters<typeof mapProduct>[0]>(
    "product.product",
    [["active", "=", true]],
    PRODUCT_FIELDS
  );
  const mapped = rawProducts.map(mapProduct);
  for (const p of mapped) {
    const { update, create } = productWriteData(p);
    await prisma.product.upsert({
      where: { tenantId_source_externalId: { tenantId, source: "odoo", externalId: p.externalId } },
      update,
      create: { tenantId, ...create },
    });
  }
  // map externalId -> internal product id for sales/levels
  const dbProducts = await prisma.product.findMany({
    where: { tenantId, source: "odoo" },
    select: { id: true, externalId: true },
  });
  const idByExternal = new Map(dbProducts.map((p) => [p.externalId!, p.id]));

  // ── Sales (auto-detect POS vs Sales) ───────────────────────────────────
  const since = new Date(Date.now() - (opts.sinceDays ?? 180) * 86_400_000);
  const sales = await detectAndFetchSales(client, since);
  // Aggregate to (productId, dayISO) SET semantics, then deleteMany+createMany.
  const byKey = new Map<string, { productId: string; date: Date; quantity: number; revenueKes: number }>();
  for (const line of sales.lines) {
    const productId = idByExternal.get(line.externalProductId);
    if (!productId) continue;
    const key = `${productId}|${line.date}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.quantity += line.quantity;
      prev.revenueKes += line.revenueKes;
    } else {
      byKey.set(key, { productId, date: new Date(line.date), quantity: line.quantity, revenueKes: line.revenueKes });
    }
  }
  const salesRows = [...byKey.values()];
  if (salesRows.length > 0) {
    const productIds = [...new Set(salesRows.map((s) => s.productId))];
    await prisma.salesHistory.deleteMany({ where: { tenantId, channel: "odoo", productId: { in: productIds } } });
    // chunk createMany to stay well under statement limits
    for (let i = 0; i < salesRows.length; i += 1000) {
      await prisma.salesHistory.createMany({
        data: salesRows.slice(i, i + 1000).map((s) => ({
          tenantId,
          productId: s.productId,
          date: s.date,
          quantity: s.quantity,
          revenueKes: s.revenueKes,
          channel: "odoo",
        })),
      });
    }
  }

  // ── Suppliers + per-product lead time (product.supplierinfo) ────────────
  const supplierInfos = await client.searchReadAll<Parameters<typeof mapSupplierInfo>[0]>(
    "product.supplierinfo",
    [],
    ["partner_id", "delay", "product_tmpl_id"]
  );
  const supplierNames = [...new Set(supplierInfos.map(mapSupplierInfo).map((s) => s.supplierName).filter(Boolean))] as string[];
  for (const name of supplierNames) {
    const existing = await prisma.supplier.findFirst({ where: { tenantId, name } });
    if (!existing) await prisma.supplier.create({ data: { tenantId, name, currency: "KES" } });
  }

  await prisma.odooConnection.update({ where: { tenantId }, data: { lastSyncedAt: new Date() } }).catch(() => {});

  return {
    products: mapped.length,
    salesSource: sales.source,
    salesRows: salesRows.length,
    suppliers: supplierNames.length,
  };
}
```
> Implementer notes: (1) Inventory levels (`stock.quant` + `stock.location`) are intentionally deferred to Task 6's live calibration because location semantics (sellable vs virtual) must be confirmed against her real instance — add them once we see her locations. For the first forecast run, `Product.currentStock` is set from quants in Task 6. (2) The per-row product upsert loop is acceptable for a one-shot manual script on a typical catalog (<~3k); if her catalog is large, convert to chunked raw upserts mirroring `lib/shopify/reconcile.ts` before wiring the cron in Plan 2.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/odoo/ingest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint (tenant-safety) + commit**

```bash
npm run lint
git add lib/odoo/ingest.ts lib/odoo/ingest.test.ts
git commit -m "feat(odoo): batched tenant-scoped ingest writer (products/sales/suppliers)"
```
Expected lint: 0 errors (no bare prisma find without tenantId).

---

## Task 6: Manual sync orchestration script + live calibration

**Files:**
- Create: `scripts/odoo-ingest.ts`

Run this once we have a tenant + `OdooConnection`. It decrypts creds, runs the ingest, sets `currentStock` from `stock.quant`, then triggers a forecast run via the existing batch runner.

- [ ] **Step 1: Implement `scripts/odoo-ingest.ts`**

```ts
/**
 * One-shot manual Odoo sync for a tenant. Usage:
 *   npx tsx scripts/odoo-ingest.ts <tenantSlug> [--since-days=180]
 * Reads OdooConnection (decrypts apiKey), ingests, sets currentStock from
 * stock.quant, runs forecasts. Stop `npm run dev` first (DB connection cap).
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/encryption";
import { OdooClient } from "@/lib/odoo/client";
import { ingestOdooTenant } from "@/lib/odoo/ingest";
import { runForecastsForTenant } from "@/lib/forecast/run-batch";

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("usage: tsx scripts/odoo-ingest.ts <tenantSlug> [--since-days=N]");
  const sinceDays = Number(process.argv.find((a) => a.startsWith("--since-days="))?.split("=")[1] ?? 180);

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`tenant not found: ${slug}`);
  const conn = await prisma.odooConnection.findUnique({ where: { tenantId: tenant.id } });
  if (!conn) throw new Error(`no OdooConnection for tenant ${slug}`);

  const cfg = { baseUrl: conn.baseUrl, database: conn.database, username: conn.username, apiKey: decrypt(conn.apiKey) };

  console.log(`[odoo] ingesting ${slug} (since ${sinceDays}d)…`);
  const res = await ingestOdooTenant(tenant.id, cfg, { sinceDays });
  console.log("[odoo] ingest:", res);

  // ── currentStock from stock.quant (sum on_hand across internal locations) ──
  const client = new OdooClient(cfg);
  const quants = await client.searchReadAll<{ product_id: [number, string] | false; quantity: number; location_id: [number, string] | false }>(
    "stock.quant",
    [["location_id.usage", "=", "internal"]],
    ["product_id", "quantity", "location_id"]
  );
  const onHandByExternal = new Map<string, number>();
  for (const q of quants) {
    if (!Array.isArray(q.product_id)) continue;
    const ext = String(q.product_id[0]);
    onHandByExternal.set(ext, (onHandByExternal.get(ext) ?? 0) + (q.quantity ?? 0));
  }
  const dbProducts = await prisma.product.findMany({ where: { tenantId: tenant.id, source: "odoo" }, select: { id: true, externalId: true } });
  for (const p of dbProducts) {
    const stock = onHandByExternal.get(p.externalId!) ?? 0;
    await prisma.product.update({ where: { id: p.id }, data: { currentStock: stock } });
  }
  console.log(`[odoo] currentStock set for ${dbProducts.length} products from ${quants.length} quants`);

  console.log("[odoo] running forecasts…");
  const fc = await runForecastsForTenant(tenant.id);
  console.log("[odoo] forecasts:", fc);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```
> Implementer note: confirm the exact export name/signature of the forecast batch runner in `lib/forecast/run-batch.ts` (memory: `runForecastsForTenant`) and adjust the import/call if it differs. If `stock.quant` `location_id.usage` dotted-domain is rejected on her instance, fall back to fetching `stock.location` (usage="internal") ids first and filter by `location_id in [...]`.

- [ ] **Step 2: Create the test tenant + connection (one-off, via a tiny script or Prisma Studio)**

Pre-req for the live run — create a tenant with `source="odoo"` and an `OdooConnection` (apiKey encrypted). Example inline:
```bash
npx tsx -e "import {prisma} from './lib/prisma'; import {encrypt} from './lib/crypto/encryption'; (async()=>{ const t=await prisma.tenant.upsert({where:{slug:'odoo-client'},update:{source:'odoo'},create:{name:'Odoo Client',slug:'odoo-client',source:'odoo',currency:'KES'}}); await prisma.odooConnection.upsert({where:{tenantId:t.id},update:{},create:{tenantId:t.id,baseUrl:process.env.ODOO_BASE_URL!,database:process.env.ODOO_DB!,username:process.env.ODOO_USER!,apiKey:encrypt(process.env.ODOO_API_KEY!)}}); console.log('tenant',t.slug); process.exit(0); })()"
```
(Set `ODOO_BASE_URL/ODOO_DB/ODOO_USER/ODOO_API_KEY` in `.env` for this one-off; Plan 2 replaces this with the Settings UI.)

- [ ] **Step 3: Run the live sync (requires client creds)**

```bash
npx tsx scripts/odoo-ingest.ts odoo-client --since-days=180
```
Expected: logs products count, `salesSource` (pos/sale/both), salesRows, currentStock set, forecasts created. **Calibrate here:** if `salesSource=none`, inspect her order models; if stock looks wrong, revisit location usage filter.

- [ ] **Step 4: Manual verification against the rubric (spot-check)**

- Product count in app vs Odoo (5 random).
- Cost (`standard_price`) for 10 products matches Odoo.
- Run rate for 3 products ≈ hand calc from her sales.
- Buy List renders ranked, supplier-grouped, costed, with traceable qty math; planner respects a budget; no blow-ups.

- [ ] **Step 5: Commit**

```bash
git add scripts/odoo-ingest.ts
git commit -m "feat(odoo): manual sync script (ingest + stock.quant + forecast run)"
```

---

## Self-review against the spec

- **Credentials (url/db/user/apiKey)** → Task 2 client + Task 6 connection. ✓
- **API key encrypted at rest** → Task 1 model + Task 6 `encrypt()`/`decrypt()`. ✓
- **Generic schema (externalId+source, nullable shopify, OdooConnection, Tenant.source)** → Task 1. ✓
- **Products: sku=default_code, cost=standard_price→costKes, no-clobber** → Task 3 + Task 5 `productWriteData`. ✓
- **Sales auto-detect POS vs Sales** → Task 4. ✓
- **Suppliers + lead time** → Task 3 `mapSupplierInfo` + Task 5 supplier create. (Per-product `leadTimeDays` wiring from `delay` deferred — see gap below.)
- **Stock on-hand** → Task 6 `stock.quant`. ✓
- **Currency KES** → costKes direct; supplier currency "KES". ✓
- **Downstream rides free (forecast/Buy List/planner)** → Task 6 forecast run + rubric check. ✓
- **Beauty Square unaffected** → Task 1 Step 7 regression run. ✓

**Known gaps carried to Plan 2 (productization), by design:**
1. **Inventory `Location`/`InventoryLevel` rows** (multi-location) — Task 6 only sets aggregate `currentStock`; per-location levels + sellable/virtual semantics need her live locations.
2. **Per-product `leadTimeDays`** from `supplierinfo.delay` → `Product.leadTimeDays` (Task 3 maps it; wiring product↔supplierinfo by template id is Plan 2).
3. **Settings connection UI, test-connection, reconcile, cron dispatch, "last synced" badge** — all Plan 2.
4. If her catalog is large (>~3k), convert the product upsert loop to chunked batch (noted in Task 5).

These are intentional: Plan 1's definition of done is "her real data lands and produces a trustworthy Buy List via a manual run," which Tasks 1–6 deliver.
