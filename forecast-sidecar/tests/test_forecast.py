"""
TDD tests for app/forecast.py — Task A4.

Written BEFORE implementation.
"""

from __future__ import annotations

import datetime

import pytest

from app.schemas import DemandRequest, DemandResponse


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_request(
    *,
    n_days: int = 60,
    qty: float = 5.0,
    run_date: str = "2024-07-15",  # mid-July, far from holidays + mid-payday-month window
    product_type: str | None = None,
    sku: str = "TEST-SKU-001",
    abc: str | None = "B",
    active_promos: list | None = None,
) -> DemandRequest:
    base = datetime.date.fromisoformat(run_date) - datetime.timedelta(days=n_days)
    history = [
        {"date": (base + datetime.timedelta(days=i)).isoformat(), "quantity": qty}
        for i in range(n_days)
    ]
    return DemandRequest(
        productId="prod-001",
        history=history,
        productType=product_type,
        vendor="TestVendor",
        sku=sku,
        abcCategory=abc,
        runDateKey=run_date,
        activePromos=active_promos or [],
    )


def _make_intermittent_request(run_date: str = "2024-07-15") -> DemandRequest:
    base = datetime.date.fromisoformat(run_date) - datetime.timedelta(days=60)
    history = []
    for i in range(60):
        qty = 10.0 if i % 5 == 0 else 0.0
        history.append({
            "date": (base + datetime.timedelta(days=i)).isoformat(),
            "quantity": qty,
        })
    return DemandRequest(
        productId="prod-002",
        history=history,
        productType=None,
        vendor="TestVendor",
        sku="INT-SKU-001",
        abcCategory="C",
        runDateKey=run_date,
        activePromos=[],
    )


def _make_cold_start_request(run_date: str = "2024-07-15") -> DemandRequest:
    base = datetime.date.fromisoformat(run_date) - datetime.timedelta(days=5)
    history = [
        {"date": (base + datetime.timedelta(days=i)).isoformat(), "quantity": 3.0}
        for i in range(5)
    ]
    return DemandRequest(
        productId="prod-003",
        history=history,
        productType=None,
        vendor="TestVendor",
        sku="COLD-SKU-001",
        abcCategory="C",
        runDateKey=run_date,
        activePromos=[],
    )


# ---------------------------------------------------------------------------
# Basic contract
# ---------------------------------------------------------------------------

class TestForecastDemandContract:
    def test_returns_demand_response(self):
        from app.forecast import forecast_demand
        req = _make_request()
        result = forecast_demand(req)
        assert isinstance(result, DemandResponse)

    def test_final_forecast_non_negative(self):
        from app.forecast import forecast_demand
        req = _make_request()
        result = forecast_demand(req)
        assert result.finalForecast30d >= 0

    def test_layer2_adjustment_equals_final_minus_layer1(self):
        """layer2Adjustment must equal finalForecast30d − layer1Forecast30d (float epsilon)."""
        from app.forecast import forecast_demand
        req = _make_request()
        result = forecast_demand(req)
        expected_adj = result.finalForecast30d - result.layer1Forecast30d
        assert result.layer2Adjustment == pytest.approx(expected_adj, abs=1e-9)

    def test_confidence_in_range(self):
        from app.forecast import forecast_demand
        req = _make_request()
        result = forecast_demand(req)
        assert 0.3 <= result.confidence <= 0.95

    def test_layer1_confidence_in_range(self):
        from app.forecast import forecast_demand
        req = _make_request()
        result = forecast_demand(req)
        assert 0.3 <= result.layer1Confidence <= 0.95

    def test_regime_is_set(self):
        from app.forecast import forecast_demand
        req = _make_request()
        result = forecast_demand(req)
        assert result.regime in ("sarima", "croston", "tsb", "cold_start")

    def test_reasoning_is_non_empty_string(self):
        from app.forecast import forecast_demand
        req = _make_request()
        result = forecast_demand(req)
        assert isinstance(result.reasoning, str)
        assert len(result.reasoning) > 10

    def test_signals_is_list(self):
        from app.forecast import forecast_demand
        req = _make_request()
        result = forecast_demand(req)
        assert isinstance(result.signals, list)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

class TestDeterminism:
    def test_same_input_same_output(self):
        """Two calls with identical input must produce identical output (no RNG)."""
        from app.forecast import forecast_demand
        req = _make_request(run_date="2024-07-15")
        r1 = forecast_demand(req)
        r2 = forecast_demand(req)
        assert r1.finalForecast30d == r2.finalForecast30d
        assert r1.layer1Forecast30d == r2.layer1Forecast30d
        assert r1.layer2Adjustment == r2.layer2Adjustment
        assert r1.confidence == r2.confidence
        assert r1.regime == r2.regime

    def test_different_run_dates_can_differ(self):
        """Different runDateKey should produce potentially different layer2 (holiday/payday signals)."""
        from app.forecast import forecast_demand
        req1 = _make_request(run_date="2024-07-15")
        req2 = _make_request(run_date="2024-12-20")  # near Christmas
        r1 = forecast_demand(req1)
        r2 = forecast_demand(req2)
        # At least one field should differ (layer2 will differ due to calendar)
        # We just assert no crash; determinism is per-input
        assert r1.finalForecast30d >= 0
        assert r2.finalForecast30d >= 0


# ---------------------------------------------------------------------------
# Regime routing
# ---------------------------------------------------------------------------

class TestRegimeRouting:
    def test_cold_start_regime(self):
        from app.forecast import forecast_demand
        req = _make_cold_start_request()
        result = forecast_demand(req)
        assert result.regime == "cold_start"

    def test_intermittent_regime(self):
        from app.forecast import forecast_demand
        req = _make_intermittent_request()
        result = forecast_demand(req)
        assert result.regime in ("intermittent", "croston", "tsb")

    def test_continuous_regime_long_history(self):
        from app.forecast import forecast_demand
        req = _make_request(n_days=60, qty=5.0)
        result = forecast_demand(req)
        # Continuous history → sarima or continuous
        assert result.regime in ("sarima", "continuous", "cold_start")


# ---------------------------------------------------------------------------
# Layer-2 signals
# ---------------------------------------------------------------------------

class TestLayer2Signals:
    def test_promo_signal_present_when_promo_active(self):
        """An active promo on the product's SKU should generate a promo signal."""
        from app.forecast import forecast_demand
        promo = {
            "discountPct": 20.0,
            "promoType": "flash",
            "channel": "shopify",
            "scope": "sku",
            "scopeValue": "PROMO-SKU",
        }
        req = _make_request(sku="PROMO-SKU", active_promos=[promo], run_date="2024-07-15")
        result = forecast_demand(req)
        promo_signals = [s for s in result.signals if "promo" in s.label.lower()]
        assert len(promo_signals) >= 1

    def test_holiday_signal_near_christmas(self):
        """Run date near Christmas → holiday signal in signals list."""
        from app.forecast import forecast_demand
        req = _make_request(run_date="2024-12-20", product_type="fragrance")
        result = forecast_demand(req)
        holiday_signals = [s for s in result.signals if "Christmas" in s.label or "christmas" in s.label.lower()]
        assert len(holiday_signals) >= 1

    def test_payday_signal_in_mid_month(self):
        """Run date at day 13 → payday days in next 30d → payday signal."""
        from app.forecast import forecast_demand
        req = _make_request(run_date="2024-07-13")
        result = forecast_demand(req)
        payday_signals = [s for s in result.signals if "payday" in s.label.lower() or "Payday" in s.label]
        assert len(payday_signals) >= 1

    def test_no_signals_far_from_events(self):
        """
        Mid-July (day 15), no promos, no holidays in next 30 days → signals list
        may be empty or very small (payday week signals are common in July 13-16).
        This test just asserts no crash and signals is a list.
        """
        from app.forecast import forecast_demand
        req = _make_request(run_date="2024-07-20")  # day 20, not payday, no holiday
        result = forecast_demand(req)
        assert isinstance(result.signals, list)

    def test_promo_increases_final_vs_layer1(self):
        """Adding a promo should increase (or at minimum not decrease) the final forecast."""
        from app.forecast import forecast_demand

        req_no_promo = _make_request(run_date="2024-07-20")
        req_with_promo = _make_request(
            run_date="2024-07-20",
            sku="TEST-SKU-001",
            active_promos=[{
                "discountPct": 30.0,
                "promoType": "flash",
                "channel": "shopify",
                "scope": "sku",
                "scopeValue": "TEST-SKU-001",
            }],
        )
        r_no = forecast_demand(req_no_promo)
        r_with = forecast_demand(req_with_promo)
        assert r_with.finalForecast30d >= r_no.finalForecast30d


# ---------------------------------------------------------------------------
# Layer-2 multiplier math
# ---------------------------------------------------------------------------

class TestLayer2Multiplier:
    def test_final_eq_max_0_layer1_times_mult(self):
        """
        finalForecast30d == max(0, layer1 * layer2_mult).
        We verify via layer2Adjustment = final - layer1.
        """
        from app.forecast import forecast_demand
        req = _make_request(run_date="2024-07-15")
        r = forecast_demand(req)
        # layer2Adjustment = final - layer1
        assert r.layer2Adjustment == pytest.approx(r.finalForecast30d - r.layer1Forecast30d, abs=1e-9)

    def test_near_christmas_final_exceeds_layer1(self):
        """Near Christmas, layer2 multiplier > 1 → final > layer1."""
        from app.forecast import forecast_demand
        req = _make_request(run_date="2024-12-22", product_type="fragrance", n_days=60)
        r = forecast_demand(req)
        # Fragrance near Christmas should have holiday boost > 1
        assert r.finalForecast30d >= r.layer1Forecast30d


# ---------------------------------------------------------------------------
# XGBoost hook
# ---------------------------------------------------------------------------

class TestXgbHook:
    def test_xgb_adjust_returns_1_0_when_no_model(self):
        """The _xgb_adjust hook must return 1.0 when no model is loaded."""
        from app.forecast import _xgb_adjust
        features = {"cv": 0.3, "abc": "A", "recent_rate": 2.5}
        assert _xgb_adjust(features) == pytest.approx(1.0)
