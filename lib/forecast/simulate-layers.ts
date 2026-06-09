import { holidayBoost, isPaydayWeek } from "@/lib/seed/kenya-calendar";
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
  /**
   * Tenant-local calendar day (YYYY-MM-DD) that anchors BOTH the rng seed and all
   * internal date math (TNT-08 / D-19). When supplied, two runs at different UTC
   * instants within the same tenant day produce identical output. When absent,
   * falls back to wall-clock UTC midnight (Phase 1 / FND-02 behavior).
   */
  runDateKey?: string;
};

// ── Forecast policy (set by the 2026-06-09 walk-forward backtest) ────────────
// Verdict on ~6 months of real data: a recency-weighted RUN RATE beats every
// fancier model, the calendar boosts make it WORSE (no full season to learn
// from yet), and a 3×-best-month cap kills runaway forecasts at zero accuracy
// cost. See docs/superpowers/forecast-final-report-2026-06-09.
//
// Re-enable the boosts (and re-run scripts/walkforward-backtest.ts to confirm)
// only once the history spans a real holiday season (Christmas / Valentine's).
const APPLY_CALENDAR_BOOSTS = false;
/** No forecast may exceed this multiple of the product's best trailing month. */
const FORECAST_CAP_MULTIPLE = 3;
/** Under this many days of history a product is "new": use a plain last-30-day
 *  rate. Longer windows divide by days the product didn't exist → under-forecast. */
const NEW_PRODUCT_DAYS = 60;

/** Anchor "today" on the tenant-local day key when present, else wall-clock UTC midnight. */
function anchorToday(runDateKey?: string): Date {
  if (runDateKey) return new Date(`${runDateKey}T00:00:00Z`);
  const t = new Date();
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

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

/** Days of history available as of `today` (0 when there is none). */
function historySpanDays(history: SalesPoint[], today: Date): number {
  if (history.length === 0) return 0;
  let earliest = history[0].date;
  for (const p of history) if (p.date < earliest) earliest = p.date;
  return (+today - +earliest) / 864e5;
}

/** Plain mean daily rate over the trailing `windowDays` before `today`. */
function rateOverWindow(history: SalesPoint[], today: Date, windowDays: number): number {
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - windowDays);
  const qty = history
    .filter((p) => p.date >= since && p.date < today)
    .reduce((s, p) => s + p.quantity, 0);
  return qty / windowDays;
}

/**
 * The production demand rate (units/day), per the backtest decision rule:
 *   <60 days of history → last-30-day average (new product)
 *   otherwise           → recency-weighted 30/90/365-day blend
 */
function runRateDaily(history: SalesPoint[], today: Date): number {
  const span = historySpanDays(history, today);
  return span < NEW_PRODUCT_DAYS
    ? rateOverWindow(history, today, 30)
    : weightedDailyRate(history, today);
}

/** Largest single calendar-month sales total in the history before `today` (0 if none). */
function bestTrailingMonth(history: SalesPoint[], today: Date): number {
  const byMonth = new Map<string, number>();
  for (const p of history) {
    if (p.date >= today) continue;
    const key = p.date.toISOString().slice(0, 7); // YYYY-MM
    byMonth.set(key, (byMonth.get(key) ?? 0) + p.quantity);
  }
  return byMonth.size ? Math.max(...byMonth.values()) : 0;
}

function lookaheadHolidayBoost(productType: string | null, today: Date): { boost: number; name: string | null } {
  let best = { boost: 1.0, name: null as string | null };
  for (let d = 0; d < 30; d++) {
    const dt = new Date(today);
    dt.setUTCDate(dt.getUTCDate() + d);
    const hb = holidayBoost(dt, productType);
    if (hb.boost > best.boost) best = hb;
  }
  return best;
}

function lookaheadPaydays(today: Date): number {
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
  // Anchor ALL date math on the tenant-local day (TNT-08). When runDateKey is
  // supplied, two runs at different UTC instants within one tenant day are
  // identical; when absent, falls back to wall-clock UTC midnight (FND-02).
  const today = anchorToday(input.runDateKey);
  const span = historySpanDays(input.history, today);
  const isNew = span < NEW_PRODUCT_DAYS;

  // ── Layer 1: recency-weighted run rate (the production forecast) ──────────
  const dailyRate = runRateDaily(input.history, today);
  const layer1 = dailyRate * 30;

  // ── Confidence: coefficient of variation of recent demand (unchanged) ─────
  const last30 = new Date(today);
  last30.setUTCDate(last30.getUTCDate() - 30);
  const last90 = new Date(today);
  last90.setUTCDate(last90.getUTCDate() - 90);
  const recent = input.history.filter((p) => p.date >= last30);
  const last90Pts = input.history.filter((p) => p.date >= last90);
  const meanRecent = recent.length > 0 ? recent.reduce((s, p) => s + p.quantity, 0) / recent.length : 0;
  const std90 = standardDeviation(last90Pts.map((p) => p.quantity));
  const cv = meanRecent > 0 ? std90 / meanRecent : 1.0;
  const layer1Confidence = Math.max(0.3, Math.min(0.95, 0.9 - cv * 0.3));

  // ── Layer 2: calendar boosts — DISABLED until a full season is in the data.
  // Kept (behind APPLY_CALENDAR_BOOSTS) so they can be re-enabled + re-tested
  // once a real Christmas/Valentine's exists in the history.
  const signals: Signal[] = [];
  let boosted = layer1;
  if (APPLY_CALENDAR_BOOSTS) {
    const hol = lookaheadHolidayBoost(input.productType, today);
    if (hol.boost > 1.05) {
      const delta = (hol.boost - 1) * 100;
      const emoji = hol.name?.includes("Christmas") ? "🎄" : hol.name?.includes("Valentine") ? "💝" : hol.name?.includes("Eid") ? "🌙" : "🎉";
      signals.push({ label: `${hol.name} +${delta.toFixed(0)}%`, deltaPct: delta, emoji });
    }
    const payDays = lookaheadPaydays(today);
    const payLift = 1 + (payDays / 30) * 0.6;
    if (payLift > 1.02) {
      signals.push({ label: `Payday weeks +${((payLift - 1) * 100).toFixed(0)}%`, deltaPct: (payLift - 1) * 100, emoji: "💰" });
    }
    const promo = activePromoLift(input.activePromos, input.productType, input.vendor, input.sku);
    if (promo.lift > 1.01) {
      signals.push({ label: `Active promo ${promo.channel ?? ""} +${((promo.lift - 1) * 100).toFixed(0)}%`, deltaPct: (promo.lift - 1) * 100, emoji: "🏷️" });
    }
    const rng = mulberry32(seedFrom([input.productId, input.runDateKey ?? today]));
    const noise = 0.95 + rng() * 0.1;
    boosted = layer1 * hol.boost * payLift * promo.lift * noise;
  }

  // ── Safety cap: never exceed 3× the product's best trailing month ─────────
  const best = bestTrailingMonth(input.history, today);
  const cap = best > 0 ? FORECAST_CAP_MULTIPLE * best : Infinity;
  const capped = Math.min(boosted, cap);
  const wasCapped = capped < boosted - 1e-9;
  if (wasCapped) {
    signals.push({
      label: `Capped at ${FORECAST_CAP_MULTIPLE}× best month`,
      deltaPct: ((capped - boosted) / boosted) * 100,
      emoji: "✂️",
    });
  }

  const finalForecast30d = Math.max(0, capped);
  const layer2Adjustment = finalForecast30d - layer1;

  // ── Inventory math (anchored on the same day-aware daily rate) ────────────
  const demandStd = standardDeviation(last90Pts.map((p) => p.quantity));
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

  const recommendedQty = Math.max(0, Math.ceil(finalForecast30d + safety - input.currentStock));

  const reasoning = [
    `Forecast ${finalForecast30d.toFixed(0)} units over 30 days from the ${isNew ? "last-30-day rate (new product)" : "recency-weighted run rate (30/90/365-day blend)"}: ${dailyRate.toFixed(2)} units/day.`,
    wasCapped ? `Capped at ${FORECAST_CAP_MULTIPLE}× the best month (${best.toFixed(0)}) to block runaway numbers.` : "",
    `Safety stock ${safety.toFixed(0)} (${input.abcCategory ?? "C"}-class service, z=${z}, lead time ${input.leadTimeAvg}±${input.leadTimeStd}d); reorder point ${rop.toFixed(0)}.`,
    `Current stock ${input.currentStock} covers ~${daysLeft} days.`,
  ].filter(Boolean).join(" ");

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
