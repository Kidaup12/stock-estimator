import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { aggregatePosSales, type PosSaleIn } from "@/lib/pos/aggregate";
import { tenantDayKey } from "@/lib/time/tenant-date";

export const maxDuration = 300;

/**
 * POST /api/pos/sales — system endpoint for the n8n "Dellwest → Wezesha POS sales feed".
 * Auth: `Authorization: Bearer <QB_FEED_SECRET>` (shared system-feed secret). The feed
 * sends PHYSICAL sales only (created_by != SHOPIFY, Completed). We store the raw
 * PosSale/PosSaleLine (for the later audit) and derive SalesHistory channel="pos" by
 * SKU, so run rates include the shop floor. Idempotent: re-posting a window overwrites,
 * never doubles.
 */
const Body = z.object({
  slug: z.string().min(1),
  sales: z
    .array(
      z.object({
        externalId: z.union([z.string(), z.number()]).transform((v) => String(v)),
        reference: z.string().optional().nullable(),
        date: z.string().min(1), // Dellwest local time, e.g. "2026-06-12 19:00:29"
        createdBy: z.string().default(""),
        salesAgent: z.string().optional().nullable(),
        warehouse: z.string().optional().nullable(),
        customer: z.string().optional().nullable(),
        saleStatus: z.string().optional().nullable(),
        paymentStatus: z.string().optional().nullable(),
        grandTotal: z.number().optional().nullable(),
        lines: z.array(
          z.object({
            sku: z.union([z.string(), z.number()]).transform((v) => String(v)),
            name: z.string().optional().nullable(),
            qty: z.number(),
            price: z.number().optional().nullable(),
            subtotal: z.number().optional().nullable(),
          })
        ),
      })
    )
    .max(10000),
});

/** Dellwest timestamps are Nairobi-local with no offset; parse as +03:00 (Kenya, no DST). */
function parseDellwestDate(s: string): Date {
  const d = new Date(s.trim().replace(" ", "T") + "+03:00");
  return Number.isNaN(d.getTime()) ? new Date(s) : d;
}

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
  const { slug, sales } = parsed.data;
  if (sales.length === 0) return NextResponse.json({ ok: true, salesIngested: 0, linesMatched: 0, linesUnmatched: 0 });

  // eslint-disable-next-line tenant-safety/require-tenant-scope -- system feed resolves the tenant by slug + bearer secret
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, timezone: true } });
  if (!tenant) return NextResponse.json({ error: "unknown shop" }, { status: 404 });
  const tenantId = tenant.id;

  // SKU → productId (normalised the same way the aggregator matches).
  const products = await prisma.product.findMany({ where: { tenantId }, select: { id: true, sku: true } });
  const skuMap = new Map<string, string>();
  for (const p of products) {
    const k = (p.sku ?? "").trim().toLowerCase();
    if (k) skuMap.set(k, p.id);
  }

  // ── Raw store: replace these sales + their lines (set-semantics by externalId) ──
  const saleRows = sales.map((s) => ({
    id: crypto.randomUUID(),
    tenantId,
    externalId: s.externalId,
    reference: s.reference ?? null,
    date: parseDellwestDate(s.date),
    createdBy: s.createdBy ?? "",
    salesAgent: s.salesAgent ?? null,
    warehouse: s.warehouse ?? null,
    customer: s.customer ?? null,
    saleStatus: s.saleStatus ?? null,
    paymentStatus: s.paymentStatus ?? null,
    grandTotal: s.grandTotal ?? 0,
    channel: "physical",
    _src: s,
  }));
  const lineRows = saleRows.flatMap((sr) =>
    sr._src.lines.map((l) => ({
      id: crypto.randomUUID(),
      posSaleId: sr.id,
      tenantId,
      sku: l.sku,
      productName: l.name ?? "",
      qty: l.qty,
      price: l.price ?? 0,
      subtotal: l.subtotal ?? 0,
      productId: skuMap.get(l.sku.trim().toLowerCase()) ?? null,
    }))
  );

  const externalIds = saleRows.map((s) => s.externalId);
  await prisma.posSale.deleteMany({ where: { tenantId, externalId: { in: externalIds } } }); // cascades lines
  await prisma.posSale.createMany({ data: saleRows.map(({ _src, ...row }) => { void _src; return row; }) });
  for (let i = 0; i < lineRows.length; i += 1000) {
    await prisma.posSaleLine.createMany({ data: lineRows.slice(i, i + 1000) });
  }

  // ── Derive SalesHistory channel="pos" — per (product, tenant-local day), set-semantics ──
  const aggInput: PosSaleIn[] = saleRows.map((sr) => ({
    date: sr.date,
    lines: sr._src.lines.map((l) => ({ sku: l.sku, qty: l.qty, subtotal: l.subtotal ?? 0 })),
  }));
  const agg = aggregatePosSales(aggInput, skuMap, (d) => tenantDayKey(tenant.timezone, d));

  if (agg.rows.length > 0) {
    const productIds = [...new Set(agg.rows.map((r) => r.productId))];
    const days = [...new Set(agg.rows.map((r) => r.dayKey))].map((k) => new Date(`${k}T00:00:00.000Z`));
    await prisma.salesHistory.deleteMany({
      where: { tenantId, channel: "pos", productId: { in: productIds }, date: { in: days } },
    });
    for (let i = 0; i < agg.rows.length; i += 1000) {
      await prisma.salesHistory.createMany({
        data: agg.rows.slice(i, i + 1000).map((r) => ({
          tenantId,
          productId: r.productId,
          date: new Date(`${r.dayKey}T00:00:00.000Z`),
          quantity: r.qty,
          revenueKes: r.revenue,
          channel: "pos",
        })),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    salesIngested: saleRows.length,
    linesMatched: agg.matchedLines,
    linesUnmatched: agg.unmatchedLines,
    salesHistoryRows: agg.rows.length,
    sampleUnmatchedSkus: agg.sampleUnmatchedSkus,
  });
}
