from __future__ import annotations

from typing import Annotated

from fastapi import Query

from edgar_service.models import SearchHit
from edgar_service.routes import Client, protected_router

router = protected_router("search")


@router.get("/search", response_model=list[SearchHit], operation_id="searchFilings")
def search(
    client: Client,
    q: Annotated[str, Query(min_length=1, max_length=500)],
    forms: Annotated[
        str | None, Query(description="Comma-separated form types", examples=["10-K,10-Q"])
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[SearchHit]:
    """EDGAR full-text search (efts.sec.gov) via edgartools ``search_filings``."""
    form_list = [f.strip() for f in forms.split(",") if f.strip()] if forms else None
    return client.search(q, form_list or None, limit)
