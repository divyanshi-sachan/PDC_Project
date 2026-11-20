"""Opt-in test against the real SEC API. Skipped by default (addopts: -m 'not live').

Run manually: SEC_USER_AGENT='Your Name you@example.com' uv run pytest -m live
"""

from __future__ import annotations

from datetime import date

import pytest

from edgar_service.sec_client import EdgarToolsClient
from edgar_service.xbrl_facts import extract_facts


@pytest.mark.live
def test_aapl_revenue_facts_live() -> None:
    sc = EdgarToolsClient()
    cik = sc.resolve_cik("AAPL")
    assert cik == 320193
    facts = extract_facts(
        sc.get_company_facts(cik),
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        form="10-K",
    )
    annual = [f for f in facts if f.period_start and (f.period_end - f.period_start).days > 350]
    assert annual
    fy2023 = next(f for f in annual if f.period_end == date(2023, 9, 30))
    assert fy2023.value == pytest.approx(383_285_000_000)
    assert all(f.accession and f.form and f.filed for f in facts)
