# edgar-service

FastAPI wrapper around [edgartools](https://github.com/dgunning/edgartools) (v6) that serves SEC
EDGAR data to the DealPilot TypeScript backend. All SEC access in DealPilot goes through this service.
The Pydantic models in `src/edgar_service/models.py` are the cross-language contract, and
`openapi.json` is generated from them.

## Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health` | `{status, edgartools_version}` (no auth) |
| GET | `/companies/{ticker}` | `Company`: 10-digit CIK, name, SIC, fiscal year end (MMDD), exchanges |
| GET | `/companies/{ticker}/filings?form=10-K&limit=5` | `Filing[]`, newest first |
| GET | `/companies/{ticker}/facts?concept=us-gaap:Revenues&form=10-K&all_versions=false` | `FactsResponse`: XBRL facts deduped to the latest-filed value per period, with `restated` and `original_value` |
| GET | `/companies/{ticker}/statements?kind=income\|balance\|cashflow&period=annual\|quarterly&limit=4` | `Statement`: edgartools standardized lines, one column per 10-K/10-Q, each with its accession, form and filed date |
| GET | `/filings/{accession}/sections?items=1,1A,7,7A,8` | `Section[]`: 10-K item text (items the filing lacks are left out) |
| GET | `/search?q=...&forms=10-K&limit=20` | `SearchHit[]`: EDGAR full-text search (`snippet` is always null because EFTS returns none) |

Errors always come back as `{"error": {"code", "message"}}`:

- `401 unauthorized`: the key is missing or wrong.
- `404 not_found`: unknown ticker, concept or accession.
- `422 validation_error` / `unsupported_form`: the request is invalid.
- `502 upstream_error`: SEC or edgartools failed.
- `502 provenance_missing`: a statement column has no accession, form or filed date. The service returns this error instead of dropping the column.

Interactive docs are at `http://localhost:8100/docs`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SEC_USER_AGENT` | (required) | Passed to `edgar.set_identity`. Startup fails without it. |
| `EDGAR_SERVICE_KEY` | unset | When set, every route except `/health` requires the `X-Service-Key` header to match. |
| `EDGAR_CACHE_DIR` | `../../data/cache/edgar` | edgartools data and HTTP cache (`EDGAR_LOCAL_DATA_DIR`). A relative path is resolved against `services/edgar`. |
| `EDGAR_RATE_LIMIT_PER_SEC` | `9` | edgartools' process-wide limiter, between 1 and 10. Run a single worker. |

## Run

```bash
cd services/edgar
uv sync
SEC_USER_AGENT="DealPilot you@example.com" uv run fastapi dev src/edgar_service/main.py --port 8100
```

Docker (python:3.12-slim, runs as a non-root user, builds for amd64 and arm64):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t dealpilot/edgar-service services/edgar
docker run -p 8100:8100 -e SEC_USER_AGENT="DealPilot you@example.com" \
  -v edgar-cache:/data/cache/edgar dealpilot/edgar-service
```

## Develop

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src
uv run pytest -q                                 # offline; sockets are blocked
uv run python -m edgar_service.export_openapi    # rewrites openapi.json; then run `pnpm gen:edgar`
```

`tests/test_live.py` is marked `@pytest.mark.live` and is skipped by default.

## Layout

- `sec_client.py` is the only module that calls edgartools. Tests replace it with a fake through
  `app.dependency_overrides`.
- `xbrl_facts.py` holds the pure dedupe and restatement logic over SEC `companyfacts` JSON.
- `statements.py` holds the pure period selection and the stitching of per-filing standardized
  statements, with provenance enforced.
- `submissions.py` maps SEC `submissions` JSON to `Company`.
