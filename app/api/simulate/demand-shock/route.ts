import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { z } from "zod";

const schema = z.object({
  upliftMultiplier: z.number().min(0.1).max(10),
  scope: z.enum(["all", "category", "brand"]),
  scopeValue: z.string().optional().nullable(),
  daysAhead: z.number().int().positive().default(30),
  eventName: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  const { upliftMultiplier, scope, scopeValue, daysAhead, eventName } = parsed.data;

  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  // Pull all predictions + products in scope
  const predictions = await prisma.prediction.findMany({
    where: { tenantId: tenant.id },
    include: { product: { include: { supplier: true } } },
  });

  const affected = predictions.filter(p => {
    if (scope === "all") return true;
    const cmp = (s: string | null | undefined) => (s ?? "").toUpperCase().trim();
    if (scope === "category") return cmp(p.product.productType) === cmp(scopeValue);
    if (scope === "brand") return cmp(p.product.vendor) === cmp(scopeValue);
    return false;
  });

  // Baseline totals
  let baselineReorderCost = 0;
  let baselineReorderRevenue = 0;
  let baselineReorderCount = 0;

  // Shocked totals
  let shockedReorderCost = 0;
  let shockedReorderRevenue = 0;
  let shockedReorderCount = 0;
  let leadTimeInfeasibleCount = 0;
  let leadTimeInfeasibleKes = 0;

  const items = affected.map(p => {
    const baselineRecommend = p.recommendedQty;
    baselineReorderCost += baselineRecommend * p.product.costKes;
    baselineReorderRevenue += baselineRecommend * p.product.priceKes;
    if (baselineRecommend > 0) baselineReorderCount++;

    // Shock: bump the forecast, recompute recommended qty = max(0, newForecast + safetyStock - currentStock)
    const newForecast = p.finalForecast30d * upliftMultiplier;
    const newRecommend = Math.max(0, Math.ceil(newForecast + p.safetyStock - p.product.currentStock));

    shockedReorderCost += newRecommend * p.product.costKes;
    shockedReorderRevenue += newRecommend * p.product.priceKes;
    if (newRecommend > 0) shockedReorderCount++;

    // Lead time feasibility
    const leadAvg = p.product.supplier?.leadTimeAvgDays ?? 30;
    const leadStd = p.product.supplier?.leadTimeStdDays ?? 7;
    const leadP90 = leadAvg + 1.28 * leadStd; // 90th percentile lead
    const leadFeasible = leadP90 <= daysAhead;
    if (!leadFeasible && newRecommend > baselineRecommend) {
      leadTimeInfeasibleCount++;
      leadTimeInfeasibleKes += (newRecommend - baselineRecommend) * p.product.costKes;
    }

    return {
      productId: p.product.id,
      title: p.product.title,
      vendor: p.product.vendor,
      productType: p.product.productType,
      sku: p.product.sku,
      currentStock: p.product.currentStock,
      baselineForecast: p.finalForecast30d,
      shockedForecast: newForecast,
      baselineRecommend,
      shockedRecommend: newRecommend,
      extraCost: (newRecommend - baselineRecommend) * p.product.costKes,
      extraRevenue: (newRecommend - baselineRecommend) * p.product.priceKes,
      supplierName: p.product.supplier?.name ?? null,
      leadTimeP90: leadP90,
      leadFeasible,
    };
  })
  .filter(x => x.shockedRecommend > 0 || x.baselineRecommend > 0)
  .sort((a, b) => b.extraRevenue - a.extraRevenue);

  const deltaCost = shockedReorderCost - baselineReorderCost;
  const deltaRevenue = shockedReorderRevenue - baselineReorderRevenue;
  const deltaMargin = deltaRevenue - deltaCost;

  return NextResponse.json({
    eventName: eventName ?? null,
    upliftMultiplier,
    scope,
    scopeValue: scopeValue ?? null,
    daysAhead,
    affectedCount: affected.length,
    baseline: {
      reorderCount: baselineReorderCount,
      reorderCost: baselineReorderCost,
      reorderRevenue: baselineReorderRevenue,
      reorderMargin: baselineReorderRevenue - baselineReorderCost,
    },
    shocked: {
      reorderCount: shockedReorderCount,
      reorderCost: shockedReorderCost,
      reorderRevenue: shockedReorderRevenue,
      reorderMargin: shockedReorderRevenue - shockedReorderCost,
    },
    delta: {
      cost: deltaCost,
      revenue: deltaRevenue,
      margin: deltaMargin,
      reorderCount: shockedReorderCount - baselineReorderCount,
    },
    leadTime: {
      infeasibleCount: leadTimeInfeasibleCount,
      infeasibleExtraCostKes: leadTimeInfeasibleKes,
    },
    items: items.slice(0, 200),
  });
}
