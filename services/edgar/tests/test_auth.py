from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

PROTECTED = [
    ("/companies/EXMP", {}),
    ("/companies/EXMP/filings", {}),
    ("/companies/EXMP/facts", {"concept": "us-gaap:Revenues"}),
    ("/companies/EXMP/statements", {"kind": "income"}),
    ("/filings/0001234567-24-000050/sections", {}),
    ("/search", {"q": "x"}),
]


@pytest.fixture
def keyed(monkeypatch: pytest.MonkeyPatch) -> str:
    key = "test-key-123"
    monkeypatch.setenv("EDGAR_SERVICE_KEY", key)
    return key


class TestAuthEnabled:
    @pytest.mark.parametrize(("path", "params"), PROTECTED)
    def test_missing_header_401(
        self, client: TestClient, keyed: str, path: str, params: dict[str, str]
    ) -> None:
        resp = client.get(path, params=params)
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "unauthorized"

    @pytest.mark.parametrize(("path", "params"), PROTECTED)
    def test_wrong_header_401(
        self, client: TestClient, keyed: str, path: str, params: dict[str, str]
    ) -> None:
        resp = client.get(path, params=params, headers={"X-Service-Key": "wrong"})
        assert resp.status_code == 401

    @pytest.mark.parametrize(("path", "params"), PROTECTED)
    def test_correct_header_ok(
        self, client: TestClient, keyed: str, path: str, params: dict[str, str]
    ) -> None:
        resp = client.get(path, params=params, headers={"X-Service-Key": keyed})
        assert resp.status_code == 200

    def test_auth_checked_before_upstream(self, client: TestClient, keyed: str) -> None:
        # unknown ticker without a key must still be 401, not 404
        assert client.get("/companies/NOPE").status_code == 401

    def test_health_is_open(self, client: TestClient, keyed: str) -> None:
        assert client.get("/health").status_code == 200


class TestAuthDisabled:
    @pytest.mark.parametrize(("path", "params"), PROTECTED)
    def test_no_key_configured_allows_all(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, path: str, params: dict[str, str]
    ) -> None:
        monkeypatch.delenv("EDGAR_SERVICE_KEY", raising=False)
        assert client.get(path, params=params).status_code == 200

    def test_empty_key_means_disabled(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EDGAR_SERVICE_KEY", "")
        assert client.get("/companies/EXMP").status_code == 200


def test_openapi_declares_header(client: TestClient) -> None:
    spec = client.get("/openapi.json").json()
    schemes = spec["components"]["securitySchemes"]
    assert any(s.get("name") == "X-Service-Key" for s in schemes.values())
    assert "security" not in spec["paths"]["/health"]["get"]
    assert "security" in spec["paths"]["/companies/{ticker}"]["get"]
