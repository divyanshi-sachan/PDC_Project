"""Pure mapping from SEC ``submissions`` JSON (data.sec.gov/submissions/CIK##########.json)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from edgar_service.models import Company


def format_cik(cik: int | str) -> str:
    return f"{int(cik):010d}"


def company_from_submissions(submissions: Mapping[str, Any], ticker: str) -> Company:
    """Build the Company contract from a submissions document.

    ``ticker`` is the symbol the caller asked for; if SEC lists tickers and the requested
    one is among them it is echoed back upper-cased, otherwise SEC's first ticker is used.
    """
    tickers = [str(t).upper() for t in submissions.get("tickers") or [] if t]
    requested = ticker.upper()
    resolved = requested if requested in tickers or not tickers else tickers[0]
    fye = submissions.get("fiscalYearEnd") or None
    sic = submissions.get("sic") or None
    return Company(
        cik=format_cik(submissions["cik"]),
        ticker=resolved,
        name=str(submissions.get("name") or ""),
        sic=str(sic) if sic is not None else None,
        sic_description=submissions.get("sicDescription") or None,
        fiscal_year_end=str(fye).zfill(4) if fye is not None else None,
        exchanges=[str(e) for e in submissions.get("exchanges") or [] if e],
    )
