from __future__ import annotations

from typing import Annotated

from fastapi import Query

from edgar_service.errors import NotFound
from edgar_service.models import FactsResponse
from edgar_service.routes import Client, protected_router
from edgar_service.routes.companies import Ticker
from edgar_service.submissions import format_cik
from edgar_service.xbrl_facts import ConceptNotFoundError, extract_facts, split_concept

router = protected_router("facts")


@router.get("/companies/{ticker}/facts", response_model=FactsResponse, operation_id="getFacts")
def get_facts(
    ticker: Ticker,
    client: Client,
    concept: Annotated[
        str,
        Query(
            min_length=1,
            max_length=200,
            pattern=r"^([A-Za-z0-9\-]+:)?[A-Za-z0-9_]+$",
            examples=["us-gaap:Revenues"],
        ),
    ],
    form: Annotated[str | None, Query(max_length=20, examples=["10-K"])] = None,
    all_versions: bool = False,
) -> FactsResponse:
    """Raw XBRL facts (SEC companyfacts), deduped to the latest-filed value per period.

    ``restated``/``original_value`` show where a later filing changed the first-filed
    value. ``all_versions=true`` returns every reported version instead.
    """
    cik = client.resolve_cik(ticker)
    data = client.get_company_facts(cik)
    taxonomy, name = split_concept(concept)
    try:
        facts = extract_facts(data, concept, form=form, all_versions=all_versions)
    except ConceptNotFoundError as exc:
        raise NotFound(str(exc)) from exc
    return FactsResponse(cik=format_cik(cik), concept=f"{taxonomy}:{name}", facts=facts)
