import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const product = await prisma.product.findFirst({
    where: { id, tenantId: tenant.id },
    include: { supplier: true },
  });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - 1);
  const history = await prisma.salesHistory.findMany({
    where: { productId: id, date: { gte: since } },
    orderBy: { date: "asc" },
  });

  const prediction = await prisma.prediction.findFirst({
    where: { productId: id },
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
  const body = await req.json().catch(() => ({}));
  const supplierId = typeof body.supplierId === "string" ? body.supplierId : null;
  const product = await prisma.product.update({ where: { id }, data: { supplierId } });
  return NextResponse.json({ product });
}
