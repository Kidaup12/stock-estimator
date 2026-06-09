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
        onOrder: true, expectedArrivalAt: true, leadTimeDays: true,
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
    // Lead time precedence mirrors the forecast: per-product override → supplier avg → 30d default.
    // Per-product lead has no std, so show a bare number (std null) instead of the supplier's "30±7".
    leadTimeAvgDays: p.leadTimeDays ?? p.supplier?.leadTimeAvgDays ?? 30,
    leadTimeStdDays: p.leadTimeDays != null ? null : (p.supplier?.leadTimeStdDays ?? null),
    soldInWindow: soldByProduct.get(p.id) ?? 0,
    snapshotOnHand: openingByProduct.get(p.id) ?? null,
  }));

  const view = buildPositionView({ windowDays, rows });
  return NextResponse.json({ ...view, trackingSince: trackingSince?.date ?? null });
}
