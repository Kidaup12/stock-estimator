# Implementation Summary — Python Forecast Sidecar

**Date:** 2026-06-05
**Plan:** docs/superpowers/plans/2026-06-05-python-forecast-sidecar.md
**Execution:** subagent-driven (Python) + inline (Next integration, backtest). Local main.

## Built
- **`forecast-sidecar/`** — FastAPI service (statsmodels / xgboost / scikit-learn / pandas). Stateless, history inline, HS256-JWT-authed (`FORECAST_SIDECAR_SECRET`).
  - Regimes (`app/regimes.py`): `classify` → SARIMA `order=(1,1,1) seasonal=(0,1,1,7)` (continuous), Croston/TSB (intermittent), cold-start (sparse). SARIMA falls back to weighted-rate on non-convergence.
  - Calendar layer-2 (`app/calendar_ke.py`, `app/forecast.py`): Kenya payday/holiday/promo multiplier + signals, ported from the TS forecast, deterministic (no RNG noise).
  - `POST /forecast` + `/forecast/batch` + `/health`. **78 pytest tests pass.**
- **Next integration:** `lib/forecast/sidecar-client.ts` (HS256 JWT via Node crypto, batch POST), `lib/forecast/assemble.ts` (sidecar demand → full `ForecastResult` via existing `baseline.ts` inventory math — no formula duplication; 10 vitest tests). `run-batch.ts` routes demand through the sidecar when `USE_SIDECAR=1` + `FORECAST_SIDECAR_URL` set, **falls back to TS on any error**, captures the regime on `Prediction`.
- **Backtest** (`scripts/backtest-forecast.ts`): holdout last 14d, forecast from both on the pre-holdout window, compare MAE/MAPE/bias.

## Backtest verdict (the point of building it before swapping)
Run on the real 65 days (holdout after 2026-05-22), **16 products** had ≥21d usable history:

| Model | MAE | MAPE | bias |
|---|---|---|---|
| TS | **7.88** | 302.5% | +7.88 |
| Sidecar | 9.13 | **277.3%** | **+5.69** |

Sidecar beats TS on 6/16 (38%). **Verdict: no clear win — TS edges MAE; sidecar over-forecasts less (better bias + MAPE).** Both have high MAPE (sparse, spiky, short series). **`USE_SIDECAR` stays 0 — TS remains the production forecast.**

## Why it's not better yet (honest)
- **65 days is too short for SARIMA** — captures weekly (m=7) but not the monthly/annual structure where statistical models win. Needs `read_all_orders` Shopify scope (app review) for a year of history.
- Only 16 SKUs have enough continuous history; the long tail is intermittent (Croston/cold-start) where there's little to beat a weighted rate.
- XGBoost residual pass (plan C2) **skipped** — with 16 eval SKUs it can't move the needle and adds complexity; revisit when data is richer.

## Status
The sidecar is **built, tested, wired, and validated** — ready to flip on the day it proves better. It does NOT yet, so it stays off. No Railway deploy (deferred — needs token + a winning backtest).

## Follow-ups
- Re-run the backtest as real sales accrue (monthly). Flip `USE_SIDECAR=1` if/when the sidecar wins.
- Request Shopify `read_all_orders` → a year of history → re-evaluate SARIMA annual seasonality + train the XGBoost pass.
- Deploy to Railway (needs token) only after a winning backtest.
