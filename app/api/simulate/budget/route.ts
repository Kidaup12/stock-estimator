import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { leadDaysFor } from "@/lib/forecast/category";
import { latestForecastRunId } from "@/lib/forecast/latest-run";
import { z } from "zod";

const schema = z.object({
  // Either or both: budget caps spend, coverDays sizes the need.
  budgetKes: z.number().positive().optional(),
  coverDays: z.number().int().min(1).max(120).optional(),
  // Optional focus: narrow the buy list to one category or brand.
  scope: z.enum(["all", "category", "brand"]).optional(),
  scopeValue: z.string().optional(),
}).refine((v) => v.budgetKes != null || v.coverDays != null, {
  message: "Provide budgetKes, coverDays, or both",
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
  const { budgetKes, coverDays, scope, scopeValue } = parsed.data;

  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  // ONE deterministic run only — pulling every run ever produced massive
  // duplicate counts (the "800 selected 1,732 items" bug).
  const runId = await latestForecastRunId(tenant.id);
  if (!runId) return NextResponse.json({ error: "No forecast yet — run forecasts first" }, { status: 400 });

  // Items already marked as ordered are on the way — never re-recommend them.
  const activeOrdered = await prisma.order.findMany({
    where: { tenantId: tenant.id, status: "ordered", receivedAt: null, productId: { not: null } },
    select: { productId: true },
  });
  const orderedSet = new Set(activeOrdered.map(o => o.productId));

  const predictions = await prisma.prediction.findMany({
    where: { tenantId: tenant.id, forecastRunId: runId, recommendedQty: { gt: 0 } },
    include: { product: { include: { supplier: true } } },
  });

  // 30d sales for the run rate (drives the coverDays sizing; rate 0 = excluded).
  const since30 = new Date();
  since30.setUTCDate(since30.getUTCDate() - 30);
  const sales30 = await prisma.salesHistory.groupBy({
    by: ["productId"],
    where: { tenantId: tenant.id, date: { gte: since30 } },
    _sum: { quantity: true },
  });
  const rateByProduct = new Map(sales30.map(s => [s.productId, (s._sum.quantity ?? 0) / 30]));

  // Score each pending reorder.
  const scopeV = scope && scope !== "all" && scopeValue ? scopeValue.toUpperCase() : null;
  const scored = predictions
    .filter(p => !orderedSet.has(p.productId))
    .filter(p => {
      if (!scopeV) return true; // "all" or no focus → no narrowing
      if (scope === "category") return (p.product.productType ?? "").toUpperCase() === scopeV;
      if (scope === "brand") return (p.product.vendor ?? "").toUpperCase() === scopeV;
      return true;
    })
    .filter(p => (rateByProduct.get(p.productId) ?? 0) > 0) // no run rate -> nothing to restock
    .map(p => {
      const rate = rateByProduct.get(p.productId) ?? 0;
      // coverDays sizes the need: enough for N days minus what's here/coming.
      // Without coverDays, use the forecast engine's recommendedQty as-is.
      const qty = coverDays != null
        ? Math.max(0, Math.ceil(rate * coverDays - p.product.currentStock - p.product.onOrder))
        : p.recommendedQty;
      if (qty <= 0) return null;

      const cost = qty * p.product.costKes;
      const revenue = qty * p.product.priceKes;
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
        recommendedQty: qty,
        daysUntilStockout: p.daysUntilStockout,
        urgency: p.urgency,
        supplierName: p.product.supplier?.name ?? null,
        importCategory: p.product.importCategory,
        // For the order-sheet CSV: when stock would land if ordered today.
        leadDays: leadDaysFor(p.product, p.product.supplier),
        cost,
        revenue,
        margin,
        roi,
        score,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score);

  // Greedy fill. Criticals are always included when a budget is set (overflow is
  // flagged); with no budget (days-only mode) everything needed is selected.
  const selected: typeof scored = [];
  const deferred: typeof scored = [];
  let usedKes = 0;

  if (budgetKes == null) {
    selected.push(...scored);
    usedKes = scored.reduce((s, x) => s + x.cost, 0);
  } else {
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
  }

  // Recompute selectedKes/revenueKes from final lists
  const selectedCostKes = selected.reduce((s, x) => s + x.cost, 0);
  const selectedRevenueKes = selected.reduce((s, x) => s + x.revenue, 0);
  const selectedMarginKes = selected.reduce((s, x) => s + x.margin, 0);
  const deferredCostKes = deferred.reduce((s, x) => s + x.cost, 0);
  const deferredRevenueKes = deferred.reduce((s, x) => s + x.revenue, 0);
  const deferredMarginKes = deferred.reduce((s, x) => s + x.margin, 0);

  const criticalOverflowKes = budgetKes != null ? Math.max(0, selectedCostKes - budgetKes) : 0;
  const deferredAtRisk = deferred.filter(d => d.urgency === "high" || d.daysUntilStockout < 14).length;
  const deferredAtRiskRevenueKes = deferred
    .filter(d => d.urgency === "high" || d.daysUntilStockout < 14)
    .reduce((s, x) => s + x.revenue, 0);

  return NextResponse.json({
    budgetKes: budgetKes ?? null,
    coverDays: coverDays ?? null,
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
