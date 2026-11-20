"""HTTP routes. Every router except health requires the service key (when configured)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from edgar_service.deps import require_service_key
from edgar_service.errors import ERROR_RESPONSES
from edgar_service.sec_client import SecClient, get_sec_client

Client = Annotated[SecClient, Depends(get_sec_client)]


def protected_router(tag: str) -> APIRouter:
    return APIRouter(
        tags=[tag], dependencies=[Depends(require_service_key)], responses=ERROR_RESPONSES
    )
