import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  budgetKes: z.number().positive(),
});

const URGENCY_WEIGHT: Record<string, number> = {
  critical: 2.5,
  high: 1.8,
  medium: 1.2,
  low: 0.6,
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { budgetKes } = parsed.data;

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const predictions = await prisma.prediction.findMany({
    where: { tenantId: tenant.id, recommendedQty: { gt: 0 } },
    include: { product: { include: { supplier: true } } },
  });

  // Score each pending reorder.
  const scored = predictions.map(p => {
    const cost = p.recommendedQty * p.product.costKes;
    const revenue = p.recommendedQty * p.product.priceKes;
    const margin = revenue - cost;
    const roi = cost > 0 ? margin / cost : 0;
    const urgencyWeight = URGENCY_WEIGHT[p.urgency] ?? 0.6;
    // Composite: urgency dominates, ROI breaks ties.
    const score = urgencyWeight * (1 + Math.min(roi, 2));

    return {
      predictionId: p.id,
      productId: p.product.id,
      title: p.product.title,
      vendor: p.product.vendor,
      productType: p.product.productType,
      sku: p.product.sku,
      imageUrl: p.product.imageUrl,
      recommendedQty: p.recommendedQty,
      daysUntilStockout: p.daysUntilStockout,
      urgency: p.urgency,
      supplierName: p.product.supplier?.name ?? null,
      cost,
      revenue,
      margin,
      roi,
      score,
    };
  }).sort((a, b) => b.score - a.score);

  // Greedy fill with constraint that we always include critical (even if it blows budget — flag overflow)
  const selected: typeof scored = [];
  const deferred: typeof scored = [];
  let usedKes = 0;

  // Pass 1: always include critical
  for (const s of scored) {
    if (s.urgency === "critical") {
      selected.push(s);
      usedKes += s.cost;
    }
  }

  // Pass 2: fill remaining budget greedily by score
  for (const s of scored) {
    if (s.urgency === "critical") continue;
    if (usedKes + s.cost <= budgetKes) {
      selected.push(s);
      usedKes += s.cost;
    } else {
      deferred.push(s);
    }
  }

  // Recompute selectedKes/revenueKes from final lists
  const selectedCostKes = selected.reduce((s, x) => s + x.cost, 0);
  const selectedRevenueKes = selected.reduce((s, x) => s + x.revenue, 0);
  const selectedMarginKes = selected.reduce((s, x) => s + x.margin, 0);
  const deferredCostKes = deferred.reduce((s, x) => s + x.cost, 0);
  const deferredRevenueKes = deferred.reduce((s, x) => s + x.revenue, 0);
  const deferredMarginKes = deferred.reduce((s, x) => s + x.margin, 0);

  const criticalOverflowKes = Math.max(0, selectedCostKes - budgetKes);
  const deferredAtRisk = deferred.filter(d => d.urgency === "high" || d.daysUntilStockout < 14).length;
  const deferredAtRiskRevenueKes = deferred
    .filter(d => d.urgency === "high" || d.daysUntilStockout < 14)
    .reduce((s, x) => s + x.revenue, 0);

  return NextResponse.json({
    budgetKes,
    selectedCostKes,
    selectedRevenueKes,
    selectedMarginKes,
    deferredCostKes,
    deferredRevenueKes,
    deferredMarginKes,
    criticalOverflowKes,
    deferredAtRisk,
    deferredAtRiskRevenueKes,
    selectedCount: selected.length,
    deferredCount: deferred.length,
    selected,
    deferred,
  });
}
