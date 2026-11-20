from __future__ import annotations

from edgar_service.submissions import company_from_submissions, format_cik
from tests.conftest import load_fixture


def test_format_cik() -> None:
    assert format_cik(320193) == "0000320193"
    assert format_cik("320193") == "0000320193"
    assert format_cik("0000320193") == "0000320193"


def test_company_from_fixture() -> None:
    c = company_from_submissions(load_fixture("submissions_example.json"), "exmpw")
    assert c.cik == "0001234567"
    assert c.ticker == "EXMPW"
    assert c.fiscal_year_end == "0930"
    assert c.sic == "3571"


def test_requested_ticker_not_listed_uses_sec_primary() -> None:
    c = company_from_submissions(load_fixture("submissions_example.json"), "1234567")
    assert c.ticker == "EXMP"


def test_sparse_submissions() -> None:
    c = company_from_submissions(
        {
            "cik": "42",
            "name": "Shell Co",
            "tickers": [],
            "exchanges": [None],
            "sic": "",
            "sicDescription": "",
            "fiscalYearEnd": "331",
        },
        "shel",
    )
    assert c.cik == "0000000042"
    assert c.ticker == "SHEL"
    assert c.sic is None
    assert c.sic_description is None
    assert c.fiscal_year_end == "0331"
    assert c.exchanges == []
