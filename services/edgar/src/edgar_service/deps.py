"""Startup wiring and shared FastAPI dependencies: SEC identity and service-key auth.

The cache directory and rate limit are configured in ``config.py`` (they must be set
before ``edgar`` is imported); the SEC client dependency lives in ``sec_client.py``.
"""

from __future__ import annotations

import hmac
import os
from typing import Annotated

import edgar
from fastapi import Security
from fastapi.security import APIKeyHeader

from edgar_service.errors import Unauthorized

SERVICE_KEY_HEADER = "X-Service-Key"


class MissingIdentityError(RuntimeError):
    pass


def configure_identity() -> str:
    """Call edgartools ``set_identity`` from ``SEC_USER_AGENT``; fail fast if it is unset.

    SEC blocks requests without a descriptive User-Agent ("Name email@example.com").
    """
    identity = os.environ.get("SEC_USER_AGENT", "").strip()
    if not identity:
        raise MissingIdentityError(
            "SEC_USER_AGENT is not set. SEC requires a User-Agent identifying you, e.g. "
            "SEC_USER_AGENT='DealPilot dev you@example.com'. Set it in .env (see .env.example)."
        )
    edgar.set_identity(identity)
    return identity


_api_key_header = APIKeyHeader(
    name=SERVICE_KEY_HEADER,
    auto_error=False,
    description="Required on every route except /health when EDGAR_SERVICE_KEY is set",
)


def require_service_key(
    provided: Annotated[str | None, Security(_api_key_header)] = None,
) -> None:
    """401 unless ``X-Service-Key`` matches ``EDGAR_SERVICE_KEY`` (when that is set)."""
    expected = os.environ.get("EDGAR_SERVICE_KEY")
    if not expected:
        return
    if provided is None or not hmac.compare_digest(provided.encode(), expected.encode()):
        raise Unauthorized(f"missing or invalid {SERVICE_KEY_HEADER} header")
