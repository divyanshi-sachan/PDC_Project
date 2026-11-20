"""Pure assembly of multi-period statements from per-filing standardized statements.

Each column is the *current* period of exactly one filing (its 10-K or 10-Q), so every
column carries that filing's accession, form and filed date. edgartools' stitched
statements (``XBRLS``/``MultiFinancials``) do not record which filing a period came from,
so we stitch here instead.
"""

from __future__ import annotations

import math
import numbers
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from edgar_service.errors import ProvenanceError
from edgar_service.models import (
    Statement,
    StatementColumn,
    StatementKind,
    StatementLine,
    StatementPeriod,
)

ANNUAL_DAYS = (350, 380)
QUARTER_DAYS = (80, 100)


@dataclass(frozen=True, slots=True)
class StatementRow:
    concept: str
    label: str
    standard_concept: str | None
    unit: str | None
    value: float | None


@dataclass(slots=True)
class FilingStatement:
    """One filing's statement for one period, plus the filing's provenance."""

    accession: str | None
    form: str | None
    filed: date | None
    fiscal_year: int | None
    fiscal_period: str | None
    period_start: date | None
    period_end: date
    rows: list[StatementRow] = field(default_factory=list)


def parse_period_key(key: str) -> tuple[date | None, date]:
    """edgartools period keys: ``instant_YYYY-MM-DD`` or ``duration_START_END``."""
    parts = key.split("_")
    if parts[0] == "instant" and len(parts) == 2:
        return None, date.fromisoformat(parts[1])
    if parts[0] == "duration" and len(parts) == 3:
        return date.fromisoformat(parts[1]), date.fromisoformat(parts[2])
    raise ValueError(f"unrecognised period key {key!r}")


def select_period_key(
    period_keys: Iterable[str], period_end: date, kind: StatementKind, period: StatementPeriod
) -> str | None:
    """Pick the filing's own current period among the XBRL reporting periods.

    * balance: the instant at ``period_end``.
    * annual income/cashflow: the ~1-year duration ending at ``period_end``.
    * quarterly income/cashflow: the ~3-month duration ending at ``period_end``; if the
      filing has none (10-Q cash flows are usually year-to-date only) the longest duration
      ending there (YTD). The column's ``period_start`` makes that explicit.
    """
    keys = list(period_keys)
    if kind == "balance":
        wanted = f"instant_{period_end.isoformat()}"
        return wanted if wanted in keys else None

    durations: list[tuple[int, str]] = []
    for key in keys:
        if not key.startswith("duration_"):
            continue
        try:
            start, end = parse_period_key(key)
        except ValueError:
            continue
        if end == period_end and start is not None:
            durations.append(((end - start).days, key))
    if not durations:
        return None
    if period == "annual":
        annual = [d for d in durations if ANNUAL_DAYS[0] <= d[0] <= ANNUAL_DAYS[1]]
        return min(annual, key=lambda d: abs(d[0] - 365))[1] if annual else None
    quarter = [d for d in durations if QUARTER_DAYS[0] <= d[0] <= QUARTER_DAYS[1]]
    if quarter:
        return min(quarter, key=lambda d: abs(d[0] - 91))[1]
    return max(durations)[1]


def normalize_concept(concept: str) -> str:
    """edgartools writes ``us-gaap_Revenues``; the contract uses ``us-gaap:Revenues``."""
    if ":" in concept or "_" not in concept:
        return concept
    prefix, name = concept.split("_", 1)
    return f"{prefix}:{name}"


def _as_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, numbers.Real):  # includes numpy scalars from pandas records
        f = float(value)
        return None if math.isnan(f) else f
    return None


def rows_from_records(records: Iterable[Mapping[str, Any]], period_end: date) -> list[StatementRow]:
    """Convert ``Statement.to_dataframe(period_filter=...)`` records into rows.

    edgartools names the single value column after the period end date (``2024-09-28``
    or ``2024-09-28 (FY)``). Abstract headers, dimensional rows and non-numeric (text
    block) rows are dropped.
    """
    prefix = period_end.isoformat()
    rows: list[StatementRow] = []
    for rec in records:
        if rec.get("abstract") or rec.get("dimension"):
            continue
        column = next((k for k in rec if isinstance(k, str) and k.startswith(prefix)), None)
        raw = rec.get(column) if column else None
        value = _as_float(raw)
        if raw is not None and value is None and not _is_nan(raw):
            continue  # text or other non-numeric cell
        concept = str(rec.get("concept") or "")
        if not concept:
            continue
        unit = rec.get("unit")
        std = rec.get("standard_concept")
        rows.append(
            StatementRow(
                concept=normalize_concept(concept),
                label=str(rec.get("label") or concept),
                standard_concept=str(std) if isinstance(std, str) and std else None,
                unit=str(unit) if isinstance(unit, str) and unit else None,
                value=value,
            )
        )
    return rows


def _is_nan(value: Any) -> bool:
    return isinstance(value, float) and math.isnan(value)


def _column(fs: FilingStatement) -> StatementColumn:
    missing = [
        name
        for name, val in (("accession", fs.accession), ("form", fs.form), ("filed", fs.filed))
        if not val
    ]
    if missing or fs.accession is None or fs.form is None or fs.filed is None:
        raise ProvenanceError(
            f"statement column ending {fs.period_end.isoformat()} has no {', '.join(missing)}; "
            "refusing to return a value without provenance"
        )
    return StatementColumn(
        period_start=fs.period_start,
        period_end=fs.period_end,
        fiscal_year=fs.fiscal_year,
        fiscal_period=fs.fiscal_period,
        accession=fs.accession,
        form=fs.form,
        filed=fs.filed,
    )


def build_statement(
    cik: str, kind: StatementKind, period: StatementPeriod, filings: Sequence[FilingStatement]
) -> Statement:
    """Stitch per-filing statements into one, newest period first.

    Lines are keyed by (concept, label); their order follows the newest filing, with lines
    that only older filings report appended in the order first seen. If two filings cover
    the same period (e.g. an amendment), the later-filed one wins.
    Raises ProvenanceError if any filing lacks accession, form or filed date.
    """
    columns_by_period: dict[tuple[date | None, date], tuple[StatementColumn, FilingStatement]] = {}
    for fs in filings:
        col = _column(fs)
        pkey = (fs.period_start, fs.period_end)
        prev = columns_by_period.get(pkey)
        if prev is None or (col.filed, col.accession) > (prev[0].filed, prev[0].accession):
            columns_by_period[pkey] = (col, fs)
    ordered = sorted(columns_by_period.values(), key=lambda cf: cf[0].period_end, reverse=True)

    line_order: list[tuple[str, str]] = []
    meta: dict[tuple[str, str], StatementRow] = {}
    values: dict[tuple[str, str], list[float | None]] = {}
    for idx, (_, fs) in enumerate(ordered):
        for row in fs.rows:
            key = (row.concept, row.label)
            if key not in meta:
                meta[key] = row
                line_order.append(key)
                values[key] = [None] * len(ordered)
            elif meta[key].unit is None and row.unit is not None:
                meta[key] = row
            if values[key][idx] is None:
                values[key][idx] = row.value

    lines = [
        StatementLine(
            label=meta[k].label,
            concept=meta[k].concept,
            standard_concept=meta[k].standard_concept,
            unit=meta[k].unit,
            values=values[k],
        )
        for k in line_order
        if any(v is not None for v in values[k])
    ]
    return Statement(
        cik=cik, kind=kind, period=period, columns=[c for c, _ in ordered], lines=lines
    )
