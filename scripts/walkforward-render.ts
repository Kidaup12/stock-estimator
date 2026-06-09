/**
 * Regenerate the HTML report from existing wf-base.json (+ wf-xgb.json if present)
 * without re-running the DB/sidecar backtest. Useful when the DB link is flaky or
 * when only the report template changed.
 *
 *   npx tsx scripts/walkforward-render.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { renderReport } from "./walkforward-report";

const OUT = join(__dirname, "out");
const DOCS = join(__dirname, "..", "docs", "superpowers");
const REPORT = join(DOCS, "forecast-backtest-report-2026-06-09.html");

const base = JSON.parse(readFileSync(join(OUT, "wf-base.json"), "utf8"));
const xp = join(OUT, "wf-xgb.json");
const xgb = existsSync(xp) ? JSON.parse(readFileSync(xp, "utf8")) : null;

if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });
writeFileSync(REPORT, renderReport(base, xgb));
console.log(`Wrote ${REPORT} ${xgb ? "(with XGBoost column)" : "(base only)"}`);
