"""Process configuration for edgartools.

edgartools builds its HTTP manager (cache directory + rate limiter) when ``edgar`` is
first imported, so these environment variables must be in place before that import.
``edgar_service/__init__.py`` calls :func:`configure_edgar_env` for exactly that reason.
"""

from __future__ import annotations

import os
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[2]
"""``services/edgar`` (the directory holding pyproject.toml)."""

DEFAULT_CACHE_DIR = "../../data/cache/edgar"
MAX_SEC_REQUESTS_PER_SEC = 10
DEFAULT_SEC_REQUESTS_PER_SEC = 9


def resolve_cache_dir(raw: str | None = None) -> Path:
    """Resolve ``EDGAR_CACHE_DIR``; relative paths are relative to the service root."""
    value = raw if raw is not None else os.environ.get("EDGAR_CACHE_DIR", DEFAULT_CACHE_DIR)
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = SERVICE_ROOT / path
    return path.resolve()


def resolve_rate_limit(raw: str | None = None) -> int:
    """SEC requests per second; edgartools enforces it. Must be 1..10 (SEC fair-access cap)."""
    value = raw if raw is not None else os.environ.get("EDGAR_RATE_LIMIT_PER_SEC")
    if value is None or value.strip() == "":
        return DEFAULT_SEC_REQUESTS_PER_SEC
    rate = int(value)
    if not 1 <= rate <= MAX_SEC_REQUESTS_PER_SEC:
        raise ValueError(
            f"EDGAR_RATE_LIMIT_PER_SEC must be between 1 and {MAX_SEC_REQUESTS_PER_SEC}, got {rate}"
        )
    return rate


def configure_edgar_env() -> Path:
    """Point edgartools at our cache dir and rate limit. Must run before ``import edgar``.

    * ``EDGAR_LOCAL_DATA_DIR`` is edgartools' data root; its HTTP cache lives in
      ``<root>/_tcache`` (``edgar.httpclient.get_cache_directory``).
    * ``EDGAR_RATE_LIMIT_PER_SEC`` feeds edgartools' process-wide pyrate-limiter, which
      every edgartools request (submissions, companyfacts, archives, EFTS) goes through.
    """
    cache_dir = resolve_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ["EDGAR_LOCAL_DATA_DIR"] = str(cache_dir)
    os.environ["EDGAR_RATE_LIMIT_PER_SEC"] = str(resolve_rate_limit())
    return cache_dir
