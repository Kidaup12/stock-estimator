"""
JWT authentication for the forecast sidecar.

Algorithm : HS256
Secret    : os.environ["FORECAST_SIDECAR_SECRET"]
Claims    : standard exp checked automatically by PyJWT

Usage (FastAPI dependency):
    from fastapi import Depends
    from app.auth import verify_jwt

    @app.post("/forecast")
    def forecast_endpoint(_, token=Depends(verify_jwt)):
        ...
"""

from __future__ import annotations

import os
import time
from typing import Any

import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer_scheme = HTTPBearer(auto_error=False)


def _secret() -> str:
    secret = os.environ.get("FORECAST_SIDECAR_SECRET", "")
    if not secret:
        raise HTTPException(
            status_code=500,
            detail="FORECAST_SIDECAR_SECRET is not configured",
        )
    return secret


def verify_jwt(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> dict[str, Any]:
    """
    FastAPI dependency.  Extracts Bearer token from the Authorization header,
    decodes it with HS256, verifies ``exp``.

    Raises HTTPException(401) on any failure.
    Returns the decoded payload dict on success.
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = credentials.credentials
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            _secret(),
            algorithms=["HS256"],
            options={"require": ["exp"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")

    return payload


# ---------------------------------------------------------------------------
# Test helper — NOT for production use
# ---------------------------------------------------------------------------


def make_token(secret: str, ttl: int = 300) -> str:
    """
    Generate a signed HS256 JWT for tests.

    Args:
        secret: The HS256 shared secret.
        ttl:    Time-to-live in seconds (default 300 = 5 min).

    Returns:
        A JWT string that ``verify_jwt`` will accept.
    """
    payload = {
        "sub": "test",
        "exp": int(time.time()) + ttl,
    }
    return jwt.encode(payload, secret, algorithm="HS256")
