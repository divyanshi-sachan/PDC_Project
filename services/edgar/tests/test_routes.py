"""Route tests: FastAPI TestClient with the SEC client replaced by FakeSecClient."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from edgar_service.statements import FilingStatement
from tests.conftest import FakeSecClient

PROVENANCE_FACT_FIELDS = ("accession", "form", "filed", "period_end", "concept", "unit")


def assert_error(resp_json: dict[str, object], code: str) -> None:
    assert set(resp_json) == {"error"}
    err = resp_json["error"]
    assert isinstance(err, dict)
    assert err["code"] == code
    assert isinstance(err["message"], str)
    assert err["message"]


class TestHealth:
    def test_health(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert int(body["edgartools_version"].split(".")[0]) >= 6


class TestCompany:
    def test_company(self, client: TestClient) -> None:
        resp = client.get("/companies/exmp")
        assert resp.status_code == 200
        assert resp.json() == {
            "cik": "0001234567",
            "ticker": "EXMP",
            "name": "Example Corp",
            "sic": "3571",
            "sic_description": "Electronic Computers",
            "fiscal_year_end": "0930",
            "exchanges": ["Nasdaq", "Nasdaq"],
        }

    def test_unknown_ticker_404(self, client: TestClient) -> None:
        resp = client.get("/companies/NOPE")
        assert resp.status_code == 404
        assert_error(resp.json(), "not_found")

    def test_invalid_ticker_422(self, client: TestClient) -> None:
        resp = client.get("/companies/bad$ticker")
        assert resp.status_code == 422
        assert_error(resp.json(), "validation_error")


class TestFilings:
    def test_filter_and_limit(self, client: TestClient) -> None:
        resp = client.get("/companies/EXMP/filings", params={"form": "10-K", "limit": 1})
        assert resp.status_code == 200
        [filing] = resp.json()
        assert filing == {
            "accession": "0001234567-24-000050",
            "form": "10-K",
            "filed": "2024-11-01",
            "period_of_report": "2024-09-30",
            "primary_document_url": "https://www.sec.gov/Archives/edgar/data/1234567/"
            "000123456724000050/exmp-20240930.htm",
        }

    def test_limit_bounds(self, client: TestClient) -> None:
        assert client.get("/companies/EXMP/filings", params={"limit": 0}).status_code == 422
        assert client.get("/companies/EXMP/filings", params={"limit": 101}).status_code == 422


class TestFacts:
    def test_deduped(self, client: TestClient) -> None:
        resp = client.get(
            "/companies/EXMP/facts", params={"concept": "us-gaap:Revenues", "form": "10-K"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["cik"] == "0001234567"
        assert body["concept"] == "us-gaap:Revenues"
        assert len(body["facts"]) == 3
        fy22 = body["facts"][0]
        assert fy22["period_start"] == "2021-10-01"
        assert fy22["period_end"] == "2022-09-30"
        assert fy22["value"] == 105e6
        assert fy22["restated"] is True
        assert fy22["original_value"] == 100e6

    def test_all_versions(self, client: TestClient) -> None:
        resp = client.get(
            "/companies/EXMP/facts",
            params={"concept": "us-gaap:Revenues", "form": "10-K", "all_versions": "true"},
        )
        assert resp.status_code == 200
        assert len(resp.json()["facts"]) == 7

    def test_bare_concept_normalized(self, client: TestClient) -> None:
        resp = client.get("/companies/EXMP/facts", params={"concept": "Assets"})
        assert resp.json()["concept"] == "us-gaap:Assets"
        assert all(f["period_start"] is None for f in resp.json()["facts"])

    @pytest.mark.parametrize("all_versions", ["false", "true"])
    def test_every_fact_has_provenance(self, client: TestClient, all_versions: str) -> None:
        for concept in ("us-gaap:Revenues", "us-gaap:Assets", "us-gaap:EarningsPerShareBasic"):
            resp = client.get(
                "/companies/EXMP/facts", params={"concept": concept, "all_versions": all_versions}
            )
            assert resp.status_code == 200
            facts = resp.json()["facts"]
            assert facts
            for fact in facts:
                for field in PROVENANCE_FACT_FIELDS:
                    assert fact[field], f"{concept} fact missing {field}: {fact}"
                assert "period_start" in fact

    def test_unknown_concept_404(self, client: TestClient) -> None:
        resp = client.get("/companies/EXMP/facts", params={"concept": "us-gaap:Nope"})
        assert resp.status_code == 404
        assert_error(resp.json(), "not_found")

    def test_concept_required(self, client: TestClient) -> None:
        resp = client.get("/companies/EXMP/facts")
        assert resp.status_code == 422
        assert_error(resp.json(), "validation_error")

    def test_unknown_ticker_404(self, client: TestClient) -> None:
        resp = client.get("/companies/NOPE/facts", params={"concept": "us-gaap:Revenues"})
        assert resp.status_code == 404


class TestStatements:
    def test_income(self, client: TestClient) -> None:
        resp = client.get("/companies/EXMP/statements", params={"kind": "income"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["cik"] == "0001234567"
        assert body["kind"] == "income"
        assert body["period"] == "annual"
        assert [c["period_end"] for c in body["columns"]] == ["2024-09-30", "2023-09-30"]

    def test_every_column_and_line_has_provenance(self, client: TestClient) -> None:
        body = client.get("/companies/EXMP/statements", params={"kind": "income"}).json()
        assert body["columns"]
        for col in body["columns"]:
            for field in ("accession", "form", "filed", "period_end"):
                assert col[field], f"column missing {field}"
        for line in body["lines"]:
            assert line["concept"]
            assert line["label"]
            assert len(line["values"]) == len(body["columns"])

    def test_missing_accession_is_an_error_not_a_dropped_column(
        self, client: TestClient, fake: FakeSecClient
    ) -> None:
        fake.statements.append(
            FilingStatement(
                accession=None,
                form="10-K",
                filed=date(2022, 11, 4),
                fiscal_year=2022,
                fiscal_period="FY",
                period_start=date(2021, 10, 1),
                period_end=date(2022, 9, 30),
            )
        )
        resp = client.get("/companies/EXMP/statements", params={"kind": "income"})
        assert resp.status_code == 502
        assert_error(resp.json(), "provenance_missing")

    @pytest.mark.parametrize(
        "params", [{"kind": "equity"}, {"kind": "income", "period": "monthly"}, {}]
    )
    def test_invalid_params(self, client: TestClient, params: dict[str, str]) -> None:
        resp = client.get("/companies/EXMP/statements", params=params)
        assert resp.status_code == 422
        assert_error(resp.json(), "validation_error")


class TestSections:
    def test_sections(self, client: TestClient) -> None:
        resp = client.get("/filings/0001234567-24-000050/sections", params={"items": "1, 1a,7"})
        assert resp.status_code == 200
        body = resp.json()
        assert [s["item"] for s in body] == ["1", "1A"]
        for s in body:
            assert s["accession"] == "0001234567-24-000050"
            assert s["url"].startswith("https://www.sec.gov/Archives/")

    def test_bad_accession_format(self, client: TestClient) -> None:
        assert client.get("/filings/12345/sections").status_code == 422

    def test_bad_items(self, client: TestClient) -> None:
        resp = client.get("/filings/0001234567-24-000050/sections", params={"items": "1,DROP"})
        assert resp.status_code == 422
        assert_error(resp.json(), "validation_error")

    def test_unknown_accession_404(self, client: TestClient) -> None:
        resp = client.get("/filings/0009999999-24-000001/sections")
        assert resp.status_code == 404
        assert_error(resp.json(), "not_found")

    def test_no_items_found_404(self, client: TestClient) -> None:
        resp = client.get("/filings/0001234567-24-000050/sections", params={"items": "9B"})
        assert resp.status_code == 404


class TestSearch:
    def test_search(self, client: TestClient) -> None:
        resp = client.get("/search", params={"q": "going concern", "forms": "10-K", "limit": 5})
        assert resp.status_code == 200
        [hit] = resp.json()
        assert hit["accession"] == "0001234567-24-000050"
        assert hit["snippet"] is None

    def test_q_required(self, client: TestClient) -> None:
        assert client.get("/search").status_code == 422


class TestUpstreamErrors:
    @pytest.mark.parametrize(
        ("path", "params"),
        [
            ("/companies/EXMP", {}),
            ("/companies/EXMP/filings", {}),
            ("/companies/EXMP/facts", {"concept": "us-gaap:Revenues"}),
            ("/companies/EXMP/statements", {"kind": "balance"}),
            ("/filings/0001234567-24-000050/sections", {}),
            ("/search", {"q": "x"}),
        ],
    )
    def test_502(
        self, client: TestClient, fake: FakeSecClient, path: str, params: dict[str, str]
    ) -> None:
        fake.fail_upstream = True
        resp = client.get(path, params=params)
        assert resp.status_code == 502
        assert_error(resp.json(), "upstream_error")

    def test_health_unaffected(self, client: TestClient, fake: FakeSecClient) -> None:
        fake.fail_upstream = True
        assert client.get("/health").status_code == 200
