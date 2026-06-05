"""
Task A5 — FastAPI application entry point.

Routes
------
GET  /health          No auth.  Returns {"ok": true}.
POST /forecast        Auth required (JWT Bearer).  Single-product demand forecast.
POST /forecast/batch  Auth required (JWT Bearer).  Batch demand forecast.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI

from app.auth import verify_jwt
from app.forecast import forecast_demand
from app.schemas import BatchRequest, BatchResponse, DemandRequest, DemandResponse

app = FastAPI(
    title="Wezesha Forecast Sidecar",
    description="Stateless demand-forecast service (SARIMA / Croston-TSB / cold-start).",
    version="0.1.0",
)


# ---------------------------------------------------------------------------
# Health — no authentication
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict:
    """Liveness probe.  No auth required."""
    return {"ok": True}


# ---------------------------------------------------------------------------
# Single-product forecast
# ---------------------------------------------------------------------------


@app.post("/forecast", response_model=DemandResponse)
def forecast(
    req: DemandRequest,
    _token: dict = Depends(verify_jwt),
) -> DemandResponse:
    """
    Compute a demand forecast for a single product.

    Requires a valid HS256 Bearer JWT signed with FORECAST_SIDECAR_SECRET.
    Returns a DemandResponse (demand-only; Next handles inventory math).
    """
    return forecast_demand(req)


# ---------------------------------------------------------------------------
# Batch forecast
# ---------------------------------------------------------------------------


@app.post("/forecast/batch", response_model=BatchResponse)
def forecast_batch(
    req: BatchRequest,
    _token: dict = Depends(verify_jwt),
) -> BatchResponse:
    """
    Compute demand forecasts for multiple products in a single call.

    Requires a valid HS256 Bearer JWT signed with FORECAST_SIDECAR_SECRET.
    Results are returned in the same order as the input items.
    """
    results = [forecast_demand(item) for item in req.items]
    return BatchResponse(results=results)
