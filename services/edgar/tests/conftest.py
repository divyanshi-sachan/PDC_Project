"""Offline test setup: dummy identity, throwaway cache dir, sockets blocked, fake SEC client."""

from __future__ import annotations

import json
import os
import socket
import tempfile
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest

# Must be set before edgar_service (and therefore edgar) is imported.
os.environ.setdefault("SEC_USER_AGENT", "DealPilot tests noreply@example.com")
os.environ["EDGAR_CACHE_DIR"] = tempfile.mkdtemp(prefix="edgar-service-tests-")
os.environ.pop("EDGAR_SERVICE_KEY", None)

from fastapi.testclient import TestClient

from edgar_service.errors import NotFound, UpstreamError
from edgar_service.main import create_app
from edgar_service.models import Filing, SearchHit, Section
from edgar_service.sec_client import get_sec_client
from edgar_service.statements import FilingStatement, StatementRow

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text())
    return data


@pytest.fixture(autouse=True)
def _no_network(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    if request.node.get_closest_marker("live"):
        return

    def guard(*_: object, **__: object) -> None:
        raise RuntimeError("network access in an offline test")

    monkeypatch.setattr(socket.socket, "connect", guard)
    monkeypatch.setattr(socket, "create_connection", guard)


def statement_filings() -> list[FilingStatement]:
    """Two synthetic annual income statements (newest second, to test ordering)."""
    return [
        FilingStatement(
            accession="0001234567-23-000045",
            form="10-K",
            filed=date(2023, 11, 3),
            fiscal_year=2023,
            fiscal_period="FY",
            period_start=date(2022, 10, 1),
            period_end=date(2023, 9, 30),
            rows=[
                StatementRow("us-gaap:Revenues", "Revenue", "Revenue", "usd", 120e6),
                StatementRow(
                    "us-gaap:CostOfRevenue", "Cost of Revenue", "CostOfGoods", "usd", 70e6
                ),
                StatementRow("us-gaap:OtherNonoperatingIncome", "Other Income", None, "usd", 1e6),
            ],
        ),
        FilingStatement(
            accession="0001234567-24-000050",
            form="10-K",
            filed=date(2024, 11, 1),
            fiscal_year=2024,
            fiscal_period="FY",
            period_start=date(2023, 10, 1),
            period_end=date(2024, 9, 30),
            rows=[
                StatementRow("us-gaap:Revenues", "Revenue", "Revenue", "usd", 130e6),
                StatementRow(
                    "us-gaap:CostOfRevenue", "Cost of Revenue", "CostOfGoods", "usd", 75e6
                ),
                StatementRow("us-gaap:NetIncomeLoss", "Net Income", "NetIncome", "usd", 30e6),
            ],
        ),
    ]


class FakeSecClient:
    """Implements the SecClient protocol from fixtures; no edgartools, no network."""

    def __init__(self) -> None:
        self.submissions = load_fixture("submissions_example.json")
        self.companyfacts = load_fixture("companyfacts_example.json")
        self.tickers = {"EXMP": 1234567}
        self.fail_upstream = False
        self.statements: list[FilingStatement] = statement_filings()

    def _check(self) -> None:
        if self.fail_upstream:
            raise UpstreamError("SEC request failed (TransportError: 503 Service Unavailable)")

    def resolve_cik(self, ticker: str) -> int:
        self._check()
        try:
            return self.tickers[ticker.upper()]
        except KeyError:
            raise NotFound(f"unknown ticker {ticker!r}") from None

    def get_submissions(self, cik: int) -> dict[str, Any]:
        self._check()
        return self.submissions

    def get_company_facts(self, cik: int) -> dict[str, Any]:
        self._check()
        return self.companyfacts

    def get_filings(self, cik: int, form: str | None, limit: int) -> list[Filing]:
        self._check()
        recent = self.submissions["filings"]["recent"]
        out: list[Filing] = []
        for i, accession in enumerate(recent["accessionNumber"]):
            if form and recent["form"][i] != form:
                continue
            folder = accession.replace("-", "")
            out.append(
                Filing(
                    accession=accession,
                    form=recent["form"][i],
                    filed=date.fromisoformat(recent["filingDate"][i]),
                    period_of_report=date.fromisoformat(recent["reportDate"][i])
                    if recent["reportDate"][i]
                    else None,
                    primary_document_url=f"https://www.sec.gov/Archives/edgar/data/{cik}/{folder}/"
                    f"{recent['primaryDocument'][i]}",
                )
            )
        return out[:limit]

    def get_statement_filings(
        self, cik: int, kind: str, period: str, limit: int
    ) -> list[FilingStatement]:
        self._check()
        return self.statements[:limit]

    def get_sections(self, accession: str, items: list[str]) -> list[Section]:
        self._check()
        if accession != "0001234567-24-000050":
            raise NotFound(f"unknown accession {accession}")
        titles = {"1": "Item 1. Business", "1A": "Item 1A. Risk Factors"}
        url = "https://www.sec.gov/Archives/edgar/data/1234567/000123456724000050/exmp-20240930.htm"
        return [
            Section(accession=accession, item=i, title=titles[i], text=f"text of {i}", url=url)
            for i in items
            if i in titles
        ]

    def search(self, q: str, forms: list[str] | None, limit: int) -> list[SearchHit]:
        self._check()
        hit = SearchHit(
            accession="0001234567-24-000050",
            form="10-K",
            filed=date(2024, 11, 1),
            company="Example Corp",
            cik="0001234567",
            url="https://www.sec.gov/Archives/edgar/data/1234567/000123456724000050/exmp-20240930.htm",
            snippet=None,
        )
        return [hit][:limit]


@pytest.fixture
def fake() -> FakeSecClient:
    return FakeSecClient()


@pytest.fixture
def client(fake: FakeSecClient) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_sec_client] = lambda: fake
    with TestClient(app) as tc:
        yield tc
