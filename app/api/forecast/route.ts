import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return NextResponse.json({ predictions: [], monthlyRevenue: [], summary: null });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const last30Start = new Date(today);
  last30Start.setUTCDate(last30Start.getUTCDate() - 30);
  const last90Start = new Date(today);
  last90Start.setUTCDate(last90Start.getUTCDate() - 90);
  const last365Start = new Date(today);
  last365Start.setUTCFullYear(today.getUTCFullYear() - 1);

  const [predictions, sales30, sales90, sales365] = await Promise.all([
    prisma.prediction.findMany({
      where: { tenantId: tenant.id },
      include: { product: true },
      orderBy: { daysUntilStockout: "asc" },
    }),
    prisma.salesHistory.groupBy({
      by: ["productId"],
      where: { tenantId: tenant.id, date: { gte: last30Start } },
      _sum: { quantity: true, revenueKes: true },
    }),
    prisma.salesHistory.groupBy({
      by: ["productId"],
      where: { tenantId: tenant.id, date: { gte: last90Start } },
      _sum: { quantity: true, revenueKes: true },
    }),
    prisma.salesHistory.findMany({
      where: { tenantId: tenant.id, date: { gte: last365Start } },
      select: { date: true, revenueKes: true, quantity: true },
    }),
  ]);

  const sales30Map = new Map(sales30.map(s => [s.productId, { qty: s._sum.quantity ?? 0, rev: s._sum.revenueKes ?? 0 }]));
  const sales90Map = new Map(sales90.map(s => [s.productId, { qty: s._sum.quantity ?? 0, rev: s._sum.revenueKes ?? 0 }]));

  const monthlyMap = new Map<string, { quantity: number; revenueKes: number }>();
  for (const s of sales365) {
    const m = s.date.toISOString().slice(0, 7);
    const existing = monthlyMap.get(m) || { quantity: 0, revenueKes: 0 };
    existing.quantity += s.quantity;
    existing.revenueKes += s.revenueKes;
    monthlyMap.set(m, existing);
  }
  const monthlyRevenue = Array.from(monthlyMap.entries())
    .map(([month, v]) => ({ month, quantity: v.quantity, revenueKes: v.revenueKes }))
    .sort((a, b) => a.month.localeCompare(b.month));

  let deadStockKes = 0;
  let activeStockKes = 0;
  let revenue30 = 0;
  for (const p of predictions) {
    const s90 = sales90Map.get(p.productId)?.qty ?? 0;
    const s30 = sales30Map.get(p.productId);
    revenue30 += s30?.rev ?? 0;
    const stockValue = p.product.currentStock * p.product.priceKes;
    if (s90 === 0 && p.product.currentStock > 0) deadStockKes += stockValue;
    else activeStockKes += stockValue;
  }

  return NextResponse.json({
    summary: {
      productCount: predictions.length,
      revenue30,
      revenue90: sales90.reduce((s, x) => s + (x._sum.revenueKes ?? 0), 0),
      deadStockKes,
      activeStockKes,
    },
    monthlyRevenue,
    predictions: predictions.map(p => {
      const s30 = sales30Map.get(p.productId);
      const s90 = sales90Map.get(p.productId);
      return {
        id: p.id,
        productId: p.productId,
        product: {
          id: p.product.id,
          sku: p.product.sku,
          title: p.product.title,
          vendor: p.product.vendor,
          productType: p.product.productType,
          priceKes: p.product.priceKes,
          imageUrl: p.product.imageUrl,
          currentStock: p.product.currentStock,
          abcCategory: p.product.abcCategory,
        },
        runDate: p.runDate,
        layer1Forecast30d: p.layer1Forecast30d,
        layer1Confidence: p.layer1Confidence,
        layer2Adjustment: p.layer2Adjustment,
        finalForecast30d: p.finalForecast30d,
        daysUntilStockout: p.daysUntilStockout,
        recommendedQty: p.recommendedQty,
        safetyStock: p.safetyStock,
        reorderPoint: p.reorderPoint,
        confidence: p.confidence,
        reasoning: p.reasoning,
        urgency: p.urgency,
        signals: JSON.parse(p.signals || "[]"),
        sales30Qty: s30?.qty ?? 0,
        sales30Revenue: s30?.rev ?? 0,
        sales90Qty: s90?.qty ?? 0,
        sales90Revenue: s90?.rev ?? 0,
        stockValueKes: p.product.currentStock * p.product.priceKes,
      };
    }),
  });
}
