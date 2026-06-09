/**
 * Renders the self-contained HTML analyst report for the walk-forward backtest.
 * Pure string builder — no I/O, no deps. Imported by walkforward-backtest.ts.
 *
 * Inputs are the parsed wf-base.json (always) and wf-xgb.json (optional, null
 * until the XGBoost model is trained and the harness re-run with WF_TAG=xgb).
 *
 * The PRIMARY accuracy metric is the MEDIAN absolute error ("typical miss"),
 * because mean MAE is dominated by rare SARIMA blow-ups. Blow-ups are reported
 * separately as an instability count.
 */

type Metric = { mae: number; mdae: number; mape: number; bias: number; n: number; blow: number };
type OriginResult = {
  label: string;
  key: string;
  days: number;
  n: number;
  regimeDist: Record<string, number>;
  metrics: { naive: Metric; ts: Metric; sidecar: Metric };
  byRegime: Record<string, { n: number; sidecarMae: number; tsMae: number }>;
};
type Row = {
  origin: string; regime: string; finalSidecar: number; days: number;
  actualMonth: number; tsPred: number; naive: number; sku?: string;
};
type RunFile = { tag: string; origins: OriginResult[]; overall: { naive: Metric; ts: Metric; sidecar: Metric }; rows: Row[] };

const REGIME_LABEL: Record<string, string> = {
  sarima: "SARIMA (steady sellers)",
  tsb: "Croston/TSB (slow / lumpy)",
  croston: "Croston/TSB (slow / lumpy)",
  cold_start: "Cold-start (brand new)",
  unknown: "Unknown",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function f(n: number, d = 2): string {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}
function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const scMonth = (r: Row) => r.finalSidecar * (r.days / 30);

export function renderReport(base: RunFile, xgb: RunFile | null): string {
  const origins = base.origins;
  const xgbByKey = new Map<string, OriginResult>((xgb?.origins ?? []).map((o) => [o.key, o]));
  const hasXgb = !!xgb && xgbByKey.size > 0;

  // The Apr→May origin is the ONLY month XGBoost never trained on — the only fair
  // test of it. Jan/Feb/Mar XGBoost numbers are in-sample (the model saw them) and
  // must never be used to crown it: they look great only because it memorised them.
  const aprKey = "2026-04-30";
  const isInSampleXgb = (key: string) => key !== aprKey; // xgb trained on all but Apr
  const aprBase = origins.find((o) => o.key === aprKey);
  const aprXgb = xgbByKey.get(aprKey);
  const xgbOosBase = aprBase?.metrics.sidecar.mdae ?? NaN;
  const xgbOos = aprXgb?.metrics.sidecar.mdae ?? NaN;
  const xgbHelpsOOS = !!(Number.isFinite(xgbOos) && Number.isFinite(xgbOosBase) && xgbOos < xgbOosBase);

  // ── Headline (pooled MEDIAN error — robust to blow-ups) ───────────────────
  const oNaive = base.overall.naive.mdae;
  const oTs = base.overall.ts.mdae;
  const oSc = base.overall.sidecar.mdae;
  const scBlow = base.overall.sidecar.blow;

  // XGBoost is intentionally EXCLUDED from the pooled "best" race (3 of its 4 months
  // are in-sample). It is judged separately, out-of-sample only.
  const contenders = [
    { name: "Naïve average", mdae: oNaive },
    { name: "Production model (TS)", mdae: oTs },
    { name: "Python models", mdae: oSc },
  ].filter((c) => Number.isFinite(c.mdae));
  const best = contenders.reduce((b, c) => (c.mdae < b.mdae ? c : b), contenders[0]);
  const smartBeatsNaive = contenders.some((c) => c.name !== "Naïve average" && c.mdae < oNaive);

  const verdictGood = smartBeatsNaive && best.name !== "Naïve average";
  const headline = verdictGood
    ? `The forecasting works — but the simple baseline is hard to beat. On a typical product the best model (<b>${esc(best.name)}</b>) misses by about <b>${f(best.mdae, 1)} units/month</b>, slightly better than just averaging recent sales (${f(oNaive, 1)}).`
    : `Honest read: on this data the "smart" models do <b>not</b> reliably beat a simple recency-weighted average (typical miss ≈ <b>${f(oNaive, 1)} units/month</b>). The system isn't broken — it's <b>data-starved</b>. And the Python SARIMA model is <b>unstable</b> on short history (${scBlow} runaway forecasts).`;

  // ── Per-month table (MEDIAN primary) ──────────────────────────────────────
  const cols = hasXgb ? (["naive", "ts", "sidecar", "xgb"] as const) : (["naive", "ts", "sidecar"] as const);
  const colTitle: Record<string, string> = { naive: "Naïve", ts: "Production (TS)", sidecar: "Python models", xgb: "Python + XGBoost" };
  const mFor = (o: OriginResult, c: string): Metric | undefined =>
    c === "xgb" ? xgbByKey.get(o.key)?.metrics.sidecar : o.metrics[c as "naive" | "ts" | "sidecar"];

  const monthRows = origins.map((o) => {
    // Best-cell race excludes XGBoost on months it trained on (in-sample = not fair).
    const eligible = cols
      .filter((c) => !(c === "xgb" && isInSampleXgb(o.key)))
      .map((c) => mFor(o, c)?.mdae ?? NaN)
      .filter(Number.isFinite);
    const bestMd = eligible.length ? Math.min(...eligible) : NaN;
    const cells = cols.map((c) => {
      const m = mFor(o, c);
      if (!m) return `<td class="num">—</td>`;
      const inSample = c === "xgb" && isInSampleXgb(o.key);
      const isBest = !inSample && Math.abs(m.mdae - bestMd) < 1e-9;
      const blow = m.blow > 0 ? ` <span class="flag">⚠${m.blow}</span>` : "";
      const star = inSample ? ` <span class="star" title="In-sample: XGBoost trained on this month — not a fair test">★</span>` : "";
      return `<td class="num${isBest ? " best" : ""}${inSample ? " insample" : ""}">${f(m.mdae, 1)}${star}${blow}<span class="sub">MAE ${f(m.mae, 0)} · ${f(m.mape, 0)}%</span></td>`;
    }).join("");
    const thin = o.key === aprKey ? ' <span class="flag">May thin</span>' : "";
    return `<tr><td>${esc(o.label)}${thin}</td><td class="num">${o.n}</td>${cells}</tr>`;
  }).join("");

  // ── Chart: typical miss (median) per origin — the 3 honestly-comparable models.
  // XGBoost omitted: its in-sample months would draw misleadingly tiny bars.
  const chartCols = ["naive", "ts", "sidecar"] as const;
  const colColor: Record<string, string> = { naive: "#9ca3af", ts: "#2563eb", sidecar: "#16a34a", xgb: "#9333ea" };
  const allMd = origins.flatMap((o) => chartCols.map((c) => mFor(o, c)?.mdae ?? NaN)).filter(Number.isFinite);
  const maxMd = Math.max(1, ...allMd);
  const cW = 760, cH = 280, padL = 44, padB = 54, padT = 12;
  const plotW = cW - padL - 12, plotH = cH - padB - padT;
  const gW = plotW / origins.length;
  const bW = Math.min(34, (gW - 16) / chartCols.length);
  let bars = "";
  origins.forEach((o, gi) => {
    const gx = padL + gi * gW + 8;
    chartCols.forEach((c, bi) => {
      const v = mFor(o, c)?.mdae ?? NaN;
      if (!Number.isFinite(v)) return;
      const h = (v / maxMd) * plotH, x = gx + bi * (bW + 3), y = padT + plotH - h;
      bars += `<rect x="${f(x, 1)}" y="${f(y, 1)}" width="${f(bW, 1)}" height="${f(h, 1)}" fill="${colColor[c]}"><title>${esc(o.label)} — ${colTitle[c]}: typical miss ${f(v, 1)}</title></rect>`;
    });
    bars += `<text x="${f(gx + (chartCols.length * (bW + 3)) / 2, 1)}" y="${cH - padB + 18}" text-anchor="middle" class="axlab">${esc(o.label)}</text>`;
  });
  let grid = "";
  for (let g = 0; g <= 4; g++) {
    const val = (maxMd * g) / 4, y = padT + plotH - (g / 4) * plotH;
    grid += `<line x1="${padL}" y1="${f(y, 1)}" x2="${cW - 12}" y2="${f(y, 1)}" class="grid"/><text x="${padL - 6}" y="${f(y + 3, 1)}" text-anchor="end" class="axlab">${f(val, 0)}</text>`;
  }
  const legend = chartCols.map((c) => `<span class="lg"><i style="background:${colColor[c]}"></i>${colTitle[c]}</span>`).join("");

  // ── Regime breakdown (robust, computed from raw rows) ──────────────────────
  const byRg: Record<string, { sc: number[]; ts: number[]; blow: number }> = {};
  for (const r of base.rows) {
    const k = r.regime || "unknown";
    byRg[k] ??= { sc: [], ts: [], blow: 0 };
    byRg[k].sc.push(Math.abs(scMonth(r) - r.actualMonth));
    byRg[k].ts.push(Math.abs(r.tsPred - r.actualMonth));
    if (scMonth(r) > Math.max(20 * r.naive, 100)) byRg[k].blow++;
  }
  const regimeRows = Object.entries(byRg)
    .sort((a, b) => b[1].sc.length - a[1].sc.length)
    .map(([rg, v]) =>
      `<tr><td>${esc(REGIME_LABEL[rg] ?? rg)}</td><td class="num">${v.sc.length}</td><td class="num">${f(median(v.sc), 1)}</td><td class="num">${f(median(v.ts), 1)}</td><td class="num">${v.blow > 0 ? `<span class="flag">${v.blow}</span>` : "0"}</td></tr>`
    ).join("");

  // ── Worst SARIMA blow-up (for the narrative) ──────────────────────────────
  const worst = [...base.rows].sort((a, b) => scMonth(b) - scMonth(a))[0];

  // ── Plain-English analysis ────────────────────────────────────────────────
  const pct = (a: number, b: number) => (b > 0 ? (1 - a / b) * 100 : 0);
  const analysis: string[] = [];
  analysis.push(
    smartBeatsNaive
      ? `<b>Do the models beat a dumb baseline?</b> Slightly. The best model's typical miss (${f(best.mdae, 1)} units) is ${f(pct(best.mdae, oNaive), 0)}% better than just averaging recent sales (${f(oNaive, 1)}). Real, but not dramatic — which is exactly what ~5 months of history buys you.`
      : `<b>Do the models beat a dumb baseline?</b> No, not reliably. A recency-weighted average is the model to beat (typical miss ${f(oNaive, 1)} units/month), and the fancier models don't clear it on this data. That's the honest signal that the history is too short, not that the math is wrong.`
  );
  analysis.push(
    `<b>The Python SARIMA model is unstable on short data.</b> ${scBlow} forecasts ran away to absurd numbers` +
    (worst ? ` — the worst predicted <b>${f(scMonth(worst), 0)} units</b> for SKU ${esc(worst.sku ?? "?")} that actually sold ${worst.actualMonth}` : "") +
    `. SARIMA's trend+seasonal differencing extrapolates wildly when it has only a few weeks to fit. These rare blow-ups wreck the average error, which is why this report leads with the <i>median</i> (typical) miss instead. <b>Croston/TSB</b> (the slow-mover model, ~2/3 of the catalog) was stable throughout.`
  );
  analysis.push(
    oTs <= oSc
      ? `<b>Production model vs Python models?</b> The current production model (typical miss ${f(oTs, 1)}) is as good as or better than the Python models (${f(oSc, 1)}) here — and it never blows up. No reason to switch yet.`
      : `<b>Production model vs Python models?</b> The Python models (typical miss ${f(oSc, 1)}) edge the production model (${f(oTs, 1)}) on typical accuracy, but only once you ignore their blow-ups. Not switch-ready until SARIMA is guarded.`
  );
  if (hasXgb) {
    analysis.push(
      `<b>Does XGBoost help?</b> ` +
      (xgbHelpsOOS
        ? `Barely. On the only honest test — Apr→May, the one month it never trained on — it nudged the typical miss from ${f(xgbOosBase, 1)} to ${f(xgbOos, 1)}. A faint positive, one month, noise-level — not proof.`
        : `No. On the only honest test — Apr→May, the one month it never trained on — it did not improve the typical miss (${f(xgbOosBase, 1)} → ${f(xgbOos, 1)}).`) +
      ` <b>Ignore its Jan/Feb/Mar numbers</b> (marked ★): the model trained on those months, so it just memorised them — that's why they look spectacular and the pooled figure is misleading. With only 4 monthly snapshots to learn from, XGBoost has nothing real to correct yet.`
    );
  } else {
    analysis.push(`<b>Does XGBoost help?</b> Pending — train the model and re-run with the XGBoost column.`);
  }
  analysis.push(
    `<b>Is there enough data?</b> No — and this is the headline. History runs only Dec 2025 → Jun 2026, and May/June are thin (a sync gap). The early months (Jan→Feb) are weakest precisely because the models had ~6 weeks to learn from. The single highest-leverage fix is a <b>full year of sales</b> via the <code>read_all_orders</code> backfill — it lifts every model and is what SARIMA needs to stop misbehaving.`
  );

  const recs = [
    `For now, trust the forecast as a <b>guide, not gospel</b>: it's roughly baseline-good for steady & slow movers, but pair it with the owner's judgement on new and spiky SKUs.`,
    `Get the <b>full year of history</b> (<code>read_all_orders</code> backfill). Every model above is data-starved; this is the one change that helps all of them at once.`,
    `<b>Guard SARIMA</b> before ever putting the Python models live — cap any forecast at, say, 3× the product's trailing best month so a divergence can't propose a 100,000-unit reorder.`,
    hasXgb && !xgbHelpsOOS
      ? `<b>Shelve XGBoost</b> until a year of data exists — on 4 monthly snapshots it overfits and adds no real accuracy.`
      : `Re-evaluate XGBoost on a full year; it needs many repeated seasons to learn a genuine correction.`,
    `Re-run this exact backtest each month as data accrues — it's now a one-command health check on the forecasting brain (<code>npx tsx scripts/walkforward-backtest.ts</code>).`,
  ];

  const kpi = (lab: string, m: Metric, isBest: boolean, extra = "") =>
    `<div class="kpi"><div class="lab">${lab}</div><div class="val${isBest ? " best" : ""}">${f(m.mdae, 1)}</div><div class="ksub">MAE ${f(m.mae, 0)}${extra}</div></div>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Forecast Model Test — Walk-Forward Backtest</title>
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;--good:#16a34a;--warn:#b45309;}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @page{margin:12mm;}
  @media print{.wrap{max-width:none;padding:0;}h2{break-after:avoid;}table,.card,ul.analysis li,.verdict{break-inside:avoid;}}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:920px;margin:0 auto;padding:32px 22px 80px;}
  h1{font-size:26px;margin:0 0 4px;}
  h2{font-size:19px;margin:38px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px;}
  .sub-h{color:var(--muted);margin:0 0 22px;font-size:13.5px;}
  .verdict{background:linear-gradient(135deg,#ecfdf5,#eff6ff);border:1px solid #bbf7d0;border-radius:14px;padding:20px 22px;font-size:17px;}
  .verdict.bad{background:linear-gradient(135deg,#fff7ed,#fef2f2);border-color:#fed7aa;}
  .kpis{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0 4px;}
  .kpi{flex:1;min-width:150px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;}
  .kpi .lab{color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.03em;}
  .kpi .val{font-size:26px;font-weight:650;margin-top:3px;}
  .kpi .val.best{color:var(--good);}
  .kpi .ksub{color:var(--muted);font-size:12px;margin-top:2px;}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:14px;}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);}
  th{background:#f1f5f9;font-size:12.5px;text-transform:uppercase;letter-spacing:.02em;color:#475569;}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;}
  td.num .sub{display:block;color:var(--muted);font-size:11px;}
  td.best{background:#f0fdf4;font-weight:650;color:var(--good);}
  tr:last-child td{border-bottom:none;}
  .flag{color:var(--warn);font-size:11px;white-space:nowrap;font-weight:600;}
  .star{color:#9333ea;font-weight:700;}
  td.insample{color:var(--muted);background:#faf5ff;}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;}
  .legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--muted);}
  .lg{display:inline-flex;align-items:center;gap:6px;}
  .lg i{width:11px;height:11px;border-radius:3px;display:inline-block;}
  svg .grid{stroke:var(--line);stroke-width:1;}
  svg .axlab{fill:var(--muted);font-size:11px;}
  ul.analysis{list-style:none;padding:0;margin:0;}
  ul.analysis li{background:var(--card);border:1px solid var(--line);border-left:3px solid #2563eb;border-radius:8px;padding:12px 15px;margin-bottom:10px;}
  ol.recs{padding-left:20px;} ol.recs li{margin-bottom:8px;}
  code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:13px;}
  .note{color:var(--muted);font-size:12.5px;margin-top:8px;}
  .foot{color:var(--muted);font-size:12px;margin-top:40px;border-top:1px solid var(--line);padding-top:14px;}
</style></head>
<body><div class="wrap">

<h1>Forecast Model Test — Walk-Forward Backtest</h1>
<p class="sub-h">Beauty Square real sales · Dec 2025 → Jun 2026 · models trained month-by-month, each predicting the next month and checked against what actually sold.${hasXgb ? " Includes the trained XGBoost layer." : " Base run (no XGBoost yet)."}</p>

<div class="verdict${verdictGood ? "" : " bad"}">${headline}</div>

<div class="kpis">
  ${kpi("Naïve average", base.overall.naive, best.name === "Naïve average")}
  ${kpi("Production (TS)", base.overall.ts, best.name === "Production model (TS)")}
  ${kpi("Python models", base.overall.sidecar, best.name === "Python models", ` · ${scBlow} blow-ups`)}
  ${hasXgb ? `<div class="kpi"><div class="lab">Python + XGBoost</div><div class="val${xgbHelpsOOS ? " best" : ""}">${f(xgbOos, 1)}</div><div class="ksub">Apr→May only (out-of-sample)</div></div>` : ""}
</div>
<p class="note">Big number = <b>typical miss</b> (median units off per product per month, <b>lower is better</b>). MAE = mean error (skewed by rare blow-ups). XGBoost shows its <b>out-of-sample</b> month only — its pooled number is inflated by training-month memorisation, so it's excluded from the headline race.</p>

<h2>How each month scored</h2>
<table>
  <thead><tr><th>Train → predict</th><th class="num">Products</th>${cols.map((c) => `<th class="num">${colTitle[c]}</th>`).join("")}</tr></thead>
  <tbody>${monthRows}</tbody>
</table>
<p class="note">Each cell: <b>typical miss</b> (median), with <span style="color:var(--muted)">mean MAE · MAPE%</span> beneath. <span class="flag">⚠N</span> = N runaway forecasts that month. <span class="star">★</span> = in-sample for XGBoost (it trained on that month — <b>not a fair test, ignore</b>); only Apr→May is a real XGBoost test. Lowest typical miss per row is green.</p>

<h2>Typical miss by month, side by side</h2>
<div class="card">
  <svg viewBox="0 0 ${cW} ${cH}" width="100%" role="img" aria-label="Typical miss per month per model">${grid}${bars}</svg>
  <div class="legend">${legend}</div>
</div>

<h2>Which kind of product each model handled</h2>
<p class="sub-h" style="margin-bottom:12px">Every product is auto-routed to one model by its sales pattern. Errors below are typical (median) miss across all months.</p>
<table>
  <thead><tr><th>Model bucket</th><th class="num">Products</th><th class="num">Python miss</th><th class="num">Production miss</th><th class="num">Blow-ups</th></tr></thead>
  <tbody>${regimeRows}</tbody>
</table>

<h2>What the data says</h2>
<ul class="analysis">${analysis.map((a) => `<li>${a}</li>`).join("")}</ul>

<h2>Recommendations</h2>
<ol class="recs">${recs.map((r) => `<li>${r}</li>`).join("")}</ol>

<div class="foot">
  Generated by <code>scripts/walkforward-backtest.ts</code>. Read-only backtest — no database writes.
  Caveats: no historical promo snapshots (calendar holiday/payday signals still applied); models output
  30-day demand scaled to each month's length; measures <b>demand-forecast accuracy only</b>, not the
  reorder / safety-stock math. "Typical miss" is the median absolute error; MAE is the mean.
</div>

</div></body></html>`;
}
