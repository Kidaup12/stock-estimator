import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { simulateLayeredForecast, type ActivePromo } from "@/lib/forecast/simulate-layers";
import { assignAbc } from "@/lib/forecast/abc";
import { recommendedQty as computeRecommendedQty } from "@/lib/forecast/reorder";
import { leadDaysFor, leadStdFor } from "@/lib/forecast/category";
import { tenantDayKey, tenantTodayUtc } from "@/lib/time/tenant-date";

export const maxDuration = 120;

export async function POST() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    include: { supplier: true },
  });
  if (products.length === 0) return NextResponse.json({ error: "No products. Seed first." }, { status: 400 });

  // One batch id per run — every Prediction row in this run shares it.
  // Dashboard pins to the latest forecastRunId per tenant (codex REVIEWS #3).
  const forecastRunId = crypto.randomUUID();

  // TNT-08: compute the tenant-local day ONCE. runDateKey seeds the simulator
  // and tags the prediction bucket; todayUtc (tenant-local midnight) anchors all
  // history/promo windows so two runs in one Nairobi day are identical.
  const runDateKey = tenantDayKey(tenant.timezone);
  const todayUtc = tenantTodayUtc(tenant.timezone);

  const today = todayUtc;
  const since = new Date(today);
  since.setUTCFullYear(today.getUTCFullYear() - 1);

  const allHistory = await prisma.salesHistory.findMany({
    where: { tenantId: tenant.id, date: { gte: since } },
  });
  const historyByProduct = new Map<string, { date: Date; quantity: number }[]>();
  for (const h of allHistory) {
    if (!historyByProduct.has(h.productId)) historyByProduct.set(h.productId, []);
    historyByProduct.get(h.productId)!.push({ date: h.date, quantity: h.quantity });
  }

  const revenueByProduct = products.map(p => {
    const hist = historyByProduct.get(p.id) ?? [];
    const last90 = new Date(today);
    last90.setUTCDate(last90.getUTCDate() - 90);
    const recent = hist.filter(h => h.date >= last90);
    const revenue = recent.reduce((s, h) => s + h.quantity * p.priceKes, 0);
    return { id: p.id, revenue };
  });
  const abcMap = assignAbc(revenueByProduct);

  const activePromos = await prisma.promo.findMany({
    where: {
      tenantId: tenant.id,
      startDate: { lte: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) },
      endDate: { gte: today },
    },
  });
  const promosShaped: ActivePromo[] = activePromos.map(p => ({
    discountPct: p.discountPct,
    promoType: p.promoType,
    channel: p.channel,
    scope: p.scope,
    scopeValue: p.scopeValue,
  }));

  // FND-06: predictions accumulate. No deleteMany — every run is a new batch.

  let created = 0;
  for (const p of products) {
    const history = historyByProduct.get(p.id) ?? [];
    const supplier = p.supplier;
    // Per-product override → supplier → import-category default. (Matches run-batch.)
    const leadAvg = leadDaysFor(p, supplier);
    const leadStd = leadStdFor(p, supplier);
    const abc = abcMap[p.id] ?? "C";

    const result = simulateLayeredForecast({
      productId: p.id,
      productType: p.productType,
      vendor: p.vendor,
      sku: p.sku,
      currentStock: p.currentStock,
      abcCategory: abc,
      history,
      leadTimeAvg: leadAvg,
      leadTimeStd: leadStd,
      activePromos: promosShaped,
      runDateKey,
    });

    // FND-04: subtract Product.onOrder so approved-but-not-received POs do
    // not trigger duplicate restock recommendations. Simulator does not know
    // about onOrder, so we recompute here with the helper.
    const adjustedRecommendedQty = computeRecommendedQty({
      finalForecast30d: result.finalForecast30d,
      safetyStock: result.safetyStock,
      currentStock: p.currentStock,
      onOrder: p.onOrder,
    });

    await prisma.product.update({
      where: { id: p.id },
      data: { abcCategory: abc },
    });

    const prediction = await prisma.prediction.create({
      data: {
        tenantId: tenant.id,
        productId: p.id,
        runDate: todayUtc,
        layer1Forecast30d: result.layer1Forecast30d,
        layer1Confidence: result.layer1Confidence,
        layer2Adjustment: result.layer2Adjustment,
        finalForecast30d: result.finalForecast30d,
        daysUntilStockout: result.daysUntilStockout,
        recommendedQty: adjustedRecommendedQty,
        safetyStock: result.safetyStock,
        reorderPoint: result.reorderPoint,
        confidence: result.confidence,
        reasoning: result.reasoning,
        urgency: result.urgency,
        signals: JSON.stringify(result.signals),
        forecastRunId,
        regime: null,
      },
    });

    if (adjustedRecommendedQty > 0 && (result.urgency === "critical" || result.urgency === "high")) {
      await prisma.order.create({
        data: {
          tenantId: tenant.id,
          predictionId: prediction.id,
          status: "pending",
        },
      });
    }

    created++;
  }

  return NextResponse.json({ ok: true, forecastsCreated: created, forecastRunId });
}
