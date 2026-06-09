"""
Reconstruct the XGBoost-on backtest results offline, WITHOUT re-querying the DB
or the live sidecar.

This is exact, not an approximation: the live sidecar computes
    final_xgb = layer1 * calendar * xgb_mult = final_base * xgb_mult
and xgb_mult is a deterministic function of features already saved per row in
wf-base.json (confidence, abc, recent_rate, regime, layer1). So applying the
trained model to those rows reproduces precisely what a live WF_TAG=xgb run would
produce — handy when the Supabase pooler link is flaky.

Reads:  scripts/out/wf-base.json + forecast-sidecar/model.pkl
Writes: scripts/out/wf-xgb.json   (same schema renderReport expects)

Run:  forecast-sidecar/.venv/Scripts/python forecast-sidecar/apply_xgb_offline.py
"""
from __future__ import annotations

import json
import os
from statistics import median

import numpy as np
import joblib
from xgboost import XGBRegressor

# Identical feature vector + params + target as training/inference.
from train_xgb import build_features, PARAMS, target_mult, HELDOUT_ORIGIN, MULT_LO, MULT_HI

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "scripts", "out", "wf-base.json")
OUT = os.path.join(HERE, "..", "scripts", "out", "wf-xgb.json")
MODEL = os.path.join(HERE, "model.pkl")


def sidecar_metrics(rows, mult_by_id):
    """Recompute ONLY the sidecar metrics with the xgb multiplier applied."""
    abs_errs, bias_sum, pct_sum, pct_n, blow = [], 0.0, 0.0, 0, 0
    for r in rows:
        scale = r["days"] / 30.0
        mult = mult_by_id[id(r)]
        pred = r["finalSidecar"] * mult * scale
        a = r["actualMonth"]
        abs_errs.append(abs(pred - a))
        bias_sum += pred - a
        if a > 0:
            pct_sum += abs(pred - a) / a
            pct_n += 1
        if pred > max(20 * r["naive"], 100):
            blow += 1
    n = len(rows)
    return {
        "mae": sum(abs_errs) / n if n else float("nan"),
        "mdae": median(abs_errs) if abs_errs else float("nan"),
        "mape": (pct_sum / pct_n) * 100 if pct_n else float("nan"),
        "bias": bias_sum / n if n else float("nan"),
        "n": n,
        "blow": blow,
    }


def main():
    if not os.path.exists(MODEL):
        raise SystemExit("model.pkl not found — run train_xgb.py first.")
    if not os.path.exists(BASE):
        raise SystemExit("wf-base.json not found — run the base backtest first.")

    base = json.load(open(BASE, "r", encoding="utf-8"))
    rows = base["rows"]

    # CRITICAL for honesty: the Apr->May month must be predicted by a model that
    # NEVER trained on it. The shipped model.pkl is fit on ALL rows (incl. Apr), so
    # using it for Apr would be in-sample. Instead:
    #   - Apr rows           -> a "leave-Apr-out" model trained only on Jan/Feb/Mar (true OOS)
    #   - Jan/Feb/Mar rows   -> the full shipped model (in-sample; the report marks these ★ and ignores them)
    full = joblib.load(MODEL)["model"]

    loo_train = [r for r in rows if r["origin"] != HELDOUT_ORIGIN and float(r["finalSidecar"]) > 0]
    loo = XGBRegressor(**PARAMS)
    loo.fit(
        np.array([build_features(r) for r in loo_train], dtype=float),
        np.array([target_mult(r) for r in loo_train], dtype=float),
    )

    mult_by_id = {}
    for r in rows:
        x = np.array([build_features(r)], dtype=float)
        m = loo.predict(x)[0] if r["origin"] == HELDOUT_ORIGIN else full.predict(x)[0]
        mult_by_id[id(r)] = float(min(MULT_HI, max(MULT_LO, m)))

    # Per-origin: copy base, replace ONLY metrics.sidecar.
    new_origins = []
    for o in base["origins"]:
        orows = [r for r in rows if r["origin"] == o["key"]]
        no = json.loads(json.dumps(o))  # deep copy
        no["metrics"]["sidecar"] = sidecar_metrics(orows, mult_by_id)
        new_origins.append(no)

    overall = json.loads(json.dumps(base["overall"]))
    overall["sidecar"] = sidecar_metrics(rows, mult_by_id)

    # Rows with the xgb-adjusted sidecar forecast baked in (for consistency).
    new_rows = []
    for r in rows:
        nr = dict(r)
        nr["finalSidecar"] = r["finalSidecar"] * mult_by_id[id(r)]
        new_rows.append(nr)

    out = {"tag": "xgb", "origins": new_origins, "overall": overall, "rows": new_rows}
    json.dump(out, open(OUT, "w", encoding="utf-8"), indent=2)

    b, x = base["overall"]["sidecar"], overall["sidecar"]
    print(f"Wrote {OUT}")
    print(f"  sidecar overall  : MdAE {b['mdae']:.2f} -> {x['mdae']:.2f} | MAE {b['mae']:.1f} -> {x['mae']:.1f} | blow-ups {b['blow']} -> {x['blow']}")


if __name__ == "__main__":
    main()
