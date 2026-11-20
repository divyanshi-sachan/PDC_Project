"""DealPilot edgar-service: SEC EDGAR data over HTTP, backed by edgartools."""

from edgar_service.config import configure_edgar_env

# Must run before anything imports `edgar` (edgartools reads these at import time).
configure_edgar_env()
