from __future__ import annotations

from typing import Annotated

from fastapi import Path

from edgar_service.models import Company
from edgar_service.routes import Client, protected_router
from edgar_service.submissions import company_from_submissions

router = protected_router("companies")

Ticker = Annotated[str, Path(min_length=1, max_length=12, pattern=r"^[A-Za-z0-9.\-]+$")]


@router.get("/companies/{ticker}", response_model=Company, operation_id="getCompany")
def get_company(ticker: Ticker, client: Client) -> Company:
    cik = client.resolve_cik(ticker)
    return company_from_submissions(client.get_submissions(cik), ticker)
