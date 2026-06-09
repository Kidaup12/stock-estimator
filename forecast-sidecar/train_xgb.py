"""
Train the XGBoost residual-correction layer for the forecast sidecar.

The sidecar's Layer-1 (SARIMA / Croston / cold-start) × Layer-2 (calendar) produces
`finalForecast30d`. XGBoost learns a *multiplier* that nudges that number toward what
actually sold:  target = actual_30d / finalForecast30d  (clipped to [0.2, 5]).

Training data comes from the walk-forward backtest:  scripts/out/wf-base.json
(produced by `npx tsx scripts/walkforward-backtest.ts` with NO model present).

Validation is leave-last-origin-out: train on Jan/Feb/Mar origins, test on the
Apr→May origin — the only month XGBoost never saw. With just 4 monthly snapshots
this is a tiny dataset; overfitting is expected and reported honestly.

Output: forecast-sidecar/model.pkl  (joblib dict: model + feature names + meta).

Run:  forecast-sidecar/.venv/Scripts/python forecast-sidecar/train_xgb.py
"""
from __future__ import annotations

import json
import os

import numpy as np
import joblib
from xgboost import XGBRegressor

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(HERE, "..", "scripts", "out", "wf-base.json")
MODEL_OUT = os.path.join(HERE, "model.pkl")

HELDOUT_ORIGIN = "2026-04-30"  # Apr -> May: the only true out-of-sample month
MULT_LO, MULT_HI = 0.2, 5.0
FEATURE_NAMES = ["cv", "abc_ord", "log_recent", "log_layer1", "is_sarima", "is_tsb", "is_cold"]

# Shared so apply_xgb_offline.py reproduces the exact same training.
PARAMS = dict(
    n_estimators=200,
    max_depth=3,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_lambda=1.0,
    random_state=42,
    objective="reg:squarederror",
)


def target_mult(r: dict) -> float:
    """The corrective multiplier that would have been exactly right for this row."""
    mult = float(r["actual30d"]) / float(r["finalSidecar"])
    return min(MULT_HI, max(MULT_LO, mult))


def build_features(row: dict) -> list[float]:
    """Feature vector — MUST match _xgb_adjust() in app/forecast.py exactly."""
    conf = float(row.get("conf", 0.5))
    cv = (1.0 - conf) / 0.3 if conf < 0.9 else 0.0
    abc = str(row.get("abc", "C")).upper()
    abc_ord = {"A": 0.0, "B": 1.0, "C": 2.0}.get(abc, 2.0)
    recent = float(row.get("recentRate", 0.0))
    layer1 = float(row.get("layer1", 0.0))
    regime = str(row.get("regime", "")).lower()
    return [
        cv,
        abc_ord,
        float(np.log1p(max(0.0, recent))),
        float(np.log1p(max(0.0, layer1))),
        1.0 if regime == "sarima" else 0.0,
        1.0 if regime in ("tsb", "croston") else 0.0,
        1.0 if regime == "cold_start" else 0.0,
    ]


def forecast_mae(rows, mult_pred):
    """MAE on the actual forecast (final * predicted multiplier) vs actual_30d."""
    err = 0.0
    for r, m in zip(rows, mult_pred):
        pred = float(r["finalSidecar"]) * float(m)
        err += abs(pred - float(r["actual30d"]))
    return err / len(rows) if rows else float("nan")


def baseline_mae(rows):
    """MAE if we apply NO correction (multiplier = 1.0) — the sidecar as-is."""
    return forecast_mae(rows, [1.0] * len(rows))


def main():
    if not os.path.exists(DATASET):
        raise SystemExit(
            f"Dataset not found: {DATASET}\n"
            "Run the base backtest first:  npx tsx scripts/walkforward-backtest.ts"
        )
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    rows = [r for r in data["rows"] if float(r.get("finalSidecar", 0)) > 0]
    if not rows:
        raise SystemExit("No usable rows (need finalSidecar > 0).")

    target = target_mult
    params = PARAMS

    train_rows = [r for r in rows if r["origin"] != HELDOUT_ORIGIN]
    test_rows = [r for r in rows if r["origin"] == HELDOUT_ORIGIN]

    print(f"Total rows: {len(rows)}  |  train(Jan/Feb/Mar): {len(train_rows)}  |  test(Apr->May): {len(test_rows)}")

    Xtr = np.array([build_features(r) for r in train_rows], dtype=float)
    ytr = np.array([target(r) for r in train_rows], dtype=float)

    # ── Leave-last-origin-out validation ──────────────────────────────────────
    if test_rows:
        val = XGBRegressor(**params)
        val.fit(Xtr, ytr)
        Xte = np.array([build_features(r) for r in test_rows], dtype=float)
        mult_pred = np.clip(val.predict(Xte), MULT_LO, MULT_HI)

        base = baseline_mae(test_rows)
        with_xgb = forecast_mae(test_rows, mult_pred)
        print("\n=== OUT-OF-SAMPLE (Apr -> May, never trained on) ===")
        print(f"  sidecar alone   MAE = {base:.3f}")
        print(f"  sidecar + XGB   MAE = {with_xgb:.3f}")
        verdict = "HELPS" if with_xgb < base else "does NOT help"
        print(f"  verdict: XGBoost {verdict} out-of-sample ({(1 - with_xgb / base) * 100:+.1f}% vs sidecar)")

        # In-sample (training months) for reference — shows overfit gap.
        mult_tr = np.clip(val.predict(Xtr), MULT_LO, MULT_HI)
        print(f"\n  (reference) in-sample train MAE: sidecar {baseline_mae(train_rows):.3f} -> +XGB {forecast_mae(train_rows, mult_tr):.3f}")
    else:
        print("No held-out rows for the Apr origin — skipping OOS validation.")

    # ── Final model: refit on ALL rows, save ─────────────────────────────────
    Xall = np.array([build_features(r) for r in rows], dtype=float)
    yall = np.array([target(r) for r in rows], dtype=float)
    final = XGBRegressor(**params)
    final.fit(Xall, yall)
    joblib.dump(
        {"model": final, "feature_names": FEATURE_NAMES, "clip": [MULT_LO, MULT_HI],
         "trained_rows": len(rows), "heldout_origin": HELDOUT_ORIGIN},
        MODEL_OUT,
    )
    print(f"\nSaved {MODEL_OUT}  (trained on {len(rows)} rows)")
    print("Restart the sidecar to pick it up, then: WF_TAG=xgb npx tsx scripts/walkforward-backtest.ts")


if __name__ == "__main__":
    main()
