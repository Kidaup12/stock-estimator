/**
 * Walk-forward backtest of the forecasting models on REAL Beauty Square sales.
 *
 * Steps the clock month by month. At each "origin" (a month-end) it trains ONLY
 * on data known up to then, predicts the NEXT calendar month, and compares to
 * what actually sold that month. Three predictors are scored side by side:
 *
 *   1. Naive    — recency-weighted average daily rate × days-in-month (baseline).
 *   2. TS       — the production TypeScript model (simulateLayeredForecast).
 *   3. Sidecar  — the Python models (SARIMA / Croston-TSB / cold-start), and,
 *                 once forecast-sidecar/model.pkl exists, the XGBoost correction
 *                 layer (re-run this script with WF_TAG=xgb after training).
 *
 * Metrics per origin per model: MAE, MAPE (where actual>0), bias, n, plus the
 * regime distribution (how many SARIMA vs Croston vs cold-start).
 *
 * It is READ-ONLY against the DB — it never writes Prediction rows or mutates state.
 *
 * PREREQUISITES
 *   - Stop `npm run dev` first (Supabase pooler connection cap).
 *   - Sidecar running:
 *       cd forecast-sidecar && FORECAST_SIDECAR_SECRET=<.env val> \
 *         .venv/Scripts/python -m uvicorn app.main:app --port 8000
 *   - .env has FORECAST_SIDECAR_URL + FORECAST_SIDECAR_SECRET.
 *
 * RUN
 *   npx tsx scripts/walkforward-backtest.ts            # base run (no XGBoost)
 *   WF_TAG=xgb npx tsx scripts/walkforward-backtest.ts # after training model.pkl
 *
 * OUTPUTS (scripts/out/)
 *   wf-base.json / wf-xgb.json   — metrics + per-row dataset for that run
 *   ../docs/superpowers/forecast-backtest-report-2026-06-09.html  — analyst report
 */
import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../lib/prisma";
import { simulateLayeredForecast, type ForecastInput } from "../lib/forecast/simulate-layers";
import { forecastDemandViaSidecar } from "../lib/forecast/sidecar-client";
import { weightedDailyRate } from "../lib/forecast/baseline";
import { assignAbc, type AbcCategory } from "../lib/forecast/abc";
import { renderReport } from "./walkforward-report";

const MIN_HISTORY_DAYS = 21; // a product needs >=21 days of training history to count
const OUT_DIR = join(__dirname, "out");
const REPORT_PATH = join(__dirname, "..", "docs", "superpowers", "forecast-backtest-report-2026-06-09.html");

const TAG = (process.env.WF_TAG ?? "base").toLowerCase(); // "base" | "xgb"

/** Walk-forward origins: train on everything BEFORE the target month, predict it. */
const ORIGINS = [
  { key: "2026-01-31", label: "Jan → Feb", tStart: "2026-02-01", tEnd: "2026-03-01", days: 28 },
  { key: "2026-02-28", label: "Feb → Mar", tStart: "2026-03-01", tEnd: "2026-04-01", days: 31 },
  { key: "2026-03-31", label: "Mar → Apr", tStart: "2026-04-01", tEnd: "2026-05-01", days: 30 },
  { key: "2026-04-30", label: "Apr → May", tStart: "2026-05-01", tEnd: "2026-06-01", days: 31 },
];

type Metric = { mae: number; mdae: number; mape: number; bias: number; n: number; blow: number };
type DatasetRow = {
  origin: string;
  productId: string;
  sku: string;
  abc: AbcCategory;
  regime: string;
  layer1: number;        // sidecar layer-1 30d demand
  finalSidecar: number;  // sidecar final 30d demand (xgb off in base run)
  conf: number;          // sidecar layer-1 confidence
  recentRate: number;    // weighted daily rate at origin
  tsPred: number;        // TS prediction scaled to month
  naive: number;         // naive prediction scaled to month
  actualMonth: number;   // actual units sold in the target month
  actual30d: number;     // actual scaled to a 30-day basis (for XGB target)
  days: number;          // days in the target month
};
type OriginResult = {
  label: string;
  key: string;
  days: number;
  n: number;
  regimeDist: Record<string, number>;
  metrics: { naive: Metric; ts: Metric; sidecar: Metric };
  byRegime: Record<string, { n: number; sidecarMae: number; tsMae: number }>;
};

function ud(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Error stats for one model. `naive` (per-row baseline prediction) is used only
 * to flag "blow-ups": a prediction wildly larger than the grounded baseline
 * (> 20× naive and > 100 units) — i.e. SARIMA divergences.
 */
function metrics(pred: number[], actual: number[], naive: number[]): Metric {
  let pctErr = 0, pctN = 0, bias = 0, blow = 0;
  const n = pred.length;
  const absErrs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = actual[i], fr = pred[i];
    absErrs.push(Math.abs(fr - a));
    bias += fr - a;
    if (a > 0) { pctErr += Math.abs(fr - a) / a; pctN++; }
    if (fr > Math.max(20 * naive[i], 100)) blow++;
  }
  return {
    mae: n ? absErrs.reduce((s, v) => s + v, 0) / n : NaN,
    mdae: median(absErrs),
    mape: pctN ? (pctErr / pctN) * 100 : NaN,
    bias: n ? bias / n : NaN,
    n,
    blow,
  };
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant");
  const tenantId = tenant.id;

  console.log(`Walk-forward backtest (tag=${TAG}) — reading sales history...`);
  const rows = await prisma.salesHistory.findMany({
    where: { tenantId, channel: "shopify" },
    select: { productId: true, date: true, quantity: true, revenueKes: true },
    orderBy: { date: "asc" },
  });
  if (rows.length === 0) throw new Error("No sales history");

  // Group history by product.
  const histByProduct = new Map<string, { date: Date; quantity: number; revenueKes: number }[]>();
  for (const r of rows) {
    if (!histByProduct.has(r.productId)) histByProduct.set(r.productId, []);
    histByProduct.get(r.productId)!.push({ date: r.date, quantity: r.quantity, revenueKes: r.revenueKes });
  }

  const products = await prisma.product.findMany({
    where: { tenantId },
    select: {
      id: true, productType: true, vendor: true, sku: true, currentStock: true,
      supplier: { select: { leadTimeAvgDays: true, leadTimeStdDays: true } },
    },
  });
  const pById = new Map(products.map((p) => [p.id, p]));

  const originResults: OriginResult[] = [];
  const dataset: DatasetRow[] = [];
  // Pooled across all origins (for headline numbers).
  const allNaive: number[] = [], allTs: number[] = [], allSc: number[] = [], allActual: number[] = [];

  for (const origin of ORIGINS) {
    const tStart = ud(origin.tStart);
    const tEnd = ud(origin.tEnd);
    const scale = origin.days / 30; // 30d model output -> target-month length

    // ABC at this origin: trailing-90d revenue up to the target month.
    const abc90Start = new Date(tStart);
    abc90Start.setUTCDate(abc90Start.getUTCDate() - 90);
    const abcInput: { id: string; revenue: number }[] = [];
    for (const [pid, hist] of histByProduct) {
      const rev = hist
        .filter((h) => h.date >= abc90Start && h.date < tStart)
        .reduce((s, h) => s + h.revenueKes, 0);
      abcInput.push({ id: pid, revenue: rev });
    }
    const abcMap = assignAbc(abcInput);

    // Build cases: train = everything strictly before the target month.
    type Case = { input: ForecastInput; actual: number; recentRate: number };
    const cases: Case[] = [];
    for (const [pid, hist] of histByProduct) {
      const p = pById.get(pid);
      if (!p) continue;
      const train = hist.filter((h) => h.date < tStart).map((h) => ({ date: h.date, quantity: h.quantity }));
      if (train.length < MIN_HISTORY_DAYS) continue;
      const spanDays = (+tStart - +train[0].date) / 864e5;
      if (spanDays < MIN_HISTORY_DAYS) continue;

      const actual = hist
        .filter((h) => h.date >= tStart && h.date < tEnd)
        .reduce((s, h) => s + h.quantity, 0);

      cases.push({
        actual,
        recentRate: weightedDailyRate(train, tStart),
        input: {
          productId: pid,
          productType: p.productType,
          vendor: p.vendor,
          sku: p.sku,
          currentStock: p.currentStock,
          abcCategory: abcMap[pid] ?? "C",
          history: train,
          leadTimeAvg: p.supplier?.leadTimeAvgDays ?? 30,
          leadTimeStd: p.supplier?.leadTimeStdDays ?? 7,
          activePromos: [],
          runDateKey: origin.key,
        },
      });
    }

    if (cases.length === 0) {
      console.log(`  ${origin.label}: no qualifying products (skipped)`);
      continue;
    }

    // TS predictions.
    const tsPred = cases.map((c) => simulateLayeredForecast(c.input).finalForecast30d * scale);
    // Naive baseline.
    const naivePred = cases.map((c) => c.recentRate * origin.days);
    // Sidecar predictions (one batch per origin).
    let scDemands;
    try {
      scDemands = await forecastDemandViaSidecar(cases.map((c) => c.input));
    } catch (e) {
      throw new Error(`Sidecar call failed (is uvicorn running on :8000?): ${(e as Error).message}`);
    }
    const scPred = scDemands.map((d) => d.finalForecast30d * scale);

    const actual = cases.map((c) => c.actual);
    allNaive.push(...naivePred); allTs.push(...tsPred); allSc.push(...scPred); allActual.push(...actual);

    // Regime distribution + per-regime MAE.
    const regimeDist: Record<string, number> = {};
    const byRegime: Record<string, { n: number; sErr: number; tErr: number }> = {};
    for (let i = 0; i < cases.length; i++) {
      const rg = scDemands[i].regime ?? "unknown";
      regimeDist[rg] = (regimeDist[rg] ?? 0) + 1;
      byRegime[rg] ??= { n: 0, sErr: 0, tErr: 0 };
      byRegime[rg].n++;
      byRegime[rg].sErr += Math.abs(scPred[i] - actual[i]);
      byRegime[rg].tErr += Math.abs(tsPred[i] - actual[i]);

      // Dataset row for XGBoost training (base run is the clean one — xgb off).
      const final = scDemands[i].finalForecast30d;
      dataset.push({
        origin: origin.key,
        productId: cases[i].input.productId,
        sku: cases[i].input.sku,
        abc: cases[i].input.abcCategory as AbcCategory,
        regime: rg,
        layer1: scDemands[i].layer1Forecast30d,
        finalSidecar: final,
        conf: scDemands[i].layer1Confidence,
        recentRate: cases[i].recentRate,
        tsPred: tsPred[i],
        naive: naivePred[i],
        actualMonth: actual[i],
        actual30d: actual[i] / scale,
        days: origin.days,
      });
    }

    const byRegimeOut: OriginResult["byRegime"] = {};
    for (const [rg, v] of Object.entries(byRegime)) {
      byRegimeOut[rg] = { n: v.n, sidecarMae: v.sErr / v.n, tsMae: v.tErr / v.n };
    }

    const res: OriginResult = {
      label: origin.label,
      key: origin.key,
      days: origin.days,
      n: cases.length,
      regimeDist,
      metrics: {
        naive: metrics(naivePred, actual, naivePred),
        ts: metrics(tsPred, actual, naivePred),
        sidecar: metrics(scPred, actual, naivePred),
      },
      byRegime: byRegimeOut,
    };
    originResults.push(res);

    const m = res.metrics;
    console.log(
      `  ${origin.label} (n=${res.n}, ${origin.days}d): ` +
      `naive MAE=${m.naive.mae.toFixed(2)} | ts MAE=${m.ts.mae.toFixed(2)} | sidecar MAE=${m.sidecar.mae.toFixed(2)} ` +
      `| regimes ${Object.entries(regimeDist).map(([k, v]) => `${k}:${v}`).join(" ")}`
    );
  }

  // Pooled headline stats across all origins.
  const overall = {
    naive: metrics(allNaive, allActual, allNaive),
    ts: metrics(allTs, allActual, allNaive),
    sidecar: metrics(allSc, allActual, allNaive),
  };
  console.log(
    `\nOVERALL (pooled, ${allActual.length} cases): ` +
    `naive MdAE=${overall.naive.mdae.toFixed(2)}/MAE=${overall.naive.mae.toFixed(2)} | ` +
    `ts MdAE=${overall.ts.mdae.toFixed(2)}/MAE=${overall.ts.mae.toFixed(2)} | ` +
    `sidecar MdAE=${overall.sidecar.mdae.toFixed(2)}/MAE=${overall.sidecar.mae.toFixed(2)} (blow-ups=${overall.sidecar.blow})`
  );

  // Persist this run's metrics + dataset.
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const payload = { tag: TAG, origins: originResults, overall, rows: dataset };
  const tagPath = join(OUT_DIR, `wf-${TAG}.json`);
  writeFileSync(tagPath, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${tagPath} (${dataset.length} rows)`);

  // Regenerate the HTML report from whatever tag files exist.
  const basePath = join(OUT_DIR, "wf-base.json");
  const xgbPath = join(OUT_DIR, "wf-xgb.json");
  const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, "utf8")) : payload;
  const xgb = existsSync(xgbPath) ? JSON.parse(readFileSync(xgbPath, "utf8")) : null;
  if (!existsSync(join(__dirname, "..", "docs", "superpowers"))) {
    mkdirSync(join(__dirname, "..", "docs", "superpowers"), { recursive: true });
  }
  const html = renderReport(base, xgb);
  writeFileSync(REPORT_PATH, html);
  console.log(`Wrote report ${REPORT_PATH}${xgb ? " (with XGBoost column)" : " (base only — train XGBoost then re-run WF_TAG=xgb)"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
