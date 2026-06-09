"""
Shared pytest fixtures for the forecast sidecar.

The XGBoost residual layer is OPT-IN: the sidecar ships as a no-op until a model
is explicitly trained (train_xgb.py) and forecast-sidecar/model.pkl exists. To keep
the unit tests deterministic regardless of whether that artifact is present on disk,
pin every test to the no-model default. Tests that specifically exercise a loaded
model set app.forecast._XGB_BUNDLE themselves (after this fixture runs).
"""
import pytest

import app.forecast as _fc


@pytest.fixture(autouse=True)
def _no_xgb_by_default(monkeypatch):
    monkeypatch.setattr(_fc, "_XGB_BUNDLE", False, raising=False)
