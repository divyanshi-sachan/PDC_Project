from __future__ import annotations

from typing import Annotated

from fastapi import Query

from edgar_service.models import Statement, StatementKind, StatementPeriod
from edgar_service.routes import Client, protected_router
from edgar_service.routes.companies import Ticker
from edgar_service.statements import build_statement
from edgar_service.submissions import format_cik

router = protected_router("statements")


@router.get("/companies/{ticker}/statements", response_model=Statement, operation_id="getStatement")
def get_statement(
    ticker: Ticker,
    client: Client,
    kind: StatementKind,
    period: StatementPeriod = "annual",
    limit: Annotated[int, Query(ge=1, le=12)] = 4,
) -> Statement:
    """Standardized statement (edgartools), one column per 10-K (annual) or 10-Q (quarterly).

    Each column is that filing's current period and carries its accession, form and
    filed date. Values are raw XBRL instance values (no presentation sign flips).
    """
    cik = client.resolve_cik(ticker)
    filings = client.get_statement_filings(cik, kind, period, limit)
    return build_statement(format_cik(cik), kind, period, filings)
