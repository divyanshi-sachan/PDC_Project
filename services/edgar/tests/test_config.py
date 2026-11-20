from __future__ import annotations

import os
from pathlib import Path

import edgar
import pytest

from edgar_service.config import SERVICE_ROOT, resolve_cache_dir, resolve_rate_limit
from edgar_service.deps import MissingIdentityError, configure_identity
from edgar_service.main import create_app
from tests.conftest import load_fixture


class TestCacheDir:
    def test_default_is_repo_data_cache(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("EDGAR_CACHE_DIR", raising=False)
        assert resolve_cache_dir() == (SERVICE_ROOT / "../../data/cache/edgar").resolve()
        assert resolve_cache_dir().parts[-3:] == ("data", "cache", "edgar")

    def test_relative_is_relative_to_service_root(self) -> None:
        assert resolve_cache_dir("cache") == SERVICE_ROOT / "cache"

    def test_absolute(self, tmp_path: Path) -> None:
        assert resolve_cache_dir(str(tmp_path)) == tmp_path.resolve()

    def test_edgartools_points_at_it(self) -> None:
        # conftest sets EDGAR_CACHE_DIR before edgar is imported
        expected = resolve_cache_dir(os.environ["EDGAR_CACHE_DIR"])
        assert os.environ["EDGAR_LOCAL_DATA_DIR"] == str(expected)
        from edgar.httpclient import get_cache_directory

        assert Path(get_cache_directory()).parent == expected


class TestRateLimit:
    def test_default(self) -> None:
        assert resolve_rate_limit("") == 9

    @pytest.mark.parametrize("ok", ["1", "9", "10"])
    def test_ok(self, ok: str) -> None:
        assert resolve_rate_limit(ok) == int(ok)

    @pytest.mark.parametrize("bad", ["0", "11", "100"])
    def test_rejects_over_sec_cap(self, bad: str) -> None:
        with pytest.raises(ValueError, match="between 1 and 10"):
            resolve_rate_limit(bad)

    def test_edgartools_limiter_configured(self) -> None:
        from edgar.httpclient import get_edgar_rate_limit_per_sec

        assert get_edgar_rate_limit_per_sec() <= 10


class TestIdentity:
    def test_missing_fails_fast(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("SEC_USER_AGENT", raising=False)
        with pytest.raises(MissingIdentityError, match="SEC_USER_AGENT"):
            create_app()

    def test_blank_fails_fast(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SEC_USER_AGENT", "   ")
        with pytest.raises(MissingIdentityError):
            configure_identity()

    def test_sets_edgartools_identity(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SEC_USER_AGENT", "DealPilot unit test@example.com")
        configure_identity()
        assert edgar.get_identity() == "DealPilot unit test@example.com"


def test_fixtures_are_sec_shaped() -> None:
    cf = load_fixture("companyfacts_example.json")
    assert {"cik", "entityName", "facts"} <= set(cf)
    row = cf["facts"]["us-gaap"]["Revenues"]["units"]["USD"][0]
    assert {"start", "end", "val", "accn", "fy", "fp", "form", "filed"} <= set(row)
    sub = load_fixture("submissions_example.json")
    assert {"cik", "name", "tickers", "exchanges", "sic", "fiscalYearEnd", "filings"} <= set(sub)
