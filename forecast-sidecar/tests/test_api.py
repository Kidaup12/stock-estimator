"""
Task A5 — API route tests.

Uses FastAPI TestClient (backed by httpx).

The FORECAST_SIDECAR_SECRET env var is set in os.environ BEFORE any
app imports so that auth.py / make_token share the same secret.
"""

from __future__ import annotations

import os

# Set the secret before any app code is imported so _secret() finds it.
_TEST_SECRET = "test-secret-for-api-tests-only"
os.environ["FORECAST_SIDECAR_SECRET"] = _TEST_SECRET

import pytest
from fastapi.testclient import TestClient

from app.auth import make_token
from app.main import app
from app.schemas import DemandResponse

# ---------------------------------------------------------------------------
# Shared client
# ---------------------------------------------------------------------------

client = TestClient(app)

# ---------------------------------------------------------------------------
# Minimal valid DemandRequest payload
# ---------------------------------------------------------------------------

_HISTORY = [
    {"date": f"2024-01-{d:02d}", "quantity": float(d % 5 + 1)}
    for d in range(1, 32)
]

_PAYLOAD = {
    "productId": "prod-001",
    "history": _HISTORY,
    "productType": "SKINCARE",
    "vendor": "Acme",
    "sku": "SKU-001",
    "abcCategory": "A",
    "runDateKey": "2024-02-01",
    "activePromos": [],
}


# ---------------------------------------------------------------------------
# /health — no auth required
# ---------------------------------------------------------------------------


def test_health_200():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


# ---------------------------------------------------------------------------
# POST /forecast — auth checks
# ---------------------------------------------------------------------------


def test_forecast_no_token_returns_401():
    resp = client.post("/forecast", json=_PAYLOAD)
    assert resp.status_code == 401


def test_forecast_invalid_token_returns_401():
    resp = client.post(
        "/forecast",
        json=_PAYLOAD,
        headers={"Authorization": "Bearer this.is.not.valid"},
    )
    assert resp.status_code == 401


def test_forecast_valid_token_returns_200_and_valid_response():
    token = make_token(_TEST_SECRET)
    resp = client.post(
        "/forecast",
        json=_PAYLOAD,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    # Validate the response against the pydantic schema
    demand = DemandResponse(**body)
    assert demand.finalForecast30d >= 0
    assert 0.3 <= demand.confidence <= 0.95
    assert demand.regime in {"sarima", "croston", "tsb", "cold_start"}
    assert isinstance(demand.signals, list)
    # layer2Adjustment must equal finalForecast30d - layer1Forecast30d (within float epsilon)
    assert abs(demand.layer2Adjustment - (demand.finalForecast30d - demand.layer1Forecast30d)) < 1e-6


# ---------------------------------------------------------------------------
# POST /forecast/batch — two items → results length 2
# ---------------------------------------------------------------------------


def test_forecast_batch_two_items_returns_two_results():
    token = make_token(_TEST_SECRET)
    payload = {
        "items": [
            {**_PAYLOAD, "productId": "prod-001", "sku": "SKU-001"},
            {**_PAYLOAD, "productId": "prod-002", "sku": "SKU-002"},
        ]
    }
    resp = client.post(
        "/forecast/batch",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "results" in body
    assert len(body["results"]) == 2
    # Each result must be a valid DemandResponse
    for item in body["results"]:
        d = DemandResponse(**item)
        assert d.finalForecast30d >= 0


def test_forecast_batch_no_token_returns_401():
    payload = {"items": [_PAYLOAD]}
    resp = client.post("/forecast/batch", json=payload)
    assert resp.status_code == 401
