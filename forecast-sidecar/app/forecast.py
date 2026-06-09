"""
Forecast orchestration — Task A4.

forecast_demand(req: DemandRequest) -> DemandResponse

Layer 1: regime forecast (sarima | tsb/croston | cold_start)
Layer 2: deterministic calendar multiplier (holiday × payday × promo) — NO noise
         Signals identical to simulate-layers.ts lines ~155-181, minus the
         mulberry32 random noise term.

_xgb_adjust(features) -> 1.0   (hook for future XGBoost residual model)
"""

from __future__ import annotations

import datetime
from typing import Any

from app.schemas import DemandRequest, DemandResponse, Signal
from app.regimes import (
    classify,
    cold_start_30d,
    croston_tsb_30d,
    sarima_30d,
    weighted_rate,
    _to_daily_series,
)
from app.calendar_ke import (
    lookahead_holiday_boost,
    lookahead_paydays,
)


# ---------------------------------------------------------------------------
# XGBoost hook (no-op until backtest training in Task C2)
# ---------------------------------------------------------------------------

import os

# Lazy-loaded XGBoost residual model. _XGB_BUNDLE is:
#   None      -> not yet attempted
#   False     -> attempted, no model present (stay a no-op)
#   dict      -> loaded {model, feature_names, clip}
_XGB_BUNDLE: Any = None
_MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "model.pkl")


def _load_xgb() -> Any:
    global _XGB_BUNDLE
    if _XGB_BUNDLE is None:
        try:
            import joblib  # noqa: WPS433 (lazy import)
            _XGB_BUNDLE = joblib.load(_MODEL_PATH) if os.path.exists(_MODEL_PATH) else False
        except Exception:
            _XGB_BUNDLE = False
    return _XGB_BUNDLE


def _xgb_feature_vector(features: dict[str, Any]) -> list[float]:
    """MUST match build_features() in train_xgb.py exactly."""
    import numpy as np

    conf = float(features.get("confidence", 0.5))
    cv = (1.0 - conf) / 0.3 if conf < 0.9 else 0.0
    abc = str(features.get("abc") or "C").upper()
    abc_ord = {"A": 0.0, "B": 1.0, "C": 2.0}.get(abc, 2.0)
    recent = float(features.get("recent_rate", 0.0) or 0.0)
    layer1 = float(features.get("layer1", 0.0) or 0.0)
    regime = str(features.get("regime", "")).lower()
    return [
        cv,
        abc_ord,
        float(np.log1p(max(0.0, recent))),
        float(np.log1p(max(0.0, layer1))),
        1.0 if regime == "sarima" else 0.0,
        1.0 if regime in ("tsb", "croston") else 0.0,
        1.0 if regime == "cold_start" else 0.0,
    ]


def _xgb_adjust(features: dict[str, Any]) -> float:
    """
    XGBoost residual-correction multiplier.

    Returns 1.0 (no adjustment) when no trained model is present, so the sidecar
    is fully backward-compatible. When forecast-sidecar/model.pkl exists (built by
    train_xgb.py), loads it once and returns the clipped predicted multiplier.
    The caller multiplies the calendar multiplier by this value.
    """
    bundle = _load_xgb()
    if not bundle:
        return 1.0
    try:
        import numpy as np

        x = np.array([_xgb_feature_vector(features)], dtype=float)
        pred = float(bundle["model"].predict(x)[0])
        lo, hi = bundle.get("clip", [0.2, 5.0])
        return min(hi, max(lo, pred))
    except Exception:
        return 1.0


# ---------------------------------------------------------------------------
# Active-promo lift (port of activePromoLift in simulate-layers.ts)
# ---------------------------------------------------------------------------

def _active_promo_lift(
    promos: list,
    product_type: str | None,
    vendor: str | None,
    sku: str,
) -> tuple[float, str | None]:
    """
    Return (best_lift, channel) for the best-matching active promo.

    Port of activePromoLift: lift = 1 + (discountPct / 100) * 1.5
    Scope matching: all | sku | category | brand
    """
    best_lift = 1.0
    channel: str | None = None

    for p in promos:
        scope = p.scope if hasattr(p, "scope") else p.get("scope", "")
        scope_value = p.scopeValue if hasattr(p, "scopeValue") else p.get("scopeValue", "")
        discount_pct = p.discountPct if hasattr(p, "discountPct") else p.get("discountPct", 0.0)
        p_channel = p.channel if hasattr(p, "channel") else p.get("channel", "")

        matches = (
            scope == "all"
            or (scope == "sku" and scope_value == sku)
            or (scope == "category" and scope_value and scope_value.upper() == (product_type or "").upper())
            or (scope == "brand" and scope_value and scope_value.upper() == (vendor or "").upper())
        )
        if not matches:
            continue

        lift = 1 + (discount_pct / 100) * 1.5
        if lift > best_lift:
            best_lift = lift
            channel = p_channel

    return best_lift, channel


# ---------------------------------------------------------------------------
# Layer-1 confidence (mirrors TS: max(0.3, min(0.95, 0.9 - cv * 0.3)))
# ---------------------------------------------------------------------------

def _layer1_confidence(series, today: datetime.date) -> float:
    """
    Coefficient-of-variation of the last-90-day window.

    Mirrors simulate-layers.ts:
      const cv = meanRecent > 0 ? std90 / meanRecent : 1.0
      layer1Confidence = max(0.3, min(0.95, 0.9 - cv * 0.3))

    Note: TS computes meanRecent from the last-30d window and std90 from the
    last-90d window — we replicate this exactly.
    """
    import numpy as np
    import pandas as pd

    asof = pd.Timestamp(today)
    last30_since = asof - pd.Timedelta(days=30)
    last90_since = asof - pd.Timedelta(days=90)

    recent_30 = series[series.index >= last30_since]
    recent_90 = series[series.index >= last90_since]

    mean_recent = float(recent_30.mean()) if len(recent_30) > 0 else 0.0

    if len(recent_90) > 0:
        vals = recent_90.values
        mean_90 = float(vals.mean())
        std_90 = float(np.sqrt(((vals - mean_90) ** 2).mean()))
    else:
        std_90 = 0.0

    cv = std_90 / mean_recent if mean_recent > 0 else 1.0
    confidence = max(0.3, min(0.95, 0.9 - cv * 0.3))
    return confidence


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def forecast_demand(req: DemandRequest) -> DemandResponse:
    """
    Full demand forecast pipeline.

    1. Parse inputs + build pandas series
    2. Classify regime
    3. Layer-1 regime forecast
    4. Layer-1 confidence (CV of last 90d)
    5. Layer-2 deterministic multiplier (holiday × payday × promo)
    6. Build signals[]
    7. Apply XGBoost hook (returns 1.0 for now)
    8. Assemble DemandResponse
    """
    today = datetime.date.fromisoformat(req.runDateKey)
    history = [h.model_dump() if hasattr(h, "model_dump") else dict(h) for h in req.history]

    series = _to_daily_series(history, today)
    regime = classify(history, today)

    # ------------------------------------------------------------------
    # Layer 1: regime forecast
    # ------------------------------------------------------------------
    if regime == "cold_start":
        layer1 = cold_start_30d(history, today)
        regime_label = "cold_start"
    elif regime == "intermittent":
        layer1 = croston_tsb_30d(history, today)
        regime_label = "tsb"
    else:  # continuous
        layer1 = sarima_30d(history, today)
        regime_label = "sarima"

    layer1 = max(0.0, layer1)

    # ------------------------------------------------------------------
    # Layer-1 confidence
    # ------------------------------------------------------------------
    layer1_confidence = _layer1_confidence(series, today)

    # ------------------------------------------------------------------
    # Layer 2: deterministic calendar + promo multiplier
    # Port of simulate-layers.ts lines 155-181 (MINUS the noise term)
    # ------------------------------------------------------------------
    signals: list[Signal] = []

    # Holiday lookahead
    hol_boost, hol_name = lookahead_holiday_boost(req.productType, today, days=30)
    if hol_boost > 1.05:
        delta = (hol_boost - 1) * 100
        if hol_name and "Christmas" in hol_name:
            emoji = "🎄"
        elif hol_name and "Valentine" in hol_name:
            emoji = "💝"
        elif hol_name and "Eid" in hol_name:
            emoji = "🌙"
        else:
            emoji = "🎉"
        signals.append(Signal(
            label=f"{hol_name} +{delta:.0f}%",
            deltaPct=delta,
            emoji=emoji,
        ))

    # Payday lookahead
    pay_days = lookahead_paydays(today, days=30)
    pay_mult = 1 + (pay_days / 30) * 0.6
    if pay_mult > 1.02:
        signals.append(Signal(
            label=f"Payday weeks +{(pay_mult - 1) * 100:.0f}%",
            deltaPct=(pay_mult - 1) * 100,
            emoji="💰",
        ))

    # Active promo lift
    promo_lift, promo_channel = _active_promo_lift(
        req.activePromos, req.productType, req.vendor, req.sku
    )
    if promo_lift > 1.01:
        signals.append(Signal(
            label=f"Active promo {promo_channel or ''} +{(promo_lift - 1) * 100:.0f}%",
            deltaPct=(promo_lift - 1) * 100,
            emoji="🏷️",
        ))

    # Combined multiplier (NO noise — sidecar is deterministic)
    hol_mult = hol_boost
    total_mult = hol_mult * pay_mult * promo_lift

    # XGBoost residual hook (returns 1.0 unless model.pkl is present).
    xgb_features = {
        "confidence": layer1_confidence,
        "abc": req.abcCategory,
        "recent_rate": weighted_rate(series, asof=today),
        "regime": regime_label,
        "layer1": layer1,
    }
    xgb_mult = _xgb_adjust(xgb_features)
    total_mult *= xgb_mult

    # Final forecast
    final_forecast = max(0.0, layer1 * total_mult)
    layer2_adjustment = final_forecast - layer1

    # ------------------------------------------------------------------
    # Reasoning (2-3 sentences)
    # ------------------------------------------------------------------
    regime_display = {
        "sarima": "SARIMA(1,1,1)×(0,1,1,7)",
        "tsb": "Croston/TSB",
        "cold_start": "cold-start mean",
        "continuous": "SARIMA(1,1,1)×(0,1,1,7)",
    }.get(regime_label, regime_label)

    signal_parts = [f"{s.label}" for s in signals] if signals else ["no significant calendar signals"]
    reasoning = (
        f"Layer 1 ({regime_display}) projected {layer1:.0f} units over 30 days "
        f"based on {'recency-weighted mean' if regime_label == 'cold_start' else 'time-series model on daily history'}. "
        f"Layer 2 applied a {(total_mult * 100 - 100):.0f}% calendar adjustment from: "
        f"{', '.join(signal_parts)}. "
        f"Confidence {layer1_confidence:.0%} (CV-based, regime={regime_label})."
    )

    return DemandResponse(
        layer1Forecast30d=layer1,
        layer1Confidence=layer1_confidence,
        layer2Adjustment=layer2_adjustment,
        finalForecast30d=final_forecast,
        confidence=layer1_confidence,
        reasoning=reasoning,
        signals=signals,
        regime=regime_label,
    )
