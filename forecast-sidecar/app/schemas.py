"""
Pydantic v2 models matching the forecast-sidecar Contract.

Contract (the seam):
  Input  → DemandRequest  (POST /forecast body)
  Output → DemandResponse (POST /forecast result)
  Batch  → BatchRequest / BatchResponse
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------


class SalesPoint(BaseModel):
    """One day of sales history."""

    date: str = Field(..., description="ISO date YYYY-MM-DD")
    quantity: float


class Signal(BaseModel):
    """A named Layer-2 signal that contributed to the final forecast."""

    label: str
    deltaPct: float
    emoji: str


class ActivePromo(BaseModel):
    """A promotion active (or overlapping) with the forecast window."""

    discountPct: float
    promoType: str
    channel: str
    scope: str
    scopeValue: str


# ---------------------------------------------------------------------------
# Request / Response
# ---------------------------------------------------------------------------


class DemandRequest(BaseModel):
    """Full input for a single product demand forecast."""

    productId: str
    history: list[SalesPoint]
    productType: Optional[str] = None
    vendor: Optional[str] = None
    sku: str
    abcCategory: Optional[Literal["A", "B", "C"]] = None
    runDateKey: str = Field(..., description="ISO date YYYY-MM-DD — the forecast reference date")
    activePromos: list[ActivePromo] = Field(default_factory=list)


class DemandResponse(BaseModel):
    """Demand-only forecast output.  Next computes inventory math from these fields."""

    layer1Forecast30d: float
    layer1Confidence: float
    layer2Adjustment: float
    finalForecast30d: float
    confidence: float
    reasoning: str
    signals: list[Signal]
    regime: Literal["sarima", "croston", "tsb", "cold_start"]


# ---------------------------------------------------------------------------
# Batch wrappers
# ---------------------------------------------------------------------------


class BatchRequest(BaseModel):
    items: list[DemandRequest]


class BatchResponse(BaseModel):
    results: list[DemandResponse]
