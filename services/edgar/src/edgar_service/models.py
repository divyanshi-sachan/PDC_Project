"""Pydantic v2 response models: the cross-language contract with the TypeScript client.

Field names are snake_case and stable. Changing a model changes the OpenAPI spec, so
regenerate ``openapi.json`` (``uv run python -m edgar_service.export_openapi``) and the TS
client (``pnpm gen:edgar``) in the same change.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

StatementKind = Literal["income", "balance", "cashflow"]
StatementPeriod = Literal["annual", "quarterly"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ErrorBody(_Model):
    code: str = Field(description="Machine-readable code, e.g. not_found, upstream_error")
    message: str


class ErrorResponse(_Model):
    error: ErrorBody


class Health(_Model):
    status: Literal["ok"]
    edgartools_version: str


class Company(_Model):
    cik: str = Field(pattern=r"^\d{10}$", description="10-digit zero-padded CIK")
    ticker: str
    name: str
    sic: str | None
    sic_description: str | None
    fiscal_year_end: str | None = Field(description="MMDD, e.g. 0927")
    exchanges: list[str]


class Filing(_Model):
    accession: str = Field(description="Accession number, 0000320193-24-000123")
    form: str
    filed: date
    period_of_report: date | None
    primary_document_url: str


class XbrlFact(_Model):
    """One reported XBRL value with full provenance (from SEC companyfacts)."""

    concept: str = Field(description="Prefixed concept, e.g. us-gaap:Revenues")
    label: str | None
    value: float
    unit: str = Field(description="XBRL unit as reported, e.g. USD, shares, USD/shares")
    period_start: date | None = Field(description="Null for instant (balance-sheet) facts")
    period_end: date
    fiscal_year: int | None = Field(
        description="Fiscal year of the filing that first reported this period (SEC fy)"
    )
    fiscal_period: str | None = Field(description="FY, Q1, Q2, Q3 (SEC fp)")
    form: str = Field(description="Form of the filing this value comes from")
    accession: str = Field(description="Accession of the filing this value comes from")
    filed: date = Field(description="Filing date of the filing this value comes from")
    frame: str | None = Field(description="SEC calendar frame, e.g. CY2023, CY2023Q4I")
    restated: bool = Field(description="True when a later filing changed the first-filed value")
    original_value: float | None = Field(description="First-filed value when restated, else null")


class FactsResponse(_Model):
    cik: str
    concept: str
    facts: list[XbrlFact]


class StatementColumn(_Model):
    """One period of a statement, taken from exactly one filing (its provenance)."""

    period_start: date | None
    period_end: date
    fiscal_year: int | None
    fiscal_period: str | None
    accession: str = Field(min_length=1)
    form: str = Field(min_length=1)
    filed: date


class StatementLine(_Model):
    label: str
    concept: str = Field(description="Concept as filed, e.g. us-gaap:Revenues")
    standard_concept: str | None = Field(description="edgartools standardized concept")
    unit: str | None = Field(description="Unit summary from edgartools, e.g. usd; null if unknown")
    values: list[float | None] = Field(description="Aligned with Statement.columns")


class Statement(_Model):
    cik: str
    kind: StatementKind
    period: StatementPeriod
    columns: list[StatementColumn]
    lines: list[StatementLine]


class Section(_Model):
    accession: str
    item: str = Field(description="10-K item number, e.g. 1A")
    title: str
    text: str
    url: str = Field(description="URL of the primary document the text was extracted from")


class SearchHit(_Model):
    accession: str
    form: str
    filed: date
    company: str | None
    cik: str | None
    url: str
    snippet: str | None = Field(description="EDGAR full-text search returns no snippets: null")
