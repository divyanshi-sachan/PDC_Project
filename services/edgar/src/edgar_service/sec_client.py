"""The only module that talks to edgartools. Routes depend on the ``SecClient`` protocol,
so tests swap in a fake via ``app.dependency_overrides[get_sec_client]``.

Rate limiting: we make no HTTP calls of our own. Every request below goes through
edgartools' shared ``HttpxThrottleCache`` with its process-wide pyrate-limiter
(``EDGAR_RATE_LIMIT_PER_SEC``, set to <= 10 by ``config.configure_edgar_env``), and its
Hishel file cache under ``EDGAR_LOCAL_DATA_DIR``. Run a single worker so the limit
stays process-wide.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date
from typing import Any, Protocol

import edgar
import httpx2
from edgar.entity.entity_facts import download_company_facts_from_sec
from edgar.entity.submissions import download_entity_submissions_from_sec
from edgar.exceptions import CompanyNotFoundError, EdgarError, NotFoundError
from edgar.xbrl import XBRL

from edgar_service.errors import NotFound, ProvenanceError, UnsupportedForm, UpstreamError
from edgar_service.models import Filing, SearchHit, Section, StatementKind, StatementPeriod
from edgar_service.statements import (
    FilingStatement,
    parse_period_key,
    rows_from_records,
    select_period_key,
)
from edgar_service.submissions import format_cik

SECTION_FORMS = {"10-K", "10-K/A"}
STATEMENT_FORMS: dict[StatementPeriod, str] = {"annual": "10-K", "quarterly": "10-Q"}
_STATEMENT_ACCESSORS: dict[StatementKind, str] = {
    "income": "income_statement",
    "balance": "balance_sheet",
    "cashflow": "cash_flow_statement",
}


class SecClient(Protocol):
    def resolve_cik(self, ticker: str) -> int: ...
    def get_submissions(self, cik: int) -> dict[str, Any]: ...
    def get_company_facts(self, cik: int) -> dict[str, Any]: ...
    def get_filings(self, cik: int, form: str | None, limit: int) -> list[Filing]: ...
    def get_statement_filings(
        self, cik: int, kind: StatementKind, period: StatementPeriod, limit: int
    ) -> list[FilingStatement]: ...
    def get_sections(self, accession: str, items: list[str]) -> list[Section]: ...
    def search(self, q: str, forms: list[str] | None, limit: int) -> list[SearchHit]: ...


@contextmanager
def _upstream(what: str) -> Iterator[None]:
    """Map edgartools/httpx failures onto our error types."""
    try:
        yield
    except (NotFound, UpstreamError, ProvenanceError, UnsupportedForm):
        raise
    except NotFoundError as exc:
        raise NotFound(f"{what}: {exc}") from exc
    except (EdgarError, httpx2.HTTPError, OSError) as exc:
        raise UpstreamError(f"{what}: SEC request failed ({type(exc).__name__}: {exc})") from exc


def _call[T](what: str, fn: Callable[[], T]) -> T:
    with _upstream(what):
        return fn()


def _opt_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _req_date(value: Any) -> date:
    parsed = _opt_date(value)
    if parsed is None:
        raise UpstreamError("SEC returned a filing without a filing date")
    return parsed


def _opt_int(value: Any) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


class EdgarToolsClient:
    """SecClient backed by edgartools (``edgar`` package)."""

    def resolve_cik(self, ticker: str) -> int:
        def run() -> int:
            try:
                return int(edgar.Company(ticker.upper()).cik)
            except CompanyNotFoundError as exc:
                raise NotFound(f"unknown ticker {ticker!r}") from exc

        return _call(f"resolve {ticker}", run)

    def get_submissions(self, cik: int) -> dict[str, Any]:
        data = _call(f"submissions {cik}", lambda: download_entity_submissions_from_sec(cik))
        if not data:
            raise NotFound(f"no SEC submissions for CIK {format_cik(cik)}")
        return dict(data)

    def get_company_facts(self, cik: int) -> dict[str, Any]:
        return dict(_call(f"companyfacts {cik}", lambda: download_company_facts_from_sec(cik)))

    def get_filings(self, cik: int, form: str | None, limit: int) -> list[Filing]:
        def run() -> list[Filing]:
            filings = edgar.Company(cik).get_filings(form=form).head(limit)
            out: list[Filing] = []
            for i in range(len(filings)):
                f = filings.get_filing_at(i)
                doc = f.primary_document
                url = f"{f.base_dir}/{doc}" if doc else f.homepage_url
                out.append(
                    Filing(
                        accession=f.accession_no,
                        form=f.form,
                        filed=_req_date(f.filing_date),
                        period_of_report=_opt_date(f.report_date),
                        primary_document_url=url,
                    )
                )
            return out

        return _call(f"filings {cik}", run)

    def get_statement_filings(
        self, cik: int, kind: StatementKind, period: StatementPeriod, limit: int
    ) -> list[FilingStatement]:
        form = STATEMENT_FORMS[period]

        def run() -> list[FilingStatement]:
            filings = edgar.Company(cik).get_filings(form=form, amendments=False, is_xbrl=True)
            filings = filings.head(limit)
            return [
                self._filing_statement(filings.get_filing_at(i), kind, period)
                for i in range(len(filings))
            ]

        return _call(f"{kind} statements {cik}", run)

    def _filing_statement(
        self, filing: Any, kind: StatementKind, period: StatementPeriod
    ) -> FilingStatement:
        accession = filing.accession_no
        xb = XBRL.from_filing(filing)
        if xb is None:
            raise ProvenanceError(f"filing {accession} has no XBRL; cannot build its column")
        statement = getattr(xb.statements, _STATEMENT_ACCESSORS[kind])()
        if statement is None:
            raise UpstreamError(f"filing {accession} has no {kind} statement")
        period_end = _opt_date(xb.period_of_report)
        if period_end is None:
            raise ProvenanceError(f"filing {accession} has no DocumentPeriodEndDate")
        keys = [p["key"] for p in xb.reporting_periods]
        key = select_period_key(keys, period_end, kind, period)
        if key is None:
            raise ProvenanceError(
                f"filing {accession}: no {period} {kind} period ending {period_end.isoformat()}"
            )
        start, end = parse_period_key(key)
        df = statement.to_dataframe(
            period_filter=key, view="summary", include_unit=True, presentation=False
        )
        records = [] if df is None or isinstance(df, str) else df.to_dict(orient="records")
        info = xb.entity_info or {}
        return FilingStatement(
            accession=accession,
            form=filing.form,
            filed=_opt_date(filing.filing_date),
            fiscal_year=_opt_int(info.get("fiscal_year")),
            fiscal_period=info.get("fiscal_period") or None,
            period_start=start,
            period_end=end,
            rows=rows_from_records(records, end),
        )

    def get_sections(self, accession: str, items: list[str]) -> list[Section]:
        def run() -> list[Section]:
            filing = edgar.find(accession)
            if not isinstance(filing, edgar.Filing):
                raise NotFound(f"unknown accession {accession}")
            if filing.form not in SECTION_FORMS:
                raise UnsupportedForm(
                    f"sections are supported for {sorted(SECTION_FORMS)}, not {filing.form}"
                )
            report = filing.obj()
            url = filing.filing_url
            out: list[Section] = []
            for item in items:
                section = report.section(f"Item {item}")
                if section is None:
                    continue
                text = section.text() or ""
                if not text.strip():
                    continue
                out.append(
                    Section(
                        accession=accession,
                        item=item,
                        title=section.title or f"Item {item}",
                        text=text,
                        url=url,
                    )
                )
            return out

        return _call(f"sections {accession}", run)

    def search(self, q: str, forms: list[str] | None, limit: int) -> list[SearchHit]:
        def run() -> list[SearchHit]:
            results = edgar.search_filings(q, forms=forms, limit=limit)
            hits: list[SearchHit] = []
            for r in list(results)[:limit]:
                cik = format_cik(r.cik) if r.cik else None
                # EFTS hits carry the filer CIK; if absent, fall back to the accession's
                # prefix (the submitting entity), whose archive folder also holds the filing.
                cik_int = int(r.cik) if r.cik else int(r.accession_number[:10])
                folder = r.accession_number.replace("-", "")
                base = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{folder}"
                url = f"{base}/{r.document_id}" if r.document_id else f"{base}/"
                hits.append(
                    SearchHit(
                        accession=r.accession_number,
                        form=r.form,
                        filed=_req_date(r.filed),
                        company=r.company,
                        cik=cik,
                        url=url,
                        snippet=None,
                    )
                )
            return hits

        return _call("full-text search", run)


_client: SecClient | None = None


def get_sec_client() -> SecClient:
    """FastAPI dependency; tests override it."""
    global _client
    if _client is None:
        _client = EdgarToolsClient()
    return _client
