import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return NextResponse.json({ predictions: [] });

  const predictions = await prisma.prediction.findMany({
    where: { tenantId: tenant.id },
    include: { product: true, orders: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { daysUntilStockout: "asc" },
  });

  return NextResponse.json({
    predictions: predictions.map(p => ({
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
      latestOrder: p.orders[0] ? { id: p.orders[0].id, status: p.orders[0].status } : null,
    })),
  });
}
