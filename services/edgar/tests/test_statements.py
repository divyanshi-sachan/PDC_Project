from __future__ import annotations

from dataclasses import replace
from datetime import date

import numpy as np
import pytest

from edgar_service.errors import ProvenanceError
from edgar_service.statements import (
    FilingStatement,
    build_statement,
    normalize_concept,
    parse_period_key,
    rows_from_records,
    select_period_key,
)
from tests.conftest import statement_filings

END = date(2024, 9, 28)
KEYS_10K = [
    "instant_2024-09-28",
    "instant_2023-09-30",
    "duration_2023-10-01_2024-09-28",
    "duration_2022-09-25_2023-09-30",
    "duration_2024-06-30_2024-09-28",  # a Q4 also present in some 10-Ks
]
KEYS_10Q = [
    "instant_2024-06-29",
    "duration_2024-03-31_2024-06-29",  # 3 months
    "duration_2023-10-01_2024-06-29",  # 9 months YTD
    "duration_2023-04-02_2023-07-01",
]


class TestPeriodKeys:
    def test_parse(self) -> None:
        assert parse_period_key("instant_2024-09-28") == (None, END)
        assert parse_period_key("duration_2023-10-01_2024-09-28") == (date(2023, 10, 1), END)
        with pytest.raises(ValueError, match="unrecognised"):
            parse_period_key("forever")

    def test_balance_uses_instant(self) -> None:
        assert select_period_key(KEYS_10K, END, "balance", "annual") == "instant_2024-09-28"

    def test_annual_duration_ignores_quarter(self) -> None:
        want = "duration_2023-10-01_2024-09-28"
        assert select_period_key(KEYS_10K, END, "income", "annual") == want
        assert select_period_key(KEYS_10K, END, "cashflow", "annual") == want

    def test_quarterly_prefers_three_months(self) -> None:
        got = select_period_key(KEYS_10Q, date(2024, 6, 29), "income", "quarterly")
        assert got == "duration_2024-03-31_2024-06-29"

    def test_quarterly_cashflow_falls_back_to_ytd(self) -> None:
        keys = [k for k in KEYS_10Q if k != "duration_2024-03-31_2024-06-29"]
        got = select_period_key(keys, date(2024, 6, 29), "cashflow", "quarterly")
        assert got == "duration_2023-10-01_2024-06-29"

    def test_missing_returns_none(self) -> None:
        assert select_period_key(KEYS_10K, date(2020, 1, 1), "income", "annual") is None
        assert select_period_key(KEYS_10K, date(2020, 1, 1), "balance", "annual") is None
        assert select_period_key(KEYS_10Q, date(2024, 6, 29), "income", "annual") is None


class TestRowsFromRecords:
    def test_picks_value_column_and_skips_noise(self) -> None:
        records = [
            {"concept": "us-gaap_IncomeStatementAbstract", "label": "Income", "abstract": True},
            {
                "concept": "us-gaap_Revenues",
                "label": "Revenue",
                "standard_concept": "Revenue",
                "unit": "usd",
                "2024-09-28 (FY)": np.int64(391_035_000_000),
                "abstract": False,
                "dimension": False,
                "level": 1,
            },
            {
                "concept": "us-gaap_EarningsPerShareBasic",
                "label": "EPS",
                "standard_concept": None,
                "unit": "usdPerShare",
                "2024-09-28 (FY)": np.float64(6.11),
                "abstract": False,
                "dimension": False,
            },
            {"concept": "us-gaap_Other", "label": "Other", "2024-09-28 (FY)": float("nan")},
            {"concept": "us-gaap_Text", "label": "Policy", "2024-09-28 (FY)": "<p>text</p>"},
            {"concept": "us-gaap_Revenues", "label": "iPhone", "dimension": True, "2024-09-28": 1},
            {"concept": "", "label": "blank", "2024-09-28": 1.0},
        ]
        rows = rows_from_records(records, END)
        assert [r.concept for r in rows] == [
            "us-gaap:Revenues",
            "us-gaap:EarningsPerShareBasic",
            "us-gaap:Other",
        ]
        assert rows[0].value == 391_035_000_000.0
        assert isinstance(rows[0].value, float)
        assert rows[0].standard_concept == "Revenue"
        assert rows[1].value == pytest.approx(6.11)
        assert rows[1].standard_concept is None
        assert rows[2].value is None
        assert rows[2].unit is None

    def test_instant_column_name(self) -> None:
        rows = rows_from_records(
            [{"concept": "us-gaap_Assets", "label": "A", "2024-09-28": 5}], END
        )
        assert rows[0].value == 5.0

    def test_normalize_concept(self) -> None:
        assert normalize_concept("us-gaap_Revenues") == "us-gaap:Revenues"
        assert normalize_concept("aapl_CustomThing") == "aapl:CustomThing"
        assert normalize_concept("us-gaap:Revenues") == "us-gaap:Revenues"
        assert normalize_concept("NoPrefix") == "NoPrefix"


class TestBuildStatement:
    def test_columns_newest_first_with_provenance(self) -> None:
        st = build_statement("0001234567", "income", "annual", statement_filings())
        assert [c.period_end for c in st.columns] == [date(2024, 9, 30), date(2023, 9, 30)]
        assert [c.accession for c in st.columns] == ["0001234567-24-000050", "0001234567-23-000045"]
        for col in st.columns:
            assert col.accession
            assert col.form == "10-K"
            assert col.filed
            assert col.period_start is not None

    def test_lines_aligned_with_columns(self) -> None:
        st = build_statement("0001234567", "income", "annual", statement_filings())
        lines = {line.concept: line for line in st.lines}
        assert lines["us-gaap:Revenues"].values == [130e6, 120e6]
        assert lines["us-gaap:NetIncomeLoss"].values == [30e6, None]
        assert lines["us-gaap:OtherNonoperatingIncome"].values == [None, 1e6]
        # order follows the newest filing; older-only lines appended
        assert [line.concept for line in st.lines] == [
            "us-gaap:Revenues",
            "us-gaap:CostOfRevenue",
            "us-gaap:NetIncomeLoss",
            "us-gaap:OtherNonoperatingIncome",
        ]
        for line in st.lines:
            assert len(line.values) == len(st.columns)
            assert line.concept

    def test_all_empty_lines_dropped(self) -> None:
        filings = statement_filings()
        filings[0].rows.append(replace(filings[0].rows[0], concept="us-gaap:Empty", value=None))
        st = build_statement("0001234567", "income", "annual", filings)
        assert "us-gaap:Empty" not in {line.concept for line in st.lines}

    @pytest.mark.parametrize("field", ["accession", "form", "filed"])
    def test_missing_provenance_raises(self, field: str) -> None:
        filings = statement_filings()
        setattr(filings[1], field, None if field == "filed" else "")
        with pytest.raises(ProvenanceError, match=field):
            build_statement("0001234567", "income", "annual", filings)

    def test_duplicate_period_keeps_later_filing(self) -> None:
        filings = statement_filings()
        amended: FilingStatement = replace(
            filings[1], accession="0001234567-25-000001", form="10-K/A", filed=date(2025, 1, 15)
        )
        amended.rows = [replace(filings[1].rows[0], value=131e6)]
        st = build_statement("0001234567", "income", "annual", [*filings, amended])
        assert len(st.columns) == 2
        assert st.columns[0].accession == "0001234567-25-000001"
        assert st.columns[0].form == "10-K/A"
        revenue = next(line for line in st.lines if line.concept == "us-gaap:Revenues")
        assert revenue.values[0] == 131e6

    def test_empty(self) -> None:
        st = build_statement("0001234567", "balance", "quarterly", [])
        assert st.columns == []
        assert st.lines == []
