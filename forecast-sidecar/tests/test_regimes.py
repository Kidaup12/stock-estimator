"""
TDD tests for app/regimes.py — Task A3.

Written BEFORE implementation.
"""

from __future__ import annotations

import datetime

import pytest


# ---------------------------------------------------------------------------
# Helpers to build SalesPoint-like dicts
# ---------------------------------------------------------------------------

def make_history(n: int, qty: float = 5.0, start: str = "2024-01-01") -> list[dict]:
    """Generate n consecutive daily sales points starting from *start*."""
    base = datetime.date.fromisoformat(start)
    return [{"date": (base + datetime.timedelta(days=i)).isoformat(), "quantity": qty} for i in range(n)]


def make_intermittent(n: int, every: int = 5, qty: float = 10.0, start: str = "2024-01-01") -> list[dict]:
    """Sales only every *every* days, zeros otherwise."""
    base = datetime.date.fromisoformat(start)
    return [
        {"date": (base + datetime.timedelta(days=i)).isoformat(),
         "quantity": qty if i % every == 0 else 0.0}
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# classify
# ---------------------------------------------------------------------------

class TestClassify:
    def test_short_history_is_cold_start(self):
        """< 14 non-null data points → cold_start."""
        from app.regimes import classify
        hist = make_history(10)
        today = datetime.date(2024, 1, 11)
        assert classify(hist, today) == "cold_start"

    def test_exactly_14_is_not_cold_start(self):
        """Exactly 14 days → NOT cold_start (≥14)."""
        from app.regimes import classify
        hist = make_history(14)
        today = datetime.date(2024, 1, 15)
        result = classify(hist, today)
        assert result != "cold_start"

    def test_intermittent_50_percent_zeros(self):
        """≥ 50% zero-demand days → intermittent."""
        from app.regimes import classify
        # 30 points, half zero (every 2nd day)
        base = datetime.date(2024, 1, 1)
        hist = [
            {"date": (base + datetime.timedelta(days=i)).isoformat(),
             "quantity": 5.0 if i % 2 == 0 else 0.0}
            for i in range(30)
        ]
        today = datetime.date(2024, 1, 31)
        assert classify(hist, today) == "intermittent"

    def test_continuous_is_continuous(self):
        """Mostly non-zero history → continuous."""
        from app.regimes import classify
        hist = make_history(60, qty=3.0)
        today = datetime.date(2024, 3, 1)
        assert classify(hist, today) == "continuous"

    def test_sparse_but_long_enough_is_intermittent(self):
        """30-day history with every 5th day having demand → >50% zeros → intermittent."""
        from app.regimes import classify
        hist = make_intermittent(30, every=5)
        today = datetime.date(2024, 1, 31)
        assert classify(hist, today) == "intermittent"


# ---------------------------------------------------------------------------
# weighted_rate
# ---------------------------------------------------------------------------

class TestWeightedRate:
    def test_empty_returns_zero(self):
        from app.regimes import weighted_rate
        import pandas as pd
        s = pd.Series([], dtype=float)
        s.index = pd.DatetimeIndex([])
        assert weighted_rate(s) == pytest.approx(0.0)

    def test_uniform_series_returns_that_rate(self):
        """
        Uniform 2 units/day → weighted_rate ≈ 2.0.

        Allow 5% tolerance: the >=since boundary can include 1 extra day per
        window (e.g. 31 days instead of 30), matching the TS >= filter exactly.
        This is correct behaviour — not a bug.
        """
        from app.regimes import weighted_rate
        import pandas as pd
        today = datetime.date(2024, 4, 10)
        idx = pd.date_range(end=pd.Timestamp(today), periods=365, freq="D")
        s = pd.Series(2.0, index=idx)
        rate = weighted_rate(s, asof=today)
        assert rate == pytest.approx(2.0, rel=0.05)


# ---------------------------------------------------------------------------
# cold_start_30d
# ---------------------------------------------------------------------------

class TestColdStart30d:
    def test_short_series_returns_non_negative(self):
        from app.regimes import cold_start_30d
        hist = make_history(5, qty=3.0)
        today = datetime.date(2024, 1, 6)
        result = cold_start_30d(hist, today)
        assert result >= 0

    def test_short_series_approx_mean_times_30(self):
        """Mean daily = 3.0 → cold_start_30d ≈ 90."""
        from app.regimes import cold_start_30d
        hist = make_history(5, qty=3.0)
        today = datetime.date(2024, 1, 6)
        result = cold_start_30d(hist, today)
        assert result == pytest.approx(90.0, rel=0.01)

    def test_all_zeros_returns_zero(self):
        from app.regimes import cold_start_30d
        hist = make_history(5, qty=0.0)
        today = datetime.date(2024, 1, 6)
        result = cold_start_30d(hist, today)
        assert result == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# croston_tsb_30d
# ---------------------------------------------------------------------------

class TestCrostonTsb30d:
    def test_positive_for_intermittent_series(self):
        """Demand every 5 days → positive 30-day total."""
        from app.regimes import croston_tsb_30d
        hist = make_intermittent(60, every=5, qty=10.0)
        today = datetime.date(2024, 3, 1)
        result = croston_tsb_30d(hist, today)
        assert result > 0

    def test_no_crash_on_all_zeros(self):
        from app.regimes import croston_tsb_30d
        hist = make_history(30, qty=0.0)
        today = datetime.date(2024, 1, 31)
        result = croston_tsb_30d(hist, today)
        assert result >= 0

    def test_rate_is_roughly_demand_per_interval_times_30(self):
        """
        Every-5-days demand of 10 units → ~2 units/day → ~60 units/30d.
        Allow wide tolerance (TSB smoothing converges over time).
        """
        from app.regimes import croston_tsb_30d
        hist = make_intermittent(90, every=5, qty=10.0)
        today = datetime.date(2024, 4, 1)
        result = croston_tsb_30d(hist, today)
        # Expected ≈ 60 but smoothing may vary; just check it's in ballpark
        assert 20 <= result <= 120


# ---------------------------------------------------------------------------
# sarima_30d
# ---------------------------------------------------------------------------

class TestSarima30d:
    def test_clean_weekly_series_positive(self):
        """A simple upward trending weekly series → positive 30-day forecast."""
        from app.regimes import sarima_30d
        # 56 days of data with clear weekly pattern
        base = datetime.date(2024, 1, 1)
        hist = []
        for i in range(56):
            dow = (base + datetime.timedelta(days=i)).weekday()
            qty = 5.0 + (2.0 if dow in (4, 5) else 0.0)  # weekend spike
            hist.append({
                "date": (base + datetime.timedelta(days=i)).isoformat(),
                "quantity": qty,
            })
        today = datetime.date(2024, 2, 26)
        result = sarima_30d(hist, today)
        assert result >= 0

    def test_returns_float(self):
        from app.regimes import sarima_30d
        hist = make_history(60, qty=5.0)
        today = datetime.date(2024, 3, 1)
        result = sarima_30d(hist, today)
        assert isinstance(result, float)

    def test_fallback_on_insufficient_data(self):
        """Very short series that would make SARIMAX fail → fallback, still non-negative."""
        from app.regimes import sarima_30d
        hist = make_history(8, qty=2.0)
        today = datetime.date(2024, 1, 9)
        result = sarima_30d(hist, today)
        assert result >= 0


# ---------------------------------------------------------------------------
# _to_daily_series (internal helper — tested indirectly via regime funcs)
# ---------------------------------------------------------------------------

class TestToDailySeries:
    def test_gaps_filled_with_zero(self):
        """History with a gap: missing days are filled with 0."""
        from app.regimes import _to_daily_series
        hist = [
            {"date": "2024-01-01", "quantity": 5.0},
            {"date": "2024-01-05", "quantity": 3.0},  # gap of 3 days
        ]
        today = datetime.date(2024, 1, 5)
        s = _to_daily_series(hist, today)
        assert s["2024-01-02"] == 0.0
        assert s["2024-01-03"] == 0.0
        assert s["2024-01-04"] == 0.0
        assert s["2024-01-05"] == pytest.approx(3.0)

    def test_series_ends_at_today(self):
        from app.regimes import _to_daily_series
        hist = make_history(5)
        today = datetime.date(2024, 1, 10)
        s = _to_daily_series(hist, today)
        assert s.index[-1] == s.index.get_loc("2024-01-10") or str(s.index[-1])[:10] == "2024-01-10"
