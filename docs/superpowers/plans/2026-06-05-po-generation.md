# PO Generation (PDF + XLSX, supplier-grouped) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn approved reorder Orders into per-supplier Purchase Orders, downloadable as PDF + XLSX, on a new Purchase Orders page. (The core "generate the PO" value.)

**Architecture:** New `PurchaseOrder`/`PurchaseOrderLine` models. A pure grouping function (unit-tested) turns approved Orders → per-supplier PO drafts; a thin service persists them. PDF via `@react-pdf/renderer` (server `renderToBuffer`), XLSX via `exceljs`. Routes generate/list/download. Email (Resend) + QuickBooks push are wired as deferred stubs (keys empty). KES-only for now (no FX).

**Tech Stack:** Next.js 16 App Router (Node runtime for render routes), Prisma 6 + Supabase, `@react-pdf/renderer`, `exceljs`, vitest, tenant-safety ESLint.

## Spec (locked decisions)
- PO grouped by supplier; KES only (per-supplier FX deferred — Roy 2026-06-05).
- PDF = `@react-pdf/renderer`; XLSX = `exceljs`.
- Source = `Order` rows with `status:"approved"` not yet linked to a PO. Qty = the Order's `Prediction.recommendedQty`; unit cost = `Product.costKes`.
- Resend email send + QuickBooks `PurchaseOrder` push are DEFERRED (env keys empty) — build the compose/stub, disable the UI, do not call external APIs.
- Multi-tenant: every query carries `tenantId` (tenant-safety ESLint).

## File Structure
- Modify `prisma/schema.prisma` — `PurchaseOrder`, `PurchaseOrderLine`, add `purchaseOrderId String?` + relation to `Order`, back-relations on `Tenant`/`Supplier`/`Product`.
- Create migration (diff+deploy).
- Create `lib/po/group.ts` — pure `groupOrdersIntoPos(rows)` + `formatPoNumber(seq, date)`.
- Create `lib/po/group.test.ts` — grouping + numbering tests.
- Create `lib/po/service.ts` — `generatePurchaseOrders(tenantId)` (DB), `listPurchaseOrders(tenantId)`, `getPurchaseOrder(tenantId, id)`.
- Create `lib/po/pdf.tsx` — `renderPoPdf(po): Promise<Buffer>`.
- Create `lib/po/xlsx.ts` — `renderPoXlsx(po): Promise<Buffer>`.
- Create `lib/po/email.ts` — `sendPoEmail(po)` deferred stub.
- Create `app/api/purchase-orders/route.ts` (GET list), `app/api/purchase-orders/generate/route.ts` (POST), `app/api/purchase-orders/[id]/pdf/route.ts`, `app/api/purchase-orders/[id]/xlsx/route.ts`.
- Create `app/shop/[slug]/purchase-orders/page.tsx` — list + Generate + downloads.
- Modify the shop nav header to link Purchase Orders (match existing nav pattern).

## Environment rules (read once)
- Stop the dev server before `prisma migrate`/`tsx` DB scripts (Supabase pooler cap). Migration: `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<ts>_add_purchase_orders/migration.sql` then `prisma migrate deploy` + `prisma generate`. NEVER `migrate dev`.
- Prisma singleton `@/lib/prisma`. Every query carries `tenantId`.
- Render routes (`pdf`, `xlsx`) MUST set `export const runtime = "nodejs"` (react-pdf/exceljs are Node-only, not edge).
- Branch `main`; one commit per task. Trailer EXACTLY:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Install deps + models + migration

**Files:** `package.json`, `prisma/schema.prisma`, migration.

- [ ] **Step 1: Install libs**

Run: `npm install @react-pdf/renderer exceljs`
Expected: both added to dependencies, no error.

- [ ] **Step 2: Add models + relations to `prisma/schema.prisma`**

```prisma
model PurchaseOrder {
  id          String    @id @default(cuid())
  tenantId    String
  supplierId  String
  poNumber    String
  status      String    @default("draft") // draft | sent
  currency    String    @default("KES")
  subtotalKes Float     @default(0)
  createdAt   DateTime  @default(now())
  sentAt      DateTime?

  tenant   Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  supplier Supplier            @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  lines    PurchaseOrderLine[]
  orders   Order[]

  @@unique([tenantId, poNumber])
  @@index([tenantId])
}

model PurchaseOrderLine {
  id              String @id @default(cuid())
  purchaseOrderId String
  productId       String
  sku             String
  title           String
  quantity        Int
  unitCostKes     Float
  lineTotalKes    Float

  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  product       Product       @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([purchaseOrderId])
}
```

Add to `model Order`: a nullable link + relation:
```prisma
  purchaseOrderId String?
  purchaseOrder   PurchaseOrder? @relation(fields: [purchaseOrderId], references: [id], onDelete: SetNull)
```
Add back-relations: `model Tenant` → `purchaseOrders PurchaseOrder[]`; `model Supplier` → `purchaseOrders PurchaseOrder[]`; `model Product` → `purchaseOrderLines PurchaseOrderLine[]`.

- [ ] **Step 3: Validate**

Run: `npx prisma validate`
Expected: valid.

- [ ] **Step 4: Migration (dev server stopped)**

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260605130000_add_purchase_orders/migration.sql
grep -E "DROP TABLE|DROP COLUMN|DELETE FROM" prisma/migrations/20260605130000_add_purchase_orders/migration.sql || echo "additive-only OK"
npx prisma migrate deploy
npx prisma generate
```
Expected: additive-only OK; deploy applies; generate ok.

- [ ] **Step 5: Confirm tables (read-only)**

Run: `npx tsx -e "import 'dotenv/config';import{prisma}from'./lib/prisma';prisma.purchaseOrder.count().then(c=>{console.log('pos='+c);process.exit(0)})"`
Expected: `pos=0`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json prisma/schema.prisma prisma/migrations
git commit -m "feat(po): PurchaseOrder models + react-pdf/exceljs deps + migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure grouping + numbering (TDD)

**Files:** `lib/po/group.ts`, `lib/po/group.test.ts`

- [ ] **Step 1: Write the failing test `lib/po/group.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { groupOrdersIntoPos, formatPoNumber, type ApprovedOrderRow } from "./group";

const rows: ApprovedOrderRow[] = [
  { orderId: "o1", supplierId: "s1", productId: "p1", sku: "A1", title: "Item 1", quantity: 10, unitCostKes: 100 },
  { orderId: "o2", supplierId: "s1", productId: "p2", sku: "A2", title: "Item 2", quantity: 5,  unitCostKes: 200 },
  { orderId: "o3", supplierId: "s2", productId: "p3", sku: "B1", title: "Item 3", quantity: 3,  unitCostKes: 50 },
  { orderId: "o4", supplierId: null, productId: "p4", sku: "C1", title: "Item 4", quantity: 7,  unitCostKes: 10 }, // no supplier — skipped
];

describe("groupOrdersIntoPos", () => {
  it("groups by supplier, sums line + subtotal, links order ids", () => {
    const pos = groupOrdersIntoPos(rows);
    const s1 = pos.find((p) => p.supplierId === "s1")!;
    expect(s1.lines).toHaveLength(2);
    expect(s1.subtotalKes).toBe(10 * 100 + 5 * 200); // 2000
    expect(s1.orderIds.sort()).toEqual(["o1", "o2"]);
    expect(s1.lines[0]).toMatchObject({ productId: "p1", sku: "A1", quantity: 10, unitCostKes: 100, lineTotalKes: 1000 });
  });

  it("creates one PO per supplier", () => {
    const pos = groupOrdersIntoPos(rows);
    expect(pos.map((p) => p.supplierId).sort()).toEqual(["s1", "s2"]);
  });

  it("skips rows with no supplier (cannot PO without a vendor)", () => {
    const pos = groupOrdersIntoPos(rows);
    expect(pos.flatMap((p) => p.lines).some((l) => l.productId === "p4")).toBe(false);
  });

  it("skips non-positive quantities", () => {
    const pos = groupOrdersIntoPos([{ orderId: "x", supplierId: "s9", productId: "p9", sku: "Z", title: "Z", quantity: 0, unitCostKes: 5 }]);
    expect(pos).toHaveLength(0);
  });
});

describe("formatPoNumber", () => {
  it("zero-pads a 4-digit sequence with a date prefix", () => {
    expect(formatPoNumber(1, new Date("2026-06-05T00:00:00Z"))).toBe("PO-20260605-0001");
    expect(formatPoNumber(42, new Date("2026-06-05T00:00:00Z"))).toBe("PO-20260605-0042");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/po/group.test.ts` → module not found.

- [ ] **Step 3: Implement `lib/po/group.ts`**

```ts
/** Pure grouping of approved reorder orders into per-supplier PO drafts. No I/O. */

export type ApprovedOrderRow = {
  orderId: string;
  supplierId: string | null;
  productId: string;
  sku: string;
  title: string;
  quantity: number;
  unitCostKes: number;
};

export type PoLineDraft = {
  productId: string;
  sku: string;
  title: string;
  quantity: number;
  unitCostKes: number;
  lineTotalKes: number;
};

export type PoDraft = {
  supplierId: string;
  lines: PoLineDraft[];
  subtotalKes: number;
  orderIds: string[];
};

export function groupOrdersIntoPos(rows: ApprovedOrderRow[]): PoDraft[] {
  const bySupplier = new Map<string, PoDraft>();
  for (const r of rows) {
    if (!r.supplierId) continue; // cannot raise a PO without a vendor
    if (r.quantity <= 0) continue;
    const lineTotalKes = r.quantity * r.unitCostKes;
    let po = bySupplier.get(r.supplierId);
    if (!po) {
      po = { supplierId: r.supplierId, lines: [], subtotalKes: 0, orderIds: [] };
      bySupplier.set(r.supplierId, po);
    }
    po.lines.push({ productId: r.productId, sku: r.sku, title: r.title, quantity: r.quantity, unitCostKes: r.unitCostKes, lineTotalKes });
    po.subtotalKes += lineTotalKes;
    po.orderIds.push(r.orderId);
  }
  return [...bySupplier.values()];
}

export function formatPoNumber(seq: number, date: Date): string {
  const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  return `PO-${ymd}-${String(seq).padStart(4, "0")}`;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run lib/po/group.test.ts` → all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/po/group.ts lib/po/group.test.ts
git commit -m "feat(po): pure supplier-grouping + PO numbering (tested)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: PO service (persist / list / get)

**Files:** `lib/po/service.ts`

- [ ] **Step 1: Implement `lib/po/service.ts`**

```ts
/**
 * Purchase-order persistence. generatePurchaseOrders() pulls approved Orders not
 * yet attached to a PO, groups them by supplier (lib/po/group), and writes one
 * PurchaseOrder (+ lines) per supplier, linking the source Orders. Tenant-scoped.
 */
import { prisma } from "@/lib/prisma";
import { groupOrdersIntoPos, formatPoNumber, type ApprovedOrderRow } from "./group";

export async function generatePurchaseOrders(tenantId: string) {
  // Approved reorder orders not yet on a PO, with their prediction qty + product/supplier/cost.
  const orders = await prisma.order.findMany({
    where: { tenantId, status: "approved", purchaseOrderId: null },
    select: {
      id: true,
      prediction: {
        select: {
          recommendedQty: true,
          product: { select: { id: true, sku: true, title: true, costKes: true, supplierId: true } },
        },
      },
    },
  });

  const rows: ApprovedOrderRow[] = orders.map((o) => ({
    orderId: o.id,
    supplierId: o.prediction.product.supplierId,
    productId: o.prediction.product.id,
    sku: o.prediction.product.sku,
    title: o.prediction.product.title,
    quantity: o.prediction.recommendedQty,
    unitCostKes: o.prediction.product.costKes,
  }));

  const drafts = groupOrdersIntoPos(rows);
  if (drafts.length === 0) return { created: 0, purchaseOrders: [] as { id: string; poNumber: string }[] };

  let seq = await prisma.purchaseOrder.count({ where: { tenantId } });
  const now = new Date();
  const created: { id: string; poNumber: string }[] = [];

  for (const d of drafts) {
    seq += 1;
    const poNumber = formatPoNumber(seq, now);
    const po = await prisma.purchaseOrder.create({
      data: {
        tenantId,
        supplierId: d.supplierId,
        poNumber,
        status: "draft",
        currency: "KES",
        subtotalKes: d.subtotalKes,
        lines: {
          create: d.lines.map((l) => ({
            productId: l.productId,
            sku: l.sku,
            title: l.title,
            quantity: l.quantity,
            unitCostKes: l.unitCostKes,
            lineTotalKes: l.lineTotalKes,
          })),
        },
      },
      select: { id: true, poNumber: true },
    });
    await prisma.order.updateMany({
      where: { tenantId, id: { in: d.orderIds } },
      data: { purchaseOrderId: po.id },
    });
    created.push(po);
  }
  return { created: created.length, purchaseOrders: created };
}

export async function listPurchaseOrders(tenantId: string) {
  return prisma.purchaseOrder.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, poNumber: true, status: true, currency: true, subtotalKes: true, createdAt: true, sentAt: true,
      supplier: { select: { name: true, country: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function getPurchaseOrder(tenantId: string, id: string) {
  return prisma.purchaseOrder.findFirst({
    where: { tenantId, id },
    select: {
      id: true, poNumber: true, status: true, currency: true, subtotalKes: true, createdAt: true,
      supplier: { select: { name: true, country: true, currency: true, leadTimeAvgDays: true } },
      lines: { select: { sku: true, title: true, quantity: true, unitCostKes: true, lineTotalKes: true } },
    },
  });
}

export type PurchaseOrderDetail = NonNullable<Awaited<ReturnType<typeof getPurchaseOrder>>>;
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "po/service" || echo "service typecheck clean"` → clean.
Run: `npm run lint 2>&1 | tail -3` → 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/po/service.ts
git commit -m "feat(po): generate/list/get purchase-order service (tenant-scoped)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: PDF + XLSX renderers

**Files:** `lib/po/pdf.tsx`, `lib/po/xlsx.ts`

- [ ] **Step 1: Implement `lib/po/pdf.tsx`**

```tsx
/** Render a PurchaseOrder to a PDF buffer via @react-pdf/renderer (server-side). */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { PurchaseOrderDetail } from "./service";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 18, marginBottom: 4 },
  muted: { color: "#666", marginBottom: 12 },
  row: { flexDirection: "row", borderBottom: "1 solid #ddd", paddingVertical: 4 },
  head: { flexDirection: "row", borderBottom: "1 solid #000", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  cSku: { width: "18%" }, cTitle: { width: "42%" }, cQty: { width: "12%", textAlign: "right" },
  cUnit: { width: "14%", textAlign: "right" }, cTot: { width: "14%", textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10, fontFamily: "Helvetica-Bold" },
});

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export async function renderPoPdf(po: PurchaseOrderDetail): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Purchase Order {po.poNumber}</Text>
        <Text style={styles.muted}>
          Supplier: {po.supplier.name}{po.supplier.country ? ` (${po.supplier.country})` : ""} • Lead time ~{po.supplier.leadTimeAvgDays}d{"\n"}
          Date: {new Date(po.createdAt).toLocaleDateString("en-KE")} • Status: {po.status}
        </Text>
        <View style={styles.head}>
          <Text style={styles.cSku}>SKU</Text><Text style={styles.cTitle}>Product</Text>
          <Text style={styles.cQty}>Qty</Text><Text style={styles.cUnit}>Unit</Text><Text style={styles.cTot}>Total</Text>
        </View>
        {po.lines.map((l, i) => (
          <View style={styles.row} key={i}>
            <Text style={styles.cSku}>{l.sku}</Text><Text style={styles.cTitle}>{l.title}</Text>
            <Text style={styles.cQty}>{l.quantity}</Text>
            <Text style={styles.cUnit}>{kes(l.unitCostKes)}</Text>
            <Text style={styles.cTot}>{kes(l.lineTotalKes)}</Text>
          </View>
        ))}
        <View style={styles.total}><Text>Subtotal: {kes(po.subtotalKes)}</Text></View>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
```

- [ ] **Step 2: Implement `lib/po/xlsx.ts`**

```ts
/** Render a PurchaseOrder to an XLSX buffer via exceljs. */
import ExcelJS from "exceljs";
import type { PurchaseOrderDetail } from "./service";

export async function renderPoXlsx(po: PurchaseOrderDetail): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(po.poNumber);
  ws.addRow([`Purchase Order ${po.poNumber}`]);
  ws.addRow([`Supplier`, po.supplier.name, po.supplier.country ?? ""]);
  ws.addRow([`Date`, new Date(po.createdAt).toLocaleDateString("en-KE"), `Status`, po.status]);
  ws.addRow([]);
  const header = ws.addRow(["SKU", "Product", "Qty", "Unit (KES)", "Total (KES)"]);
  header.font = { bold: true };
  for (const l of po.lines) {
    ws.addRow([l.sku, l.title, l.quantity, l.unitCostKes, l.lineTotalKes]);
  }
  ws.addRow([]);
  ws.addRow(["", "", "", "Subtotal (KES)", po.subtotalKes]).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 18; });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "po/pdf|po/xlsx" || echo "renderers typecheck clean"` → clean.
(If react-pdf JSX errors: ensure `tsconfig.json` `jsx` is `preserve` (it is) and the file is `.tsx`.)

- [ ] **Step 4: Commit**

```bash
git add lib/po/pdf.tsx lib/po/xlsx.ts
git commit -m "feat(po): PDF (@react-pdf/renderer) + XLSX (exceljs) renderers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Deferred email stub

**Files:** `lib/po/email.ts`

- [ ] **Step 1: Implement `lib/po/email.ts`**

```ts
/**
 * Supplier PO email (Resend) — DEFERRED. RESEND_API_KEY is not yet provisioned, so
 * this composes the message but does NOT send unless a key is present. When the key
 * arrives, the send path activates with no caller change.
 */
import type { PurchaseOrderDetail } from "./service";

export type EmailResult = { sent: boolean; reason?: string };

export function composePoEmail(po: PurchaseOrderDetail, toEmail: string) {
  const subject = `Purchase Order ${po.poNumber} — ${po.supplier.name}`;
  const lines = po.lines.map((l) => `• ${l.quantity} × ${l.title} (${l.sku})`).join("\n");
  const text = `Hello ${po.supplier.name},\n\nPlease find Purchase Order ${po.poNumber}:\n\n${lines}\n\nSubtotal: KES ${po.subtotalKes.toLocaleString("en-KE")}\n\nThank you.`;
  return { to: toEmail, subject, text };
}

export async function sendPoEmail(po: PurchaseOrderDetail, toEmail: string): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "RESEND_API_KEY not configured (deferred)" };
  // When the key exists: POST to Resend. Left intentionally minimal until provisioned.
  const { subject, text, to } = composePoEmail(po, toEmail);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "orders@example.com", to, subject, text }),
  });
  if (!res.ok) return { sent: false, reason: `Resend HTTP ${res.status}` };
  return { sent: true };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "po/email" || echo "email typecheck clean"` → clean.
```bash
git add lib/po/email.ts
git commit -m "feat(po): Resend email compose + deferred send stub (no key yet)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: API routes

**Files:** `app/api/purchase-orders/route.ts`, `app/api/purchase-orders/generate/route.ts`, `app/api/purchase-orders/[id]/pdf/route.ts`, `app/api/purchase-orders/[id]/xlsx/route.ts`

- [ ] **Step 1: `app/api/purchase-orders/route.ts` (GET list)**

```ts
import { NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { listPurchaseOrders } from "@/lib/po/service";

export async function GET() {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const pos = await listPurchaseOrders(ctx.tenant.id);
  return NextResponse.json({ purchaseOrders: pos });
}
```

- [ ] **Step 2: `app/api/purchase-orders/generate/route.ts` (POST)**

```ts
import { NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { generatePurchaseOrders } from "@/lib/po/service";

export async function POST() {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const result = await generatePurchaseOrders(ctx.tenant.id);
  return NextResponse.json(result);
}
```

- [ ] **Step 3: `app/api/purchase-orders/[id]/pdf/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { getPurchaseOrder } from "@/lib/po/service";
import { renderPoPdf } from "@/lib/po/pdf";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const po = await getPurchaseOrder(ctx.tenant.id, id);
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await renderPoPdf(po);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${po.poNumber}.pdf"`,
    },
  });
}
```

- [ ] **Step 4: `app/api/purchase-orders/[id]/xlsx/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { getPurchaseOrder } from "@/lib/po/service";
import { renderPoXlsx } from "@/lib/po/xlsx";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const po = await getPurchaseOrder(ctx.tenant.id, id);
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await renderPoXlsx(po);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${po.poNumber}.xlsx"`,
    },
  });
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "purchase-orders" || echo "routes typecheck clean"` → clean.
Run: `npm run lint 2>&1 | tail -3` → 0 errors (all routes carry tenantId via requireTenant + service queries).

- [ ] **Step 6: Commit**

```bash
git add app/api/purchase-orders
git commit -m "feat(po): generate/list/pdf/xlsx API routes (nodejs runtime)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Purchase Orders page + nav link

**Files:** `app/shop/[slug]/purchase-orders/page.tsx`, the shop nav header (find the existing nav in `app/shop/[slug]/dashboard/page.tsx` or a shared header and add a link).

- [ ] **Step 1: Implement `app/shop/[slug]/purchase-orders/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type PoRow = {
  id: string; poNumber: string; status: string; currency: string; subtotalKes: number;
  createdAt: string; sentAt: string | null;
  supplier: { name: string; country: string | null };
  _count: { lines: number };
};

const KES = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default function PurchaseOrdersPage() {
  const { slug } = useParams<{ slug: string }>();
  const [pos, setPos] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  function load() {
    apiFetch(slug, "/api/purchase-orders").then((r) => r.json()).then((d) => { setPos(d.purchaseOrders || []); setLoading(false); });
  }
  useEffect(() => { load(); }, []);

  async function generate() {
    setGenerating(true);
    try {
      const r = await apiFetch(slug, "/api/purchase-orders/generate", { method: "POST" });
      const d = await r.json();
      alert(d.created > 0 ? `Generated ${d.created} purchase order(s).` : "No approved orders to turn into POs.");
      load();
    } finally { setGenerating(false); }
  }

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link href={`/shop/${slug}/dashboard`} className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">← Dashboard</Link>
          <button onClick={generate} disabled={generating} className="text-2xs px-3 py-1.5 rounded border border-ink text-ink disabled:opacity-50">
            {generating ? "Generating…" : "Generate POs"}
          </button>
        </div>
      </header>
      <section className="max-w-7xl mx-auto px-5 sm:px-8 py-8">
        <h1 className="text-sm font-semibold text-ink mb-4">Purchase Orders</h1>
        {loading ? (
          <p className="text-sm text-mute">Loading…</p>
        ) : pos.length === 0 ? (
          <p className="text-sm text-mute">No purchase orders yet. Approve reorder suggestions on the dashboard, then click “Generate POs”.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-2xs">
              <thead className="text-mute">
                <tr className="border-b border-line">
                  <th className="text-left p-2">PO #</th><th className="text-left p-2">Supplier</th>
                  <th className="text-right p-2">Lines</th><th className="text-right p-2">Subtotal</th>
                  <th className="text-left p-2">Status</th><th className="text-right p-2">Files</th><th className="text-right p-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-b border-line/50">
                    <td className="p-2 text-ink">{p.poNumber}</td>
                    <td className="p-2">{p.supplier.name}</td>
                    <td className="p-2 text-right">{p._count.lines}</td>
                    <td className="p-2 text-right">{KES(p.subtotalKes)}</td>
                    <td className="p-2">{p.status}</td>
                    <td className="p-2 text-right">
                      <a className="text-ink underline mr-2" href={`/shop/${slug}/api-proxy?` } onClick={(e) => { e.preventDefault(); window.open(`/api/purchase-orders/${p.id}/pdf`, "_blank"); }}>PDF</a>
                      <a className="text-ink underline" href="#" onClick={(e) => { e.preventDefault(); window.open(`/api/purchase-orders/${p.id}/xlsx`, "_blank"); }}>XLSX</a>
                    </td>
                    <td className="p-2 text-right"><button disabled title="Resend key not configured yet" className="opacity-40 cursor-not-allowed">Email</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
```

> NOTE on download links: the download routes are `/api/purchase-orders/[id]/pdf|xlsx`. If this app routes API calls through a slug-aware proxy (check how `apiFetch` builds URLs and whether `/api/*` is reachable directly from the browser for this tenant), open the SAME URL `apiFetch` would hit. Inspect `lib/api-fetch.ts` and mirror its URL scheme for the `window.open` targets so the tenant context/cookies are honoured. Adjust the two `window.open` paths accordingly. Verify a download actually returns the file in Task 8.

- [ ] **Step 2: Add a nav link to Purchase Orders**

Find the nav header used by the dashboard/reports pages (search for `/reports` link in `app/shop/[slug]/**/page.tsx`). Add an equivalent `<Link href={\`/shop/${slug}/purchase-orders\`}>Purchase Orders</Link>` next to the existing nav items, matching their exact classes.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "purchase-orders/page" || echo "page typecheck clean"` → clean.
Run: `npm run lint 2>&1 | tail -3` → 0 errors. Use only existing tokens (`text-ink`, `text-mute`, `border-line`, `text-2xs`, `bg-canvas`) — do not invent.

- [ ] **Step 4: Commit**

```bash
git add app/shop/[slug]/purchase-orders "app/shop/[slug]" 
git commit -m "feat(po): Purchase Orders page (generate + PDF/XLSX download) + nav link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Live verification

**Files:** none.

- [ ] **Step 1: Ensure there are approved orders**

Run (read-only): `npx tsx -e "import 'dotenv/config';import{prisma}from'./lib/prisma';prisma.tenant.findFirst({select:{id:true}}).then(t=>prisma.order.count({where:{tenantId:t.id,status:'approved'}})).then(c=>{console.log('approved_orders='+c);process.exit(0)})"`
- If 0: approve a few via the dashboard UI (or, for the test, set a handful to approved: a one-off `prisma.order.updateMany({where:{tenantId, status:'pending'}, data:{status:'approved'}})` LIMITED — but prefer doing it through the UI to mirror real flow). Note the count.

- [ ] **Step 2: Generate POs (dev server up)**

`npm run dev`, open `/shop/beauty-square/purchase-orders`, click "Generate POs". Confirm POs appear grouped by supplier with sane subtotals.

- [ ] **Step 3: Download PDF + XLSX**

Click PDF and XLSX for a PO. Confirm both download and open (PDF shows the line table + subtotal; XLSX has the rows). Fix the `window.open` URL scheme if a download 404s or returns the app shell.

- [ ] **Step 4: Confirm idempotency of generation**

Click "Generate POs" again. Confirm it does NOT duplicate the already-PO'd orders (they were linked via `purchaseOrderId`; only un-linked approved orders should produce new POs). Stop the dev server when done.

- [ ] **Step 5: Commit any fixes from this task, then write a short SUMMARY** at `docs/superpowers/plans/2026-06-05-po-generation-SUMMARY.md` (counts, libs, deferred items) and update `.planning/STATE.md`.

---

## Self-Review (author checklist — completed)
- **Spec coverage:** models (T1), grouping+numbering tested (T2), persist/list/get (T3), PDF+XLSX (T4), deferred email (T5), routes (T6), page+nav (T7), live verify (T8). KES-only honoured (no FX fields used in math). QB push not built (deferred — out of scope this plan).
- **Type consistency:** `PurchaseOrderDetail` (T3) consumed by pdf/xlsx/email (T4/T5); `ApprovedOrderRow`/`PoDraft` (T2) consumed by service (T3); route handlers use `requireTenantOrResponse` + `await params` (Next 16) per repo convention.
- **Placeholder scan:** none — full code in every code step. The one judgement call (download URL scheme in T7) is bounded with an explicit instruction to mirror `lib/api-fetch.ts` and verify in T8.
- **Tenant safety:** every Prisma query in `service.ts` carries `tenantId`; routes resolve tenant via `requireTenantOrResponse`.

## Deferred (not in this plan)
- QuickBooks `PurchaseOrder` push (empty QB creds).
- Live Resend send (empty `RESEND_API_KEY`) — compose + guarded send built; UI button disabled.
- Per-supplier FX (KES-only for now).
- MOQ enforcement / partial-receipt tracking.
