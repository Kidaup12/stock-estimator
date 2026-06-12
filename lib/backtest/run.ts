/**
 * Lightweight monthly backtest (G6): hold out the last N days, predict them from
 * the recency-weighted run rate computed on prior history, and score MAE / bias /
 * MAPE. Stores one BacktestRun row so accuracy is tracked over time and the
 * drop-detector (lib/monitor/accuracy.ts) can compare runs. Callable from the
 * cron — mirrors the heavier scripts/walkforward-backtest.ts but cheap enough to
 * run unattended.
 */
import { prisma } from "@/lib/prisma";
import { weightedDailyRate } from "@/lib/forecast/baseline";

export type BacktestMetrics = { mae: number; bias: number; mape: number | null; sampleSize: number };

export async function runBacktestForTenant(tenantId: string, holdoutDays = 14): Promise<BacktestMetrics> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const holdoutStart = new Date(today);
  holdoutStart.setUTCDate(today.getUTCDate() - holdoutDays);
  const since = new Date(today);
  since.setUTCFullYear(today.getUTCFullYear() - 1);

  const sales = await prisma.salesHistory.findMany({
    where: { tenantId, date: { gte: since } },
    select: { productId: true, date: true, quantity: true },
  });

  const byProduct = new Map<string, { date: Date; quantity: number }[]>();
  for (const s of sales) {
    let arr = byProduct.get(s.productId);
    if (!arr) byProduct.set(s.productId, (arr = []));
    arr.push({ date: s.date, quantity: s.quantity });
  }

  let absErr = 0;
  let signedErr = 0;
  let mapeSum = 0;
  let mapeN = 0;
  let n = 0;
  for (const hist of byProduct.values()) {
    const train = hist.filter((h) => h.date < holdoutStart);
    const test = hist.filter((h) => h.date >= holdoutStart);
    if (train.length < 7) continue; // not enough history to predict honestly
    const predicted = weightedDailyRate(train, holdoutStart) * holdoutDays;
    const actual = test.reduce((s, h) => s + h.quantity, 0);
    absErr += Math.abs(predicted - actual);
    signedErr += predicted - actual;
    if (actual > 0) {
      mapeSum += Math.abs(predicted - actual) / actual;
      mapeN++;
    }
    n++;
  }

  const metrics: BacktestMetrics = {
    mae: n > 0 ? absErr / n : 0,
    bias: n > 0 ? signedErr / n : 0,
    mape: mapeN > 0 ? (mapeSum / mapeN) * 100 : null,
    sampleSize: n,
  };

  await prisma.backtestRun.create({
    data: { tenantId, mae: metrics.mae, bias: metrics.bias, mape: metrics.mape, sampleSize: metrics.sampleSize, tag: "holdout" },
  });
  return metrics;
}
