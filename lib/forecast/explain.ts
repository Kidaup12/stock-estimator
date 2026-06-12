/**
 * Human-traceable breakdown of a reorder quantity (Dave DoD §3: "tap any
 * recommended quantity and see the simple math"). Reuses recommendedQty() from
 * reorder.ts as the single source of truth, so the parts ALWAYS sum to the
 * number shown on the Buy List — do the math by hand, it matches.
 *
 * Formula (same as reorder.ts):
 *   ceil( (finalForecast30d / 30) × coverDays + safety − stock − incoming ), floored at 0
 */
import { recommendedQty, type ReorderInput } from "./reorder";

export type QtyExplanation = {
  dailyForecast: number; // finalForecast30d / 30 — the capped run rate, per day
  coverDays: number;
  demandOverCover: number; // dailyForecast × coverDays
  safetyStock: number;
  currentStock: number;
  onOrder: number; // incoming / en-route
  recommendedQty: number;
  summary: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function explainQty(input: ReorderInput): QtyExplanation {
  const coverDays = input.coverDays ?? 30;
  const dailyForecast = input.finalForecast30d / 30;
  const demandOverCover = dailyForecast * coverDays;
  const qty = recommendedQty(input); // single source of truth — never drifts from the UI number
  const summary =
    `${r1(dailyForecast)}/day × ${coverDays}d (${r1(demandOverCover)})` +
    ` + safety ${r1(input.safetyStock)}` +
    ` − ${r1(input.currentStock)} in stock` +
    ` − ${r1(input.onOrder)} incoming` +
    ` = ${qty}`;
  return {
    dailyForecast,
    coverDays,
    demandOverCover,
    safetyStock: input.safetyStock,
    currentStock: input.currentStock,
    onOrder: input.onOrder,
    recommendedQty: qty,
    summary,
  };
}
