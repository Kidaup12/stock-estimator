import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

const Body = z.object({ qty: z.number().int().positive().optional() });

/**
 * "Mark as ordered" — records the intent to reorder a product so the dashboard stops
 * recommending it while it's on the way. Suppression rides on this Order record, NOT on
 * Product.onOrder (the nightly Shopify reconcile authoritatively resets onOrder).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;

  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let raw: unknown = {};
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: tenant.id },
    select: { id: true, currentStock: true, leadTimeDays: true, supplier: { select: { leadTimeAvgDays: true } } },
  });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const prediction = await prisma.prediction.findFirst({
    where: { tenantId: tenant.id, productId },
    orderBy: { runDate: "desc" },
    select: { id: true, recommendedQty: true },
  });
  if (!prediction) return NextResponse.json({ error: "No forecast for this product yet" }, { status: 400 });

  const qty = parsed.data.qty ?? Math.max(1, Math.ceil(prediction.recommendedQty));
  const leadDays = product.leadTimeDays ?? product.supplier?.leadTimeAvgDays ?? 30;
  const now = new Date();
  const eta = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1000);

  const data = {
    status: "ordered",
    orderedQty: qty,
    orderedAt: now,
    expectedArrivalAt: eta,
    stockAtOrder: product.currentStock,
    sawEnroute: false,
    predictionId: prediction.id,
  };

  // Idempotent: one active marker per product. Re-ordering refreshes qty + ETA.
  const existing = await prisma.order.findFirst({
    where: { tenantId: tenant.id, productId, status: "ordered", receivedAt: null },
    select: { id: true },
  });

  const order = existing
    ? await prisma.order.update({ where: { id: existing.id }, data })
    : await prisma.order.create({ data: { ...data, tenantId: tenant.id, productId } });

  return NextResponse.json({ ok: true, order });
}
