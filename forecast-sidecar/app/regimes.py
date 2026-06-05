"""
Demand-regime classification and per-regime 30-day forecasters.

Task A3 — mirrors the plan spec:
  - classify   : <14 days → cold_start; ≥50% zeros → intermittent; else continuous
  - sarima_30d : SARIMAX(1,1,1)×(0,1,1,7), fallback to weighted_rate×30
  - croston_tsb_30d : TSB (Teunter-Syntetos-Babai) smoothing
  - cold_start_30d  : mean non-zero demand × 30
  - weighted_rate   : recency-weighted daily mean (mirrors baseline.ts)
"""

from __future__ import annotations

import datetime
import warnings
from typing import Optional

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# _to_daily_series
# ---------------------------------------------------------------------------

def _to_daily_series(
    history: list[dict],
    today: datetime.date,
) -> pd.Series:
    """
    Convert a list of {"date": "YYYY-MM-DD", "quantity": float} records into
    a contiguous daily pandas Series (missing days filled with 0) ending at
    *today*.

    Returns a Series with DatetimeIndex at midnight UTC, values = float.
    """
    if not history:
        idx = pd.date_range(end=pd.Timestamp(today), periods=1, freq="D")
        return pd.Series([0.0], index=idx, dtype=float)

    df = pd.DataFrame(history)
    df["date"] = pd.to_datetime(df["date"])
    df = df.groupby("date")["quantity"].sum().reset_index()
    df = df.set_index("date")["quantity"].sort_index()

    # Build a complete daily range from earliest record to today
    start = df.index.min()
    end = pd.Timestamp(today)
    full_idx = pd.date_range(start=start, end=end, freq="D")
    series = df.reindex(full_idx, fill_value=0.0).astype(float)
    return series


# ---------------------------------------------------------------------------
# weighted_rate  (mirrors baseline.ts weightedDailyRate)
# ---------------------------------------------------------------------------

def weighted_rate(
    series: pd.Series,
    asof: Optional[datetime.date] = None,
) -> float:
    """
    Recency-weighted daily mean.

    Windows and weights exactly match baseline.ts:
      30d → weight 0.5
      90d → weight 0.3
     365d → weight 0.2
    """
    if series.empty or series.sum() == 0:
        return 0.0

    if asof is None:
        asof = series.index[-1].date() if len(series) > 0 else datetime.date.today()

    asof_ts = pd.Timestamp(asof)

    windows = [(30, 0.5), (90, 0.3), (365, 0.2)]
    result = 0.0
    for days, weight in windows:
        since = asof_ts - pd.Timedelta(days=days)
        window_data = series[series.index >= since]
        total_qty = window_data.sum()
        result += (total_qty / days) * weight

    return float(result)


# ---------------------------------------------------------------------------
# classify
# ---------------------------------------------------------------------------

def classify(
    history: list[dict],
    today: datetime.date,
) -> str:
    """
    Classify the demand regime:
      - "cold_start"   : < 14 non-null data points in history
      - "intermittent" : ≥ 50% of daily series values are zero
      - "continuous"   : otherwise
    """
    series = _to_daily_series(history, today)

    # Cold-start: fewer than 14 actual data points provided
    if len(history) < 14:
        return "cold_start"

    zero_frac = (series == 0).mean()
    if zero_frac >= 0.5:
        return "intermittent"

    return "continuous"


# ---------------------------------------------------------------------------
# cold_start_30d
# ---------------------------------------------------------------------------

def cold_start_30d(
    history: list[dict],
    today: datetime.date,
) -> float:
    """
    Cold-start 30-day forecast: mean of non-zero demand × 30.
    Falls back to overall mean × 30 if all values are zero or non-zero set
    is empty.
    """
    series = _to_daily_series(history, today)

    nonzero = series[series > 0]
    if len(nonzero) == 0:
        # all-zero history
        return float(series.mean() * 30) if len(series) > 0 else 0.0

    return float(nonzero.mean() * 30)


# ---------------------------------------------------------------------------
# croston_tsb_30d
# ---------------------------------------------------------------------------

def croston_tsb_30d(
    history: list[dict],
    today: datetime.date,
    alpha_d: float = 0.1,
    alpha_p: float = 0.1,
) -> float:
    """
    Teunter-Syntetos-Babai (TSB) smoothing for intermittent demand.

    TSB updates:
      - demand size  (d_t):    smoothed over non-zero periods only
      - demand probability (p_t): smoothed every period
    Forecast rate = p_t × d_t   (expected demand per period)
    30-day forecast = rate × 30

    alpha_d, alpha_p: smoothing parameters (0.1 matches common defaults).
    """
    series = _to_daily_series(history, today)
    values = series.values.tolist()

    if len(values) == 0 or sum(values) == 0:
        return 0.0

    # Initialise with first non-zero value and empirical non-zero probability
    nonzero = [v for v in values if v > 0]
    d_t = nonzero[0] if nonzero else 1.0
    # Initial probability = fraction of non-zero periods
    p_t = len(nonzero) / len(values)

    for v in values:
        if v > 0:
            # Update both size and probability
            d_t = alpha_d * v + (1 - alpha_d) * d_t
            p_t = alpha_p * 1.0 + (1 - alpha_p) * p_t
        else:
            # Update probability only (TSB distinguishing feature vs Croston)
            p_t = alpha_p * 0.0 + (1 - alpha_p) * p_t
            # d_t unchanged

    daily_rate = p_t * d_t
    return max(0.0, float(daily_rate * 30))


# ---------------------------------------------------------------------------
# sarima_30d
# ---------------------------------------------------------------------------

def sarima_30d(
    history: list[dict],
    today: datetime.date,
) -> float:
    """
    SARIMA 30-day forecast.

    Model: SARIMAX(order=(1,1,1), seasonal_order=(0,1,1,7))
    Fit: disp=False
    Forecast: 30 steps ahead, sum, clamp ≥ 0.

    On ANY exception (convergence failure, insufficient data, etc.)
    falls back to weighted_rate(series) × 30.
    """
    series = _to_daily_series(history, today)

    # Need at least 2 seasonal periods (14 days) + trend differencing margin
    # SARIMAX with d=1 + D=1 at m=7 requires ≥ 7+7+2 = ~16 obs to be safe
    if len(series) < 16:
        return max(0.0, weighted_rate(series, asof=today) * 30)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from statsmodels.tsa.statespace.sarimax import SARIMAX

            model = SARIMAX(
                series,
                order=(1, 1, 1),
                seasonal_order=(0, 1, 1, 7),
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            result = model.fit(disp=False, maxiter=200)
            forecast = result.forecast(steps=30)
            total = float(forecast.sum())
            return max(0.0, total)

    except Exception:
        # Convergence failure, singular matrix, or too little data — fall back
        return max(0.0, weighted_rate(series, asof=today) * 30)
