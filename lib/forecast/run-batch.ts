/**
 * Forecast batch for one tenant — extracted from scripts/run-forecasts.ts so the
 * nightly reconcile can re-forecast without duplicating the pipeline. Logic is
 * identical to the original script body (ABC assign -> layered forecast -> upsert
 * Prediction -> create pending Order for critical/high). Also snapshots inventory.
 */
import { prisma } from "@/lib/prisma";
import {
  simulateLayeredForecast,
  type ActivePromo,
  type ForecastInput,
  type ForecastResult,
} from "@/lib/forecast/simulate-layers";
import { assignAbc } from "@/lib/forecast/abc";
import { recommendedQty as computeRecommendedQty } from "@/lib/forecast/reorder";
import { leadDaysFor, coverDaysFor } from "@/lib/forecast/category";
import { tenantDayKey, tenantTodayUtc } from "@/lib/time/tenant-date";
import { snapshotInventory } from "@/lib/inventory/snapshot";
import { forecastDemandViaSidecar } from "@/lib/forecast/sidecar-client";
import { assembleForecastResult, type DemandForecast } from "@/lib/forecast/assemble";

export async function runForecastsForTenant(
  tenantId: string,
  /** Tenant IANA timezone — pass from the caller that already has the Tenant row
   *  (scripts/run-forecasts.ts, reconcile.ts). Defaults to the schema default. */
  timezone = "Africa/Nairobi"
): Promise<{ created: number; forecastRunId: string }> {
  const products = await prisma.product.findMany({
    where: { tenantId },
    include: { supplier: true },
  });

  const forecastRunId = crypto.randomUUID();
  const runDateKey = tenantDayKey(timezone);
  const todayUtc = tenantTodayUtc(timezone);

  const today = todayUtc;
  const since = new Date(today);
  since.setUTCFullYear(today.getUTCFullYear() - 1);

  const allHistory = await prisma.salesHistory.findMany({
    where: { tenantId, date: { gte: since } },
  });
  const historyByProduct = new Map<string, { date: Date; quantity: number }[]>();
  for (const h of allHistory) {
    if (!historyByProduct.has(h.productId)) historyByProduct.set(h.productId, []);
    historyByProduct.get(h.productId)!.push({ date: h.date, quantity: h.quantity });
  }

  const revenueByProduct = products.map((p) => {
    const hist = historyByProduct.get(p.id) ?? [];
    const last90 = new Date(today);
    last90.setUTCDate(last90.getUTCDate() - 90);
    const recent = hist.filter((h) => h.date >= last90);
    const revenue = recent.reduce((s, h) => s + h.quantity * p.priceKes, 0);
    return { id: p.id, revenue };
  });
  const abcMap = assignAbc(revenueByProduct);

  const activePromos = await prisma.promo.findMany({
    where: {
      tenantId,
      startDate: { lte: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) },
      endDate: { gte: today },
    },
  });
  const promosShaped: ActivePromo[] = activePromos.map((p) => ({
    discountPct: p.discountPct,
    promoType: p.promoType,
    channel: p.channel,
    scope: p.scope,
    scopeValue: p.scopeValue,
  }));

  // Build the forecast input for every product (same order as `products`).
  const inputs: ForecastInput[] = products.map((p) => ({
    productId: p.id,
    productType: p.productType,
    vendor: p.vendor,
    sku: p.sku,
    currentStock: p.currentStock,
    abcCategory: abcMap[p.id] ?? "C",
    history: historyByProduct.get(p.id) ?? [],
    // Precedence: per-product override → supplier → import-category default → 30.
    leadTimeAvg: leadDaysFor(p, p.supplier),
    leadTimeStd: p.supplier?.leadTimeStdDays ?? 7,
    activePromos: promosShaped,
    runDateKey,
  }));

  // Demand source: the Python sidecar when enabled, else the TS forecast. On ANY
  // sidecar failure, fall back to TS for the whole run — never break the batch.
  let demands: DemandForecast[] | null = null;
  if (process.env.USE_SIDECAR === "1" && process.env.FORECAST_SIDECAR_URL) {
    try {
      demands = await forecastDemandViaSidecar(inputs);
    } catch (e) {
      console.error("Sidecar forecast failed — falling back to TS:", (e as Error).message);
      demands = null;
    }
  }

  let created = 0;
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const input = inputs[i];
    const abc = input.abcCategory ?? "C";

    const result: ForecastResult =
      demands && demands[i]
        ? assembleForecastResult(input, demands[i])
        : simulateLayeredForecast(input);

    const adjustedRecommendedQty = computeRecommendedQty({
      finalForecast30d: result.finalForecast30d,
      safetyStock: result.safetyStock,
      currentStock: p.currentStock,
      onOrder: p.onOrder,
      // Category order-cover window: LOCAL 17d, KOREAN/WESTERN 21d, unclassified 30d.
      coverDays: coverDaysFor(p),
    });

    await prisma.product.update({ where: { id: p.id }, data: { abcCategory: abc } });

    const prediction = await prisma.prediction.create({
      data: {
        tenantId,
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
        regime: demands && demands[i] ? (demands[i].regime ?? null) : null,
      },
    });

    if (adjustedRecommendedQty > 0 && (result.urgency === "critical" || result.urgency === "high")) {
      await prisma.order.create({
        data: { tenantId, predictionId: prediction.id, status: "pending" },
      });
    }
    created++;
  }

  await snapshotInventory(tenantId);
  return { created, forecastRunId };
}
