# Python Forecast Sidecar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A Python FastAPI forecast service (SARIMA + Croston/TSB + cold-start + XGBoost-adjustment) that returns the *demand* portion of the forecast; Next keeps the inventory math (King's safety stock / reorder / urgency). Backtest it on the real 65 days vs the current TS forecast before any swap.

**Architecture:** New `forecast-sidecar/` Python service (statsmodels, xgboost, scikit-learn, FastAPI), stateless, JWT-authed, history sent inline. Next gains a `sidecar-client` + a branch in the forecast batch: when `USE_SIDECAR=1` + `FORECAST_SIDECAR_URL` set, call the sidecar for demand, then assemble the full `ForecastResult` via the existing `baseline.ts` formulas. TS stays the default. A backtest harness holds out the last 14 of 65 days and compares MAE/MAPE.

**Tech Stack:** Python 3.11 / FastAPI / uvicorn / statsmodels / xgboost / scikit-learn / pydantic / PyJWT; TS side Next 16 + vitest.

## Locked decisions
- **Sidecar returns DEMAND only**: `{ layer1Forecast30d, layer1Confidence, layer2Adjustment, finalForecast30d, confidence, reasoning, signals[] }`. Next computes `safetyStock, reorderPoint, daysUntilStockout, recommendedQty, urgency` via `lib/forecast/baseline.ts` (no formula duplication).
- **Backtest locally first** — no Railway deploy until it beats TS. No Railway token needed for this plan.
- **65 days of real data** → SARIMA at weekly period (m=7) only; no annual seasonality (needs `read_all_orders` scope + time). Document this limit.
- Auth: HS256 JWT signed by Next with `FORECAST_SIDECAR_SECRET`, verified by the sidecar (`exp` checked). Stateless; history inline; no DB in the sidecar.
- TS forecast (`simulateLayeredForecast`) stays the production default behind the flag.

## Contract (the seam)
Input (POST `/forecast`, JSON):
```
{ "productId": str, "history": [{"date":"YYYY-MM-DD","quantity":number}], "productType": str|null,
  "vendor": str|null, "sku": str, "abcCategory": "A"|"B"|"C"|null, "runDateKey": "YYYY-MM-DD",
  "activePromos": [{discountPct,promoType,channel,scope,scopeValue}] }
```
Output:
```
{ "layer1Forecast30d": number, "layer1Confidence": number, "layer2Adjustment": number,
  "finalForecast30d": number, "confidence": number, "reasoning": str,
  "signals": [{"label":str,"deltaPct":number,"emoji":str}], "regime": "sarima"|"croston"|"tsb"|"cold_start" }
```
`/forecast/batch` accepts `{ "items": [<input>...] }` → `{ "results": [<output>...] }`.

## File Structure
**Python (`forecast-sidecar/`)**
- `requirements.txt`, `README.md`, `.gitignore`, `railway.json` (deploy config, dormant).
- `app/main.py` — FastAPI app, routes, JWT dependency.
- `app/auth.py` — `verify_jwt(token)` (HS256, `FORECAST_SIDECAR_SECRET`, exp).
- `app/schemas.py` — pydantic models (DemandRequest, DemandResponse, Signal, BatchRequest).
- `app/calendar_ke.py` — Kenya payday/holiday signals (port of `lib/seed/kenya-calendar.ts`).
- `app/regimes.py` — `classify()`, `sarima_30d()`, `croston_tsb_30d()`, `cold_start_30d()`.
- `app/forecast.py` — `forecast_demand(req) -> DemandResponse` (regime → layer1, calendar → layer2, assemble).
- `tests/test_regimes.py`, `tests/test_forecast.py`, `tests/test_calendar.py` — pytest.

**TS (Next side)**
- `lib/forecast/sidecar-client.ts` — `forecastDemandViaSidecar(inputs[]) -> DemandForecast[]` (JWT, batch POST).
- `lib/forecast/assemble.ts` — `assembleForecastResult(input, demand) -> ForecastResult` (applies baseline.ts inventory math to the sidecar's `finalForecast30d`).
- `lib/forecast/assemble.test.ts` — unit tests (inventory math from a fixed demand).
- Modify `lib/forecast/run-batch.ts` — branch: `USE_SIDECAR` → sidecar+assemble, else `simulateLayeredForecast`.
- `scripts/backtest-forecast.ts` — pull real history, holdout 14d, compare TS vs sidecar MAE/MAPE, print report.
- `.env` — add `USE_SIDECAR=0`, `FORECAST_SIDECAR_URL=http://127.0.0.1:8000` (local), `FORECAST_SIDECAR_SECRET` (generate).

## Environment rules
- Python: `cd forecast-sidecar && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt` (Windows venv path). Run: `.venv/Scripts/python -m uvicorn app.main:app --port 8000`. Tests: `.venv/Scripts/python -m pytest`.
- TS DB scripts: dev server stopped (pooler cap).
- Branch `main`; one commit per task; trailer EXACTLY: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

# PART A — Python sidecar

### Task A1: Scaffold + deps + auth + schemas
**Files:** `forecast-sidecar/{requirements.txt,.gitignore,README.md}`, `app/__init__.py`, `app/auth.py`, `app/schemas.py`

- [ ] **Step 1: requirements.txt**
```
fastapi==0.115.*
uvicorn[standard]==0.32.*
statsmodels==0.14.*
xgboost==2.1.*
scikit-learn==1.5.*
pandas==2.2.*
numpy==2.1.*
pydantic==2.9.*
PyJWT==2.9.*
pytest==8.3.*
httpx==0.27.*
```
- [ ] **Step 2: `.gitignore`** — `.venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`.
- [ ] **Step 3: `app/schemas.py`** — pydantic v2 models matching the Contract above: `SalesPoint(date:str, quantity:float)`, `Signal(label:str, deltaPct:float, emoji:str)`, `ActivePromo(...)`, `DemandRequest(...)`, `DemandResponse(...)`, `BatchRequest(items:list[DemandRequest])`, `BatchResponse(results:list[DemandResponse])`.
- [ ] **Step 4: `app/auth.py`** — `verify_jwt(authorization: str) -> None`: expect `Bearer <jwt>`, decode HS256 with `os.environ["FORECAST_SIDECAR_SECRET"]`, verify `exp`; raise `HTTPException(401)` on failure. Include `make_token()` helper for tests.
- [ ] **Step 5: venv + install + import smoke**
Run: `cd forecast-sidecar && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -c "import fastapi,statsmodels,xgboost,sklearn,jwt,pandas; print('deps ok')"`
Expected: `deps ok`.
- [ ] **Step 6: Commit** (`forecast-sidecar/` scaffold).

### Task A2: Kenya calendar port (TDD)
**Files:** `app/calendar_ke.py`, `tests/test_calendar.py`
Port `lib/seed/kenya-calendar.ts`: `is_payday_week(d)`, `payday_boost(d)`, `holiday_boost(d, product_type) -> (boost,name)`, `lookahead_holiday_boost(product_type, today, days=30)`, `lookahead_paydays(today, days=30)`. 
- [ ] Write `tests/test_calendar.py` first (payday days 13–16 & 25–end true; a known holiday boosts; non-holiday → 1.0). Run → fail.
- [ ] Implement `app/calendar_ke.py` (read the TS file for exact dates/multipliers; replicate). Run → pass.
- [ ] Commit.

### Task A3: Regimes (TDD)
**Files:** `app/regimes.py`, `tests/test_regimes.py`
- [ ] **Step 1: tests first** (`tests/test_regimes.py`):
  - `classify`: <14 non-null days → "cold_start"; ≥50% zero-demand days → "intermittent"; else "continuous".
  - `croston_tsb_30d`: intermittent series (e.g. demand every ~5 days) → positive 30d total ≈ rate×30, no crash.
  - `cold_start_30d`: short series → mean-rate×30 ≥ 0.
  - `sarima_30d`: a clean weekly-seasonal series → positive 30d total, no exception (fallback to weighted-rate×30 if SARIMAX fails to converge).
  Run → fail.
- [ ] **Step 2: implement `app/regimes.py`**:
  - `_to_daily_series(history, today)`: build a pandas daily series (fill missing days with 0) up to `today`.
  - `classify(series) -> str`.
  - `sarima_30d(series) -> float`: `statsmodels.tsa.statespace.SARIMAX(series, order=(1,1,1), seasonal_order=(0,1,1,7))`, `.fit(disp=False)`, forecast 30 steps, sum, clamp ≥0. Wrap in try/except → on failure return `weighted_rate(series)*30`.
  - `croston_tsb_30d(series) -> float`: TSB (Teunter-Syntetos-Babai) smoothing of demand size + probability → daily rate × 30.
  - `cold_start_30d(series) -> float`: mean of non-zero demand × 30, or overall mean×30 if all sparse.
  - `weighted_rate(series)`: recency-weighted daily mean (mirror `baseline.ts weightedDailyRate`).
  Run → pass.
- [ ] Commit.

### Task A4: Forecast orchestration + layer2 (TDD)
**Files:** `app/forecast.py`, `tests/test_forecast.py`
- [ ] **Step 1: tests first**: `forecast_demand(req)` returns a `DemandResponse` with: `finalForecast30d >= 0`; `layer2Adjustment == finalForecast30d - layer1Forecast30d` (within float epsilon); `regime` set; deterministic (same input → same output, no RNG); signals populated when a promo/holiday/payday applies; `confidence` in [0.3, 0.95].
- [ ] **Step 2: implement `app/forecast.py`**:
  - `layer1 = regime forecast` (route via `classify`).
  - `layer1Confidence`: from coefficient-of-variation of last-90 (mirror TS: `max(0.3, min(0.95, 0.9 - cv*0.3))`).
  - **layer2 multiplier** = `holiday_lookahead * payday_lookahead * promo_lift` (port the exact TS formulas from `simulate-layers.ts` lines 155–181, MINUS the random noise — the sidecar is deterministic). Build `signals[]` identically.
  - `finalForecast30d = max(0, layer1 * layer2_mult)`; `layer2Adjustment = finalForecast30d - layer1`.
  - `reasoning`: 2–3 sentences naming the regime + the layer2 signal contributions + confidence.
  - **XGBoost note:** v1 layer2 = the deterministic calendar model above (matches the TS layer2 intent and is honest on 65d). The XGBoost residual-correction model is trained + evaluated in the backtest (Task C2); bundle it ONLY if it lowers holdout error. Leave a `_xgb_adjust(features)` hook returning 1.0 when no model is present.
  Run → pass.
- [ ] Commit.

### Task A5: FastAPI app + routes
**Files:** `app/main.py`, `tests/test_api.py`
- [ ] `app/main.py`: FastAPI; `POST /forecast` (auth dep → `forecast_demand`) and `POST /forecast/batch` (map over items); `GET /health` → `{"ok":true}` (no auth).
- [ ] `tests/test_api.py` (httpx TestClient): `/health` 200; `/forecast` without token → 401; with valid token (`make_token`) → 200 + valid `DemandResponse`; batch → results length matches.
- [ ] Run `.venv/Scripts/python -m pytest` → all pass.
- [ ] Commit.

---

# PART B — Next integration

### Task B1: sidecar client + assemble (TDD on assemble)
**Files:** `lib/forecast/sidecar-client.ts`, `lib/forecast/assemble.ts`, `lib/forecast/assemble.test.ts`
- [ ] **assemble.ts**: `assembleForecastResult(input: ForecastInput, demand: DemandForecast): ForecastResult` — take the sidecar's demand fields, compute `dailyRate` (from `input.history` via a small recency-weighted mean OR `finalForecast30d/30`), `safetyStock` (kingsSafetyStock with z from abc), `reorderPoint`, `daysUntilStockout` (currentStock/dailyRate), `recommendedQty = max(0, ceil(finalForecast30d + safety - currentStock))`, `urgency` (urgencyFromDays) — REUSING `lib/forecast/baseline.ts`. Assemble the full `ForecastResult`.
- [ ] **assemble.test.ts**: given a fixed `DemandForecast` (final=120, etc.) + input (currentStock=30, lead 30±7, abc "A"), assert `recommendedQty`, `safetyStock>0`, `urgency` match the baseline formulas. (Pure, no network.)
- [ ] **sidecar-client.ts**: `forecastDemandViaSidecar(inputs: ForecastInput[]): Promise<DemandForecast[]>` — sign an HS256 JWT (`jsonwebtoken` or a tiny HS256 via `crypto`) with `FORECAST_SIDECAR_SECRET` (exp +5min), POST `${FORECAST_SIDECAR_URL}/forecast/batch`, map `history` dates to `YYYY-MM-DD`. Throw on non-200.
- [ ] tsc + lint + `npx vitest run lib/forecast/assemble.test.ts` green. Commit.
> Note: add `jsonwebtoken` dep if not present (`npm i jsonwebtoken @types/jsonwebtoken`), or implement HS256 with Node `crypto` to avoid the dep — prefer crypto (no new dep).

### Task B2: Branch run-batch behind USE_SIDECAR
**Files:** `lib/forecast/run-batch.ts`, `.env`
- [ ] In `runForecastsForTenant`, before the per-product loop: if `process.env.USE_SIDECAR === "1" && process.env.FORECAST_SIDECAR_URL`, batch-call `forecastDemandViaSidecar` for all products, then per product use `assembleForecastResult(input, demand)` instead of `simulateLayeredForecast(input)`. On ANY sidecar error, log + fall back to `simulateLayeredForecast` (never break the run). Keep prediction-write + Order-create identical.
- [ ] `.env`: add `USE_SIDECAR=0`, `FORECAST_SIDECAR_URL=http://127.0.0.1:8000`, `FORECAST_SIDECAR_SECRET=<node crypto 32-byte hex>`.
- [ ] tsc + lint green. Commit.

---

# PART C — Backtest + verdict

### Task C1: Backtest harness
**Files:** `scripts/backtest-forecast.ts`
- [ ] Pull real per-product daily history (channel "shopify") for the tenant. For products with ≥21 days of history: split at `maxDate - 14d`; **train window** = up to split, **holdout** = last 14d actuals (summed). Forecast the 14d horizon two ways: (a) TS `simulateLayeredForecast` on the train window (scale 30d→14d), (b) sidecar `/forecast` on the train window. Compute per-product absolute error vs holdout actual; aggregate **MAE + MAPE + bias** per method. Print a table: products evaluated, TS MAE/MAPE, sidecar MAE/MAPE, win/loss.
- [ ] Requires the sidecar running locally (`uvicorn ... --port 8000`) + `USE_SIDECAR` not needed (script calls client directly). Document the run order in the script header.
- [ ] Commit.

### Task C2: Run backtest + XGBoost evaluation + verdict
**Files:** none (analysis) + optional `forecast-sidecar/app/model.pkl`
- [ ] Start the sidecar locally. Run `npx tsx scripts/backtest-forecast.ts` (dev server stopped). Record the MAE/MAPE comparison.
- [ ] **XGBoost pass:** in the sidecar, train a pooled `XGBRegressor` on (calendar features + abc + recent-rate) → next-period demand using the train windows; re-run the backtest with `_xgb_adjust` active. Keep XGBoost ONLY if holdout MAE improves; else leave the deterministic layer2 and note XGBoost didn't help on 65d.
- [ ] Write `docs/superpowers/plans/2026-06-05-python-forecast-sidecar-SUMMARY.md`: the backtest numbers (TS vs sidecar vs sidecar+XGB), the verdict (swap or not), the 65d/annual-seasonality caveat, and the deploy-to-Railway next step (needs token). Update `.planning/STATE.md`.
- [ ] If sidecar wins: leave `USE_SIDECAR=0` in committed `.env.example`/docs but recommend flipping after Railway deploy. Do NOT flip prod default in this plan (deploy is a separate step).

## Self-Review (author checklist — completed)
- **Spec coverage:** 4 regimes (A3) + calendar layer2 (A2/A4) + XGBoost eval (C2); demand-only contract (A4 schema) with TS inventory math reused (B1 assemble); JWT auth (A4/A1, B1 signs); stateless+inline (schemas); flag + fallback (B2); local backtest vs TS (C1/C2); 65d/annual caveat documented (locked decisions + C2 summary).
- **Type consistency:** `DemandResponse` (py) == `DemandForecast` (ts) fields; `assembleForecastResult` returns the exact `ForecastResult` from `simulate-layers.ts`; `baseline.ts` helpers reused (kingsSafetyStock/reorderPoint/urgencyFromDays/zForServiceLevel).
- **Placeholders:** regime internals reference standard algorithms (SARIMAX params given, TSB named) rather than full derivations — acceptable since they're library calls; I/O contract + structure + tests are exact.
- **No-drift:** inventory formulas live ONLY in `baseline.ts` (TS); the sidecar never computes safety/reorder.

## Deferred
- Railway deploy (needs token) — separate step after backtest validates.
- Annual seasonality — needs `read_all_orders` Shopify scope + a year of data.
- Flipping `USE_SIDECAR=1` in production — only after deploy + validation.
