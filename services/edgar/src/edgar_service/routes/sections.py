from __future__ import annotations

import re
from typing import Annotated

from fastapi import Path, Query

from edgar_service.errors import InvalidRequest, NotFound
from edgar_service.models import Section
from edgar_service.routes import Client, protected_router

router = protected_router("sections")

ITEM_RE = re.compile(r"^\d{1,2}[A-Ca-c]?$")
DEFAULT_ITEMS = "1,1A,7,7A,8"


def parse_items(raw: str) -> list[str]:
    items = [part.strip().upper() for part in raw.split(",") if part.strip()]
    bad = [i for i in items if not ITEM_RE.match(i)]
    if bad or not items:
        raise ValueError(f"invalid 10-K item(s): {', '.join(bad) or raw!r}")
    return list(dict.fromkeys(items))


@router.get(
    "/filings/{accession}/sections", response_model=list[Section], operation_id="getSections"
)
def get_sections(
    accession: Annotated[str, Path(pattern=r"^\d{10}-\d{2}-\d{6}$")],
    client: Client,
    items: Annotated[str, Query(examples=[DEFAULT_ITEMS])] = DEFAULT_ITEMS,
) -> list[Section]:
    """Text of the requested 10-K items. Items the filing does not contain are omitted;
    404 if none of them are found."""
    try:
        wanted = parse_items(items)
    except ValueError as exc:
        raise InvalidRequest(str(exc)) from exc
    sections = client.get_sections(accession, wanted)
    if not sections:
        raise NotFound(f"none of items {', '.join(wanted)} found in {accession}")
    return sections
