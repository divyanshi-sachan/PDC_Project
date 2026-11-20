"""FastAPI app: ``uv run fastapi dev src/edgar_service/main.py --port 8100``."""

from __future__ import annotations

from importlib.metadata import version

from fastapi import FastAPI

from edgar_service.deps import configure_identity
from edgar_service.errors import install_error_handlers
from edgar_service.models import Health
from edgar_service.routes import companies, facts, filings, search, sections, statements


def edgartools_version() -> str:
    return version("edgartools")


def create_app() -> FastAPI:
    """Build the app. Fails fast (MissingIdentityError) when SEC_USER_AGENT is unset."""
    configure_identity()
    app = FastAPI(
        title="DealPilot edgar-service",
        version="0.1.0",
        description="SEC EDGAR filings, XBRL facts and standardized statements via edgartools. "
        "Every fact and statement column carries accession, form and filed date.",
    )
    install_error_handlers(app)

    @app.get("/health", response_model=Health, tags=["health"], operation_id="health")
    def health() -> Health:
        return Health(status="ok", edgartools_version=edgartools_version())

    for module in (companies, filings, facts, statements, sections, search):
        app.include_router(module.router)
    return app


app = create_app()
