from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from edgar_service.xbrl_facts import (
    ConceptNotFoundError,
    RawVersion,
    dedupe_versions,
    extract_facts,
    form_matches,
    group_versions,
    split_concept,
)
from tests.conftest import load_fixture


@pytest.fixture
def companyfacts() -> dict[str, Any]:
    return load_fixture("companyfacts_example.json")


def v(
    end: str,
    val: float,
    accn: str,
    filed: str,
    *,
    start: str | None = "2023-01-01",
    unit: str = "USD",
    form: str = "10-K",
    fy: int | None = 2023,
    fp: str | None = "FY",
    frame: str | None = None,
) -> RawVersion:
    return RawVersion(
        unit=unit,
        period_start=date.fromisoformat(start) if start else None,
        period_end=date.fromisoformat(end),
        value=val,
        accession=accn,
        form=form,
        filed=date.fromisoformat(filed),
        fiscal_year=fy,
        fiscal_period=fp,
        frame=frame,
    )


class TestSplitConcept:
    def test_prefixed(self) -> None:
        assert split_concept("us-gaap:Revenues") == ("us-gaap", "Revenues")
        assert split_concept("dei:EntityCommonStockSharesOutstanding")[0] == "dei"

    def test_bare_defaults_to_us_gaap(self) -> None:
        assert split_concept("Revenues") == ("us-gaap", "Revenues")

    @pytest.mark.parametrize("bad", [":Revenues", "us-gaap:"])
    def test_invalid(self, bad: str) -> None:
        with pytest.raises(ValueError, match="invalid concept"):
            split_concept(bad)


class TestFormMatches:
    @pytest.mark.parametrize(
        ("form", "wanted", "ok"),
        [
            ("10-K", None, True),
            ("10-K", "10-K", True),
            ("10-K/A", "10-K", True),
            ("10-k", "10-K", True),
            ("10-Q", "10-K", False),
            ("10-KT", "10-K", False),
            ("10-K", "10-K/A", False),
        ],
    )
    def test_matrix(self, form: str, wanted: str | None, ok: bool) -> None:
        assert form_matches(form, wanted) is ok


class TestDedupePure:
    def test_single_version_not_restated(self) -> None:
        [fact] = dedupe_versions("us-gaap:X", "X", [v("2023-12-31", 10, "a-1", "2024-02-01")])
        assert fact.value == 10
        assert fact.restated is False
        assert fact.original_value is None

    def test_latest_filed_wins_and_original_kept(self) -> None:
        versions = [
            v("2023-12-31", 12, "a-3", "2025-02-01", fy=2024),
            v("2023-12-31", 10, "a-1", "2024-02-01", fy=2023),
            v("2023-12-31", 11, "a-2", "2024-06-01", fy=2023, form="10-K/A"),
        ]
        [fact] = dedupe_versions("us-gaap:X", "X", versions)
        assert fact.value == 12
        assert fact.accession == "a-3"
        assert fact.filed == date(2025, 2, 1)
        assert fact.restated is True
        assert fact.original_value == 10
        # fy/fp come from the first filing that reported the period, not the restating one
        assert fact.fiscal_year == 2023

    def test_restated_then_reverted_is_not_restated(self) -> None:
        versions = [
            v("2023-12-31", 10, "a-1", "2024-02-01"),
            v("2023-12-31", 11, "a-2", "2024-06-01"),
            v("2023-12-31", 10, "a-3", "2025-02-01"),
        ]
        [fact] = dedupe_versions("us-gaap:X", "X", versions)
        assert fact.value == 10
        assert fact.accession == "a-3"
        assert fact.restated is False
        assert fact.original_value is None

    def test_same_value_repeated_is_not_restated(self) -> None:
        versions = [
            v("2023-12-31", 10, "a-1", "2024-02-01"),
            v("2023-12-31", 10, "a-2", "2025-02-01"),
        ]
        [fact] = dedupe_versions("us-gaap:X", "X", versions)
        assert fact.accession == "a-2"
        assert fact.restated is False

    def test_same_day_tie_broken_by_accession(self) -> None:
        versions = [
            v("2023-12-31", 11, "a-2", "2024-02-01"),
            v("2023-12-31", 10, "a-1", "2024-02-01"),
        ]
        [fact] = dedupe_versions("us-gaap:X", "X", versions)
        assert fact.accession == "a-2"
        assert fact.original_value == 10

    def test_grouping_separates_periods_units_and_instant_vs_duration(self) -> None:
        versions = [
            v("2023-12-31", 1, "a", "2024-02-01", start="2023-01-01"),  # FY duration
            v("2023-12-31", 2, "a", "2024-02-01", start="2023-10-01"),  # Q4 duration
            v("2023-12-31", 3, "a", "2024-02-01", start=None),  # instant
            v("2023-12-31", 4, "a", "2024-02-01", start=None, unit="EUR"),
        ]
        groups = group_versions(versions)
        assert len(groups) == 4
        facts = dedupe_versions("us-gaap:X", "X", versions)
        assert sorted(f.value for f in facts) == [1, 2, 3, 4]
        assert all(not f.restated for f in facts)

    def test_instant_fact_has_null_start(self) -> None:
        [fact] = dedupe_versions(
            "us-gaap:X", "X", [v("2023-12-31", 1, "a", "2024-01-01", start=None)]
        )
        assert fact.period_start is None
        assert fact.period_end == date(2023, 12, 31)

    def test_exact_duplicate_rows_collapse(self) -> None:
        row = v("2023-12-31", 10, "a-1", "2024-02-01")
        assert len(dedupe_versions("us-gaap:X", "X", [row, row], all_versions=True)) == 1

    def test_all_versions_returns_each_with_flags(self) -> None:
        versions = [
            v("2023-12-31", 10, "a-1", "2024-02-01"),
            v("2023-12-31", 10, "a-2", "2024-06-01"),
            v("2023-12-31", 12, "a-3", "2025-02-01"),
        ]
        facts = dedupe_versions("us-gaap:X", "X", versions, all_versions=True)
        assert [f.accession for f in facts] == ["a-1", "a-2", "a-3"]
        assert [f.restated for f in facts] == [False, False, True]
        assert [f.original_value for f in facts] == [None, None, 10]

    def test_frame_prefers_latest_non_null(self) -> None:
        versions = [
            v("2023-12-31", 10, "a-1", "2024-02-01", frame="CY2023"),
            v("2023-12-31", 10, "a-2", "2025-02-01"),
        ]
        [fact] = dedupe_versions("us-gaap:X", "X", versions)
        assert fact.frame == "CY2023"

    def test_output_sorted_by_period(self) -> None:
        versions = [
            v("2024-12-31", 2, "b", "2025-02-01", start="2024-01-01"),
            v("2023-12-31", 1, "a", "2024-02-01", start="2023-01-01"),
        ]
        facts = dedupe_versions("us-gaap:X", "X", versions)
        assert [f.period_end.year for f in facts] == [2023, 2024]

    def test_empty(self) -> None:
        assert dedupe_versions("us-gaap:X", "X", []) == []


class TestExtractFromCompanyFacts:
    def test_revenues_10k_deduped(self, companyfacts: dict[str, Any]) -> None:
        facts = extract_facts(companyfacts, "us-gaap:Revenues", form="10-K")
        by_end = {f.period_end: f for f in facts}
        assert set(by_end) == {date(2022, 9, 30), date(2023, 9, 30), date(2024, 9, 30)}

        fy22 = by_end[date(2022, 9, 30)]
        assert fy22.value == 105e6
        assert fy22.restated is True
        assert fy22.original_value == 100e6
        assert fy22.accession == "0001234567-24-000050"
        assert fy22.fiscal_year == 2022
        assert fy22.frame == "CY2022"

        fy23 = by_end[date(2023, 9, 30)]
        assert fy23.value == 121e6
        assert fy23.restated is True
        assert fy23.original_value == 120e6
        assert fy23.accession == "0001234567-24-000050"

        fy24 = by_end[date(2024, 9, 30)]
        assert fy24.value == 130e6
        assert fy24.restated is False
        assert fy24.original_value is None

    def test_form_filter_excludes_10q(self, companyfacts: dict[str, Any]) -> None:
        facts = extract_facts(companyfacts, "us-gaap:Revenues", form="10-K")
        assert all(f.form in {"10-K", "10-K/A"} for f in facts)
        q = extract_facts(companyfacts, "us-gaap:Revenues", form="10-Q")
        assert len(q) == 1
        assert q[0].fiscal_period == "Q1"
        assert q[0].period_start == date(2023, 10, 1)

    def test_form_filter_includes_amendment(self, companyfacts: dict[str, Any]) -> None:
        facts = extract_facts(companyfacts, "us-gaap:Revenues", form="10-K", all_versions=True)
        assert "10-K/A" in {f.form for f in facts}

    def test_all_versions(self, companyfacts: dict[str, Any]) -> None:
        facts = extract_facts(companyfacts, "us-gaap:Revenues", form="10-K", all_versions=True)
        fy23 = [f for f in facts if f.period_end == date(2023, 9, 30)]
        # 4 rows in the fixture, one exact duplicate -> 3 versions
        assert [f.value for f in fy23] == [120e6, 121e6, 121e6]
        assert [f.restated for f in fy23] == [False, True, True]

    def test_no_form_filter_mixes_forms_but_not_periods(self, companyfacts: dict[str, Any]) -> None:
        facts = extract_facts(companyfacts, "Revenues")
        assert len(facts) == 4
        assert {f.concept for f in facts} == {"us-gaap:Revenues"}

    def test_instant_concept(self, companyfacts: dict[str, Any]) -> None:
        facts = extract_facts(companyfacts, "us-gaap:Assets")
        assert [f.period_start for f in facts] == [None, None]
        assert facts[0].accession == "0001234567-24-000050"
        assert facts[0].restated is False

    def test_null_fy_and_ratio_unit(self, companyfacts: dict[str, Any]) -> None:
        [eps] = extract_facts(companyfacts, "us-gaap:EarningsPerShareBasic")
        assert eps.unit == "USD/shares"
        assert eps.fiscal_year is None
        assert eps.fiscal_period is None
        assert eps.value == pytest.approx(1.23)

    def test_dei_taxonomy(self, companyfacts: dict[str, Any]) -> None:
        [f] = extract_facts(companyfacts, "dei:EntityCommonStockSharesOutstanding")
        assert f.unit == "shares"
        assert f.concept == "dei:EntityCommonStockSharesOutstanding"

    @pytest.mark.parametrize("concept", ["us-gaap:NoSuchThing", "ifrs-full:Revenue"])
    def test_unknown_concept(self, companyfacts: dict[str, Any], concept: str) -> None:
        with pytest.raises(ConceptNotFoundError):
            extract_facts(companyfacts, concept)

    def test_every_fact_has_provenance(self, companyfacts: dict[str, Any]) -> None:
        for taxonomy, concepts in companyfacts["facts"].items():
            for name in concepts:
                for all_versions in (False, True):
                    for f in extract_facts(
                        companyfacts, f"{taxonomy}:{name}", all_versions=all_versions
                    ):
                        assert f.accession
                        assert f.form
                        assert f.filed
                        assert f.period_end
                        assert f.unit
                        assert f.concept == f"{taxonomy}:{name}"
