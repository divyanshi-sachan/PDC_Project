from __future__ import annotations

from typing import Annotated

from fastapi import Query

from edgar_service.models import Filing
from edgar_service.routes import Client, protected_router
from edgar_service.routes.companies import Ticker

router = protected_router("filings")


@router.get("/companies/{ticker}/filings", response_model=list[Filing], operation_id="listFilings")
def list_filings(
    ticker: Ticker,
    client: Client,
    form: Annotated[str | None, Query(max_length=20, examples=["10-K"])] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 5,
) -> list[Filing]:
    """Most recent filings first (amendments included)."""
    cik = client.resolve_cik(ticker)
    return client.get_filings(cik, form, limit)
