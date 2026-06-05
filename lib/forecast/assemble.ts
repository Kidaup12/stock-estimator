/**
 * Assembles a full ForecastResult from sidecar demand output + baseline.ts inventory math.
 * Pure module — no Prisma, no network.
 */
import {
  weightedDailyRate,
  kingsSafetyStock,
  reorderPoint,
  standardDeviation,
  zForServiceLevel,
  urgencyFromDays,
  daysOfStockRemaining,
} from "./baseline";
import type { ForecastInput, ForecastResult, Signal } from "./simulate-layers";

/** Demand-only output from the Python sidecar (matches DemandResponse schema). */
export type DemandForecast = {
  layer1Forecast30d: number;
  layer1Confidence: number;
  layer2Adjustment: number;
  finalForecast30d: number;
  confidence: number;
  reasoning: string;
  signals: Signal[];
  regime?: string;
};

/**
 * Combines sidecar demand fields with baseline.ts inventory math to produce a
 * complete ForecastResult. All inventory formulas (safety stock, reorder point,
 * recommended qty, urgency) live exclusively in baseline.ts — no duplication.
 */
export function assembleForecastResult(
  input: ForecastInput,
  demand: DemandForecast
): ForecastResult {
  // ── Daily rate: prefer history; fall back to finalForecast30d/30 if history is empty / zero
  const rawRate = weightedDailyRate(input.history);
  const dailyRate = rawRate > 0 ? rawRate : demand.finalForecast30d / 30;

  // ── Demand std from last 90 days of history
  const today = new Date();
  const last90Cutoff = new Date(today);
  last90Cutoff.setUTCDate(last90Cutoff.getUTCDate() - 90);
  const last90Pts = input.history.filter((p) => p.date >= last90Cutoff);
  const demandStd = standardDeviation(last90Pts.map((p) => p.quantity));

  // ── Safety stock via King's formula
  const z = zForServiceLevel(input.abcCategory);
  const safetyStock = kingsSafetyStock({
    z,
    leadTimeAvg: input.leadTimeAvg,
    leadTimeStd: input.leadTimeStd,
    demandAvg: dailyRate,
    demandStd,
  });

  // ── Reorder point
  const rop = reorderPoint(dailyRate, input.leadTimeAvg, safetyStock);

  // ── Days until stockout
  const daysUntilStockout = daysOfStockRemaining(input.currentStock, dailyRate);

  // ── Recommended order quantity
  const recommendedQty = Math.max(
    0,
    Math.ceil(demand.finalForecast30d + safetyStock - input.currentStock)
  );

  // ── Urgency from days until stockout
  const urgency = urgencyFromDays(daysUntilStockout);

  return {
    // Demand fields — passed through unchanged from sidecar
    layer1Forecast30d: demand.layer1Forecast30d,
    layer1Confidence: demand.layer1Confidence,
    layer2Adjustment: demand.layer2Adjustment,
    finalForecast30d: demand.finalForecast30d,
    confidence: demand.confidence,
    reasoning: demand.reasoning,
    signals: demand.signals,
    // Inventory math — computed here via baseline.ts
    safetyStock,
    reorderPoint: rop,
    daysUntilStockout,
    recommendedQty,
    urgency,
  };
}
