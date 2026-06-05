/**
 * Backtest: TS forecast vs Python sidecar on the real Beauty Square history.
 *
 * For each product with enough history, hold out the last 14 days, forecast that
 * horizon from BOTH the TS model and the sidecar (trained only on the pre-holdout
 * window), and compare MAE / MAPE / bias vs the actual 14-day total.
 *
 * PREREQUISITE: the sidecar must be running locally:
 *   cd forecast-sidecar && .venv/Scripts/python -m uvicorn app.main:app --port 8000
 * and .env must have FORECAST_SIDECAR_URL + FORECAST_SIDECAR_SECRET set.
 * Run the Next dev server STOPPED (Supabase pooler cap):
 *   npx tsx scripts/backtest-forecast.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { simulateLayeredForecast, type ForecastInput } from "../lib/forecast/simulate-layers";
import { forecastDemandViaSidecar } from "../lib/forecast/sidecar-client";

const HOLDOUT_DAYS = 14;
const MIN_HISTORY_DAYS = 21;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant");
  const tenantId = tenant.id;

  const rows = await prisma.salesHistory.findMany({
    where: { tenantId, channel: "shopify" },
    select: { productId: true, date: true, quantity: true },
    orderBy: { date: "asc" },
  });
  if (rows.length === 0) throw new Error("No sales history");

  const maxDate = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
  const split = new Date(maxDate);
  split.setUTCDate(split.getUTCDate() - HOLDOUT_DAYS);
  const splitKey = isoDay(split);

  // Group history by product.
  const byProduct = new Map<string, { date: Date; quantity: number }[]>();
  for (const r of rows) {
    if (!byProduct.has(r.productId)) byProduct.set(r.productId, []);
    byProduct.get(r.productId)!.push({ date: r.date, quantity: r.quantity });
  }

  const products = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, productType: true, vendor: true, sku: true, currentStock: true, abcCategory: true,
      supplier: { select: { leadTimeAvgDays: true, leadTimeStdDays: true } } },
  });
  const pById = new Map(products.map((p) => [p.id, p]));

  type Case = { productId: string; input: ForecastInput; actual: number };
  const cases: Case[] = [];
  for (const [productId, hist] of byProduct) {
    const p = pById.get(productId);
    if (!p) continue;
    const train = hist.filter((h) => h.date <= split);
    if (train.length < MIN_HISTORY_DAYS) continue;
    const spanDays = (+split - +train[0].date) / 864e5;
    if (spanDays < MIN_HISTORY_DAYS) continue;
    const actual = hist.filter((h) => h.date > split).reduce((s, h) => s + h.quantity, 0);
    cases.push({
      productId,
      actual,
      input: {
        productId, productType: p.productType, vendor: p.vendor, sku: p.sku,
        currentStock: p.currentStock, abcCategory: p.abcCategory,
        history: train, leadTimeAvg: p.supplier?.leadTimeAvgDays ?? 30,
        leadTimeStd: p.supplier?.leadTimeStdDays ?? 7, activePromos: [], runDateKey: splitKey,
      },
    });
  }

  if (cases.length === 0) throw new Error("No products with enough history for backtest");
  console.log(`Backtesting ${cases.length} products | holdout ${HOLDOUT_DAYS}d after ${splitKey}`);

  // TS forecasts (30d -> scale to holdout).
  const scale = HOLDOUT_DAYS / 30;
  const tsPred = cases.map((c) => simulateLayeredForecast(c.input).finalForecast30d * scale);

  // Sidecar forecasts (batch).
  let scPred: number[];
  try {
    const demands = await forecastDemandViaSidecar(cases.map((c) => c.input));
    scPred = demands.map((d) => d.finalForecast30d * scale);
  } catch (e) {
    throw new Error(`Sidecar call failed (is uvicorn running on :8000?): ${(e as Error).message}`);
  }

  // Metrics.
  function metrics(pred: number[]) {
    let absErr = 0, pctErr = 0, pctN = 0, bias = 0;
    for (let i = 0; i < cases.length; i++) {
      const a = cases[i].actual, f = pred[i];
      absErr += Math.abs(f - a);
      bias += f - a;
      if (a > 0) { pctErr += Math.abs(f - a) / a; pctN++; }
    }
    return { mae: absErr / cases.length, mape: pctN ? (pctErr / pctN) * 100 : NaN, bias: bias / cases.length };
  }
  const ts = metrics(tsPred);
  const sc = metrics(scPred);

  let scWins = 0;
  for (let i = 0; i < cases.length; i++) {
    if (Math.abs(scPred[i] - cases[i].actual) < Math.abs(tsPred[i] - cases[i].actual)) scWins++;
  }

  console.log("\n=== BACKTEST RESULT (lower MAE/MAPE = better) ===");
  console.log(`products evaluated : ${cases.length}`);
  console.log(`TS      MAE=${ts.mae.toFixed(3)}  MAPE=${ts.mape.toFixed(1)}%  bias=${ts.bias.toFixed(3)}`);
  console.log(`SIDECAR MAE=${sc.mae.toFixed(3)}  MAPE=${sc.mape.toFixed(1)}%  bias=${sc.bias.toFixed(3)}`);
  console.log(`sidecar beats TS on ${scWins}/${cases.length} products (${((scWins / cases.length) * 100).toFixed(0)}%)`);
  const verdict = sc.mae < ts.mae ? "SIDECAR wins (lower MAE)" : "TS wins (sidecar not better)";
  console.log(`VERDICT: ${verdict}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
