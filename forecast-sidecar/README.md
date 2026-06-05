# Forecast Sidecar

Python FastAPI service that returns **demand forecasts only** for Wezesha Restock OS.  
Next.js computes inventory math (safety stock, reorder point, urgency) using `lib/forecast/baseline.ts`.

## Architecture

- **SARIMA** (statsmodels SARIMAX, weekly period m=7) for continuous products
- **Croston/TSB** for intermittent/slow-moving products
- **Cold-start** mean-rate fallback for < 14 days of history
- **XGBoost residual correction** hook (evaluated in backtest; bundled only if it lowers holdout error)
- **JWT auth** (HS256, signed by Next, verified here)
- **Stateless** — full sales history sent inline on every request

## Limitations

- **65 days of data** → SARIMA at weekly period (m=7) only; **no annual seasonality**.  
  Annual seasonality requires `read_all_orders` Shopify scope + ≥ 1 year of data.

## Setup (Windows)

```bash
cd forecast-sidecar
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

## Run

```bash
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

## Tests

```bash
.venv\Scripts\python -m pytest
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `FORECAST_SIDECAR_SECRET` | Yes | HS256 shared secret (same value in Next `FORECAST_SIDECAR_SECRET`) |

## API

### `POST /forecast`

Request body: `DemandRequest` (see `app/schemas.py`).  
Returns: `DemandResponse`.  
Requires `Authorization: Bearer <jwt>`.

### `POST /forecast/batch`

Body: `{ "items": [<DemandRequest>...] }`  
Returns: `{ "results": [<DemandResponse>...] }`

### `GET /health`

Returns `{ "ok": true }`. No auth required.
