export type SalesPoint = { date: Date; quantity: number };

export function weightedDailyRate(history: SalesPoint[], asOf: Date = new Date()): number {
  if (history.length === 0) return 0;
  const windows: { days: number; weight: number }[] = [
    { days: 30, weight: 0.5 },
    { days: 90, weight: 0.3 },
    { days: 365, weight: 0.2 },
  ];

  let weighted = 0;
  for (const w of windows) {
    const since = new Date(asOf);
    since.setUTCDate(since.getUTCDate() - w.days);
    const qty = history.filter(p => p.date >= since).reduce((s, p) => s + p.quantity, 0);
    weighted += (qty / w.days) * w.weight;
  }
  return weighted;
}

export function daysOfStockRemaining(currentStock: number, dailyRate: number): number {
  if (dailyRate <= 0.0001) return 999;
  return Math.floor(currentStock / dailyRate);
}

export function kingsSafetyStock(params: {
  z: number;
  leadTimeAvg: number;
  leadTimeStd: number;
  demandAvg: number;
  demandStd: number;
}): number {
  const variance =
    params.leadTimeAvg * Math.pow(params.demandStd, 2) +
    Math.pow(params.demandAvg, 2) * Math.pow(params.leadTimeStd, 2);
  return params.z * Math.sqrt(variance);
}

export function reorderPoint(demandAvg: number, leadTimeAvg: number, safetyStock: number): number {
  return demandAvg * leadTimeAvg + safetyStock;
}

export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function urgencyFromDays(days: number): "critical" | "high" | "medium" | "low" {
  if (days < 7) return "critical";
  if (days < 14) return "high";
  if (days < 30) return "medium";
  return "low";
}

export function zForServiceLevel(abc: string | null | undefined): number {
  if (abc === "A") return 2.33;
  if (abc === "B") return 1.65;
  return 1.28;
}
