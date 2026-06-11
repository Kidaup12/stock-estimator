import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const product = await prisma.product.findFirst({
    where: { id, tenantId: tenant.id },
    include: { supplier: true },
  });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - 1);
  const history = await prisma.salesHistory.findMany({
    where: { productId: id, tenantId: tenant.id, date: { gte: since } },
    orderBy: { date: "asc" },
  });

  const prediction = await prisma.prediction.findFirst({
    where: { productId: id, tenantId: tenant.id },
    orderBy: { runDate: "desc" },
    include: { orders: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const byDay = history.map(h => ({
    date: h.date.toISOString().slice(0, 10),
    quantity: h.quantity,
    revenueKes: h.revenueKes,
  }));

  const byMonth = new Map<string, { quantity: number; revenueKes: number }>();
  for (const h of history) {
    const m = h.date.toISOString().slice(0, 7);
    const existing = byMonth.get(m) || { quantity: 0, revenueKes: 0 };
    existing.quantity += h.quantity;
    existing.revenueKes += h.revenueKes;
    byMonth.set(m, existing);
  }

  return NextResponse.json({
    product: {
      id: product.id,
      sku: product.sku,
      title: product.title,
      vendor: product.vendor,
      productType: product.productType,
      priceKes: product.priceKes,
      costKes: product.costKes,
      imageUrl: product.imageUrl,
      currentStock: product.currentStock,
      abcCategory: product.abcCategory,
      onOrder: product.onOrder,
      expectedArrivalAt: product.expectedArrivalAt,
      leadTimeDays: product.leadTimeDays,
      importCategory: product.importCategory,
      supplier: product.supplier
        ? {
            id: product.supplier.id,
            name: product.supplier.name,
            leadTimeAvgDays: product.supplier.leadTimeAvgDays,
            leadTimeStdDays: product.supplier.leadTimeStdDays,
          }
        : null,
    },
    history: {
      byDay,
      byMonth: Array.from(byMonth.entries()).map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
    },
    prediction: prediction
      ? {
          id: prediction.id,
          runDate: prediction.runDate,
          layer1Forecast30d: prediction.layer1Forecast30d,
          layer1Confidence: prediction.layer1Confidence,
          layer2Adjustment: prediction.layer2Adjustment,
          finalForecast30d: prediction.finalForecast30d,
          daysUntilStockout: prediction.daysUntilStockout,
          recommendedQty: prediction.recommendedQty,
          safetyStock: prediction.safetyStock,
          reorderPoint: prediction.reorderPoint,
          confidence: prediction.confidence,
          reasoning: prediction.reasoning,
          urgency: prediction.urgency,
          signals: JSON.parse(prediction.signals || "[]"),
          latestOrder: prediction.orders[0] ? { id: prediction.orders[0].id, status: prediction.orders[0].status } : null,
        }
      : null,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const body = await req.json().catch(() => ({}));
  const data: { supplierId?: string | null; leadTimeDays?: number | null; importCategory?: string | null } = {};
  if ("supplierId" in body) data.supplierId = typeof body.supplierId === "string" ? body.supplierId : null;
  if ("leadTimeDays" in body) {
    const n = Number.parseInt(body.leadTimeDays, 10);
    data.leadTimeDays = Number.isFinite(n) && n > 0 ? n : null; // blank/invalid → clear override
  }
  if ("importCategory" in body) {
    const v = typeof body.importCategory === "string" ? body.importCategory.toUpperCase() : null;
    data.importCategory = v === "LOCAL" || v === "KOREAN" || v === "WESTERN" ? v : null; // anything else clears
  }

  // Tenant-scoped write (updateMany so the where carries tenantId).
  await prisma.product.updateMany({ where: { id, tenantId: tenant.id }, data });
  return NextResponse.json({ ok: true });
}
