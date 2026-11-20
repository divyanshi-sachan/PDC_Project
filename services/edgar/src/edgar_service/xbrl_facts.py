"""Pure XBRL fact extraction and dedupe over SEC ``companyfacts`` JSON.

The same (concept, unit, period) is reported again by every later filing that shows it as
a comparative. Rules (see .claude/skills/sec-edgar):

* group versions by (unit, period_start, period_end); instant facts have no start.
* keep the **latest-filed** version (captures restatements) ...
* ... but keep the **first-filed** value too: ``restated``/``original_value``.

No I/O here: callers pass the parsed companyfacts dict.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any

from edgar_service.models import XbrlFact

DEFAULT_TAXONOMY = "us-gaap"


class ConceptNotFoundError(LookupError):
    pass


@dataclass(frozen=True, slots=True)
class RawVersion:
    """One row of ``facts.<taxonomy>.<concept>.units.<unit>[]`` in companyfacts JSON."""

    unit: str
    period_start: date | None
    period_end: date
    value: float
    accession: str
    form: str
    filed: date
    fiscal_year: int | None
    fiscal_period: str | None
    frame: str | None

    @property
    def period_key(self) -> tuple[str, date | None, date]:
        return (self.unit, self.period_start, self.period_end)

    @property
    def order_key(self) -> tuple[date, str]:
        # filed date first; accession breaks same-day ties deterministically.
        return (self.filed, self.accession)


def split_concept(concept: str) -> tuple[str, str]:
    """``"us-gaap:Revenues"`` -> ``("us-gaap", "Revenues")``; bare names default to us-gaap."""
    if ":" in concept:
        taxonomy, name = concept.split(":", 1)
    else:
        taxonomy, name = DEFAULT_TAXONOMY, concept
    if not taxonomy or not name:
        raise ValueError(f"invalid concept {concept!r}")
    return taxonomy, name


def form_matches(form: str, wanted: str | None) -> bool:
    """Exact form match, also accepting its amendment (``10-K`` matches ``10-K/A``)."""
    if wanted is None:
        return True
    f, w = form.upper(), wanted.upper()
    return f == w or f == f"{w}/A"


def _opt_date(value: Any) -> date | None:
    return date.fromisoformat(value) if value else None


def parse_versions(units: Mapping[str, Iterable[Mapping[str, Any]]]) -> list[RawVersion]:
    out: list[RawVersion] = []
    for unit, rows in units.items():
        for row in rows:
            fy = row.get("fy")
            out.append(
                RawVersion(
                    unit=unit,
                    period_start=_opt_date(row.get("start")),
                    period_end=date.fromisoformat(row["end"]),
                    value=float(row["val"]),
                    accession=str(row["accn"]),
                    form=str(row["form"]),
                    filed=date.fromisoformat(row["filed"]),
                    fiscal_year=int(fy) if fy is not None else None,
                    fiscal_period=row.get("fp"),
                    frame=row.get("frame"),
                )
            )
    return out


def _unique(versions: Iterable[RawVersion]) -> list[RawVersion]:
    """Drop exact repeats (same filing, period, unit, value); keep the first occurrence."""
    seen: set[tuple[object, ...]] = set()
    out: list[RawVersion] = []
    for v in versions:
        key = (v.accession, v.unit, v.period_start, v.period_end, v.value)
        if key in seen:
            continue
        seen.add(key)
        out.append(v)
    return out


def group_versions(
    versions: Iterable[RawVersion],
) -> dict[tuple[str, date | None, date], list[RawVersion]]:
    """Group by (unit, period_start, period_end); each group sorted oldest-filed first."""
    groups: dict[tuple[str, date | None, date], list[RawVersion]] = {}
    for v in _unique(versions):
        groups.setdefault(v.period_key, []).append(v)
    for group in groups.values():
        group.sort(key=lambda v: v.order_key)
    return groups


def _to_fact(
    concept: str, label: str | None, chosen: RawVersion, group: list[RawVersion]
) -> XbrlFact:
    original = group[0]
    restated = chosen.value != original.value
    # SEC's fy/fp describe the *filing*, not the period: a FY2021 value repeated in the
    # FY2023 10-K carries fy=2023. The first filing to report a period is (almost always)
    # the one whose own period it is, so fy/fp come from the first-filed version.
    frame = next((v.frame for v in reversed(group) if v.frame), None)
    return XbrlFact(
        concept=concept,
        label=label,
        value=chosen.value,
        unit=chosen.unit,
        period_start=chosen.period_start,
        period_end=chosen.period_end,
        fiscal_year=original.fiscal_year,
        fiscal_period=original.fiscal_period,
        form=chosen.form,
        accession=chosen.accession,
        filed=chosen.filed,
        frame=frame,
        restated=restated,
        original_value=original.value if restated else None,
    )


def dedupe_versions(
    concept: str, label: str | None, versions: Iterable[RawVersion], *, all_versions: bool = False
) -> list[XbrlFact]:
    """Collapse versions to one fact per (unit, period), or return every version.

    * ``all_versions=False``: latest-filed per group; ``restated`` when it differs from
      the first-filed value, which is then ``original_value``.
    * ``all_versions=True``: every distinct reported version; each is flagged ``restated``
      (with ``original_value``) when its value differs from the group's first-filed value.

    Output is sorted by (period_end, period_start, unit, filed).
    """
    facts: list[XbrlFact] = []
    for group in group_versions(versions).values():
        chosen = group if all_versions else [group[-1]]
        facts.extend(_to_fact(concept, label, v, group) for v in chosen)
    facts.sort(key=lambda f: (f.period_end, f.period_start or date.min, f.unit, f.filed))
    return facts


def extract_facts(
    companyfacts: Mapping[str, Any],
    concept: str,
    *,
    form: str | None = None,
    all_versions: bool = False,
) -> list[XbrlFact]:
    """Facts for one concept from a companyfacts document, filtered by form, deduped.

    The form filter is applied *before* dedupe, so ``form=10-K`` compares 10-K/10-K/A
    versions only (a 10-K restating an earlier 10-K is the common restatement path).

    Raises ConceptNotFoundError if the taxonomy/concept is absent.
    """
    taxonomy, name = split_concept(concept)
    body = companyfacts.get("facts", {}).get(taxonomy, {}).get(name)
    if body is None:
        raise ConceptNotFoundError(f"concept {taxonomy}:{name} not reported by this company")
    versions = [v for v in parse_versions(body.get("units", {})) if form_matches(v.form, form)]
    return dedupe_versions(
        f"{taxonomy}:{name}", body.get("label"), versions, all_versions=all_versions
    )
