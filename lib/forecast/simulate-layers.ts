import { paydayBoost, holidayBoost, isPaydayWeek } from "@/lib/seed/kenya-calendar";
import { mulberry32, seedFrom } from "./rng";
import {
  weightedDailyRate,
  daysOfStockRemaining,
  kingsSafetyStock,
  reorderPoint,
  standardDeviation,
  urgencyFromDays,
  zForServiceLevel,
  type SalesPoint,
} from "./baseline";

export type ActivePromo = {
  discountPct: number;
  promoType: string;
  channel: string;
  scope: string;
  scopeValue: string | null;
};

export type ForecastInput = {
  productId: string;
  productType: string | null;
  vendor: string | null;
  sku: string;
  currentStock: number;
  abcCategory: string | null;
  history: SalesPoint[];
  leadTimeAvg: number;
  leadTimeStd: number;
  activePromos: ActivePromo[];
};

export type Signal = { label: string; deltaPct: number; emoji: string };

export type ForecastResult = {
  layer1Forecast30d: number;
  layer1Confidence: number;
  layer2Adjustment: number;
  finalForecast30d: number;
  daysUntilStockout: number;
  recommendedQty: number;
  safetyStock: number;
  reorderPoint: number;
  confidence: number;
  reasoning: string;
  urgency: "critical" | "high" | "medium" | "low";
  signals: Signal[];
};

function seasonalNaive30(history: SalesPoint[]): number {
  if (history.length === 0) return 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const last30 = new Date(today);
  last30.setUTCDate(last30.getUTCDate() - 30);
  const recent = history.filter(p => p.date >= last30);
  const recent30Total = recent.reduce((s, p) => s + p.quantity, 0);

  const prevStart = new Date(today);
  prevStart.setUTCDate(prevStart.getUTCDate() - 395);
  const prevEnd = new Date(today);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 365);
  const seasonal = history
    .filter(p => p.date >= prevStart && p.date < prevEnd)
    .reduce((s, p) => s + p.quantity, 0);

  if (seasonal > 0) {
    return recent30Total * 0.6 + seasonal * 0.4;
  }
  const weighted = weightedDailyRate(history, today) * 30;
  return weighted;
}

function lookaheadHolidayBoost(productType: string | null): { boost: number; name: string | null } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let best = { boost: 1.0, name: null as string | null };
  for (let d = 0; d < 30; d++) {
    const dt = new Date(today);
    dt.setUTCDate(dt.getUTCDate() + d);
    const hb = holidayBoost(dt, productType);
    if (hb.boost > best.boost) best = hb;
  }
  return best;
}

function lookaheadPaydays(): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let payDays = 0;
  for (let d = 0; d < 30; d++) {
    const dt = new Date(today);
    dt.setUTCDate(dt.getUTCDate() + d);
    if (isPaydayWeek(dt)) payDays++;
  }
  return payDays;
}

function activePromoLift(promos: ActivePromo[], productType: string | null, vendor: string | null, sku: string): { lift: number; channel: string | null } {
  let bestLift = 1.0;
  let channel: string | null = null;
  for (const p of promos) {
    const matches =
      p.scope === "all" ||
      (p.scope === "sku" && p.scopeValue === sku) ||
      (p.scope === "category" && p.scopeValue && p.scopeValue.toUpperCase() === (productType ?? "").toUpperCase()) ||
      (p.scope === "brand" && p.scopeValue && p.scopeValue.toUpperCase() === (vendor ?? "").toUpperCase());
    if (!matches) continue;
    const lift = 1 + (p.discountPct / 100) * 1.5;
    if (lift > bestLift) {
      bestLift = lift;
      channel = p.channel;
    }
  }
  return { lift: bestLift, channel };
}

export function simulateLayeredForecast(input: ForecastInput): ForecastResult {
  const layer1 = seasonalNaive30(input.history);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // Deterministic RNG keyed on (productId, todayISO) per D-06 / FND-02.
  // Same productId on the same calendar day yields the same noise sequence.
  const rng = mulberry32(seedFrom([input.productId, today]));
  const last30 = new Date(today);
  last30.setUTCDate(last30.getUTCDate() - 30);
  const last90 = new Date(today);
  last90.setUTCDate(last90.getUTCDate() - 90);
  const recent = input.history.filter(p => p.date >= last30);
  const last90Pts = input.history.filter(p => p.date >= last90);

  const meanRecent = recent.length > 0 ? recent.reduce((s, p) => s + p.quantity, 0) / recent.length : 0;
  const std90 = standardDeviation(last90Pts.map(p => p.quantity));
  const cv = meanRecent > 0 ? std90 / meanRecent : 1.0;
  const layer1Confidence = Math.max(0.3, Math.min(0.95, 0.9 - cv * 0.3));

  const signals: Signal[] = [];

  const hol = lookaheadHolidayBoost(input.productType);
  if (hol.boost > 1.05) {
    const delta = (hol.boost - 1) * 100;
    const emoji = hol.name?.includes("Christmas") ? "🎄" : hol.name?.includes("Valentine") ? "💝" : hol.name?.includes("Eid") ? "🌙" : "🎉";
    signals.push({ label: `${hol.name} +${delta.toFixed(0)}%`, deltaPct: delta, emoji });
  }

  const payDays = lookaheadPaydays();
  if (payDays > 0) {
    const payLift = 1 + (payDays / 30) * 0.6;
    if (payLift > 1.02) {
      signals.push({ label: `Payday weeks +${((payLift - 1) * 100).toFixed(0)}%`, deltaPct: (payLift - 1) * 100, emoji: "💰" });
    }
  }

  const promo = activePromoLift(input.activePromos, input.productType, input.vendor, input.sku);
  if (promo.lift > 1.01) {
    signals.push({ label: `Active promo ${promo.channel ?? ""} +${((promo.lift - 1) * 100).toFixed(0)}%`, deltaPct: (promo.lift - 1) * 100, emoji: "🏷️" });
  }

  const holMult = hol.boost;
  const payMult = 1 + (payDays / 30) * 0.6;
  const promoMult = promo.lift;
  const totalMult = holMult * payMult * promoMult;
  const noise = 0.95 + rng() * 0.1;
  const layer2Final = layer1 * totalMult * noise;
  const layer2Adjustment = layer2Final - layer1;

  const dailyRate = weightedDailyRate(input.history);
  const demandStd = standardDeviation(last90Pts.map(p => p.quantity));
  const z = zForServiceLevel(input.abcCategory);
  const safety = kingsSafetyStock({
    z,
    leadTimeAvg: input.leadTimeAvg,
    leadTimeStd: input.leadTimeStd,
    demandAvg: dailyRate,
    demandStd,
  });
  const rop = reorderPoint(dailyRate, input.leadTimeAvg, safety);

  const daysLeft = daysOfStockRemaining(input.currentStock, dailyRate);
  const urgency = urgencyFromDays(daysLeft);

  const finalForecast30d = Math.max(0, layer2Final);
  const recommendedQty = Math.max(0, Math.ceil(finalForecast30d + safety - input.currentStock));

  const reasoning = [
    `Layer 1 (SARIMA mock) projected ${layer1.toFixed(0)} units over 30 days based on weighted history + same-period last year.`,
    `Layer 2 (XGBoost mock) adjusted by ${(totalMult * 100 - 100).toFixed(0)}% from signals (holidays, payday, promos).`,
    `With ${input.leadTimeAvg}±${input.leadTimeStd}d lead time and ${input.abcCategory ?? "C"}-class service level (z=${z}), safety stock = ${safety.toFixed(0)}.`,
    `Reorder point: ${rop.toFixed(0)} units. Current stock ${input.currentStock} covers ~${daysLeft} days.`,
  ].join(" ");

  return {
    layer1Forecast30d: layer1,
    layer1Confidence,
    layer2Adjustment,
    finalForecast30d,
    daysUntilStockout: daysLeft,
    recommendedQty,
    safetyStock: safety,
    reorderPoint: rop,
    confidence: layer1Confidence,
    reasoning,
    urgency,
    signals,
  };
}
