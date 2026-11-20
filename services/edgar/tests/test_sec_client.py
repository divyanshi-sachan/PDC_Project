"""EdgarToolsClient adapter tests: edgartools calls are monkeypatched; nothing hits SEC."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from typing import Any

import edgar
import httpx2
import pandas as pd
import pytest
from edgar.exceptions import (
    CompanyFactsNotFoundError,
    CompanyNotFoundError,
    ParsingError,
    TransportError,
)

from edgar_service import sec_client
from edgar_service.errors import NotFound, ProvenanceError, UnsupportedForm, UpstreamError
from edgar_service.sec_client import EdgarToolsClient


@pytest.fixture
def sc() -> EdgarToolsClient:
    return EdgarToolsClient()


def raiser(exc: BaseException) -> Any:
    def _raise(*_: object, **__: object) -> Any:
        raise exc

    return _raise


class TestErrorMapping:
    def test_unknown_ticker(self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(edgar, "Company", raiser(CompanyNotFoundError("NOPE")))
        with pytest.raises(NotFound, match="unknown ticker"):
            sc.resolve_cik("nope")

    def test_resolve_ok(self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(edgar, "Company", lambda t: SimpleNamespace(cik=320193))
        assert sc.resolve_cik("aapl") == 320193

    @pytest.mark.parametrize(
        "exc",
        [
            TransportError("503 from SEC"),
            httpx2.ConnectError("connection refused"),
            ParsingError("bad json"),
            OSError("disk"),
        ],
    )
    def test_upstream(
        self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch, exc: Exception
    ) -> None:
        monkeypatch.setattr(sec_client, "download_company_facts_from_sec", raiser(exc))
        with pytest.raises(UpstreamError):
            sc.get_company_facts(320193)

    def test_facts_not_found(self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            sec_client, "download_company_facts_from_sec", raiser(CompanyFactsNotFoundError(cik=1))
        )
        with pytest.raises(NotFound):
            sc.get_company_facts(1)

    def test_submissions_none_is_404(
        self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sec_client, "download_entity_submissions_from_sec", lambda cik: None)
        with pytest.raises(NotFound):
            sc.get_submissions(1)

    def test_unexpected_errors_are_not_swallowed(
        self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sec_client, "download_company_facts_from_sec", raiser(KeyError("x")))
        with pytest.raises(KeyError):
            sc.get_company_facts(1)


class FakeFilings:
    def __init__(self, items: list[Any]) -> None:
        self.items = items

    def head(self, n: int) -> FakeFilings:
        return FakeFilings(self.items[:n])

    def __len__(self) -> int:
        return len(self.items)

    def get_filing_at(self, i: int) -> Any:
        return self.items[i]


def entity_filing(accession: str, form: str, primary: str, report: str = "2024-09-28") -> Any:
    folder = accession.replace("-", "")
    base = f"https://www.sec.gov/Archives/edgar/data/320193/{folder}"
    return SimpleNamespace(
        accession_no=accession,
        form=form,
        filing_date=date(2024, 11, 1),
        report_date=report,
        primary_document=primary,
        base_dir=base,
        homepage_url=f"{base}/{accession}-index.html",
    )


class TestFilings:
    def test_maps_filings(self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch) -> None:
        calls: dict[str, Any] = {}

        def get_filings(**kwargs: Any) -> FakeFilings:
            calls.update(kwargs)
            return FakeFilings(
                [
                    entity_filing("0000320193-24-000123", "10-K", "aapl-20240928.htm"),
                    entity_filing("0000320193-23-000106", "10-K", "", report=""),
                    entity_filing("0000320193-22-000108", "10-K", "x.htm"),
                ]
            )

        monkeypatch.setattr(edgar, "Company", lambda cik: SimpleNamespace(get_filings=get_filings))
        out = sc.get_filings(320193, "10-K", 2)
        assert calls == {"form": "10-K"}
        assert [f.accession for f in out] == ["0000320193-24-000123", "0000320193-23-000106"]
        assert out[0].primary_document_url.endswith("/000032019324000123/aapl-20240928.htm")
        assert out[0].period_of_report == date(2024, 9, 28)
        assert out[1].period_of_report is None
        assert out[1].primary_document_url.endswith("-index.html")


class FakeStatement:
    def __init__(self, df: pd.DataFrame) -> None:
        self.df = df
        self.kwargs: dict[str, Any] = {}

    def to_dataframe(self, **kwargs: Any) -> pd.DataFrame:
        self.kwargs = kwargs
        return self.df


def fake_xbrl(stmt: FakeStatement | None, period_end: str | None = "2024-09-28") -> Any:
    return SimpleNamespace(
        statements=SimpleNamespace(
            income_statement=lambda: stmt,
            balance_sheet=lambda: stmt,
            cash_flow_statement=lambda: stmt,
        ),
        period_of_report=period_end,
        reporting_periods=[
            {"key": "instant_2024-09-28"},
            {"key": "duration_2023-10-01_2024-09-28"},
            {"key": "duration_2024-06-30_2024-09-28"},
        ],
        entity_info={"fiscal_year": 2024, "fiscal_period": "FY"},
    )


class TestStatementFilings:
    def _patch(self, monkeypatch: pytest.MonkeyPatch, xb: Any) -> None:
        filings = FakeFilings([entity_filing("0000320193-24-000123", "10-K", "a.htm")])
        monkeypatch.setattr(
            edgar, "Company", lambda cik: SimpleNamespace(get_filings=lambda **kw: filings)
        )
        monkeypatch.setattr(sec_client.XBRL, "from_filing", staticmethod(lambda f: xb))

    def test_builds_column_with_provenance(
        self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        df = pd.DataFrame(
            [
                {
                    "concept": "us-gaap_Revenues",
                    "label": "Revenue",
                    "standard_concept": "Revenue",
                    "unit": "usd",
                    "2024-09-28 (FY)": 391035000000,
                    "abstract": False,
                    "dimension": False,
                }
            ]
        )
        stmt = FakeStatement(df)
        self._patch(monkeypatch, fake_xbrl(stmt))
        [fs] = sc.get_statement_filings(320193, "income", "annual", 4)
        assert fs.accession == "0000320193-24-000123"
        assert fs.form == "10-K"
        assert fs.filed == date(2024, 11, 1)
        assert fs.period_start == date(2023, 10, 1)
        assert fs.period_end == date(2024, 9, 28)
        assert fs.fiscal_year == 2024
        assert fs.rows[0].concept == "us-gaap:Revenues"
        assert fs.rows[0].value == 391035000000.0
        assert stmt.kwargs["period_filter"] == "duration_2023-10-01_2024-09-28"
        assert stmt.kwargs["presentation"] is False

    def test_no_xbrl_is_provenance_error(
        self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._patch(monkeypatch, None)
        with pytest.raises(ProvenanceError):
            sc.get_statement_filings(320193, "income", "annual", 4)

    def test_no_matching_period_is_provenance_error(
        self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._patch(monkeypatch, fake_xbrl(FakeStatement(pd.DataFrame()), "2020-01-01"))
        with pytest.raises(ProvenanceError, match="no annual income period"):
            sc.get_statement_filings(320193, "income", "annual", 4)

    def test_missing_statement_is_upstream(
        self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._patch(monkeypatch, fake_xbrl(None))
        with pytest.raises(UpstreamError):
            sc.get_statement_filings(320193, "balance", "annual", 4)


class TestSections:
    def _filing(self, form: str) -> edgar.Filing:
        return edgar.Filing(
            cik=320193,
            company="Apple Inc.",
            form=form,
            filing_date="2024-11-01",
            accession_no="0000320193-24-000123",
        )

    def test_sections(self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch) -> None:
        filing = self._filing("10-K")
        sections = {
            "Item 1A": SimpleNamespace(title="Item 1A. Risk Factors", text=lambda: "Risky."),
            "Item 7": SimpleNamespace(title="", text=lambda: "   "),
        }
        report = SimpleNamespace(section=lambda name: sections.get(name))
        monkeypatch.setattr(edgar, "find", lambda acc: filing)
        monkeypatch.setattr(edgar.Filing, "obj", lambda self: report)
        monkeypatch.setattr(edgar.Filing, "filing_url", property(lambda self: "https://x/a.htm"))
        out = sc.get_sections("0000320193-24-000123", ["1", "1A", "7"])
        assert [(s.item, s.title, s.text, s.url) for s in out] == [
            ("1A", "Item 1A. Risk Factors", "Risky.", "https://x/a.htm")
        ]

    def test_not_found(self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(edgar, "find", lambda acc: None)
        with pytest.raises(NotFound):
            sc.get_sections("0000320193-24-000123", ["1"])

    def test_unsupported_form(self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch) -> None:
        filing = self._filing("8-K")
        monkeypatch.setattr(edgar, "find", lambda acc: filing)
        with pytest.raises(UnsupportedForm):
            sc.get_sections("0000320193-24-000123", ["1"])


class TestSearch:
    def test_maps_efts_results(self, sc: EdgarToolsClient, monkeypatch: pytest.MonkeyPatch) -> None:
        results = [
            edgar.EFTSResult(
                accession_number="0000320193-24-000123",
                form="10-K",
                filed="2024-11-01",
                company="Apple Inc.",
                cik="0000320193",
                document_id="aapl-20240928.htm",
            ),
            edgar.EFTSResult(
                accession_number="0000320193-23-000106", form="10-K", filed="2023-11-03"
            ),
        ]
        seen: dict[str, Any] = {}

        def search_filings(q: str, **kwargs: Any) -> list[Any]:
            seen.update(q=q, **kwargs)
            return results

        monkeypatch.setattr(edgar, "search_filings", search_filings)
        hits = sc.search("going concern", ["10-K"], 20)
        assert seen == {"q": "going concern", "forms": ["10-K"], "limit": 20}
        assert hits[0].cik == "0000320193"
        assert hits[0].url == (
            "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm"
        )
        assert hits[0].filed == date(2024, 11, 1)
        assert hits[1].cik is None
        assert hits[1].url == "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/"
        assert all(h.snippet is None for h in hits)
