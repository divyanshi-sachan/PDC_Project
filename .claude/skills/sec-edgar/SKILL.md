---
name: sec-edgar
description: How DealPilot gets SEC EDGAR data — the Python edgar-service (FastAPI + edgartools) in services/edgar and its typed TS client in packages/sources. Covers User-Agent, rate limits, caching, XBRL quirks, standardized statements and provenance. Use when changing services/edgar or packages/sources, or when an agent needs filings or reported financial facts.
---

# SEC EDGAR access

**Flow:** agent tool (TS) → `packages/sources/src/edgar/client.gen.ts` → HTTP → `services/edgar` (FastAPI + **edgartools**) → SEC.
TypeScript never calls sec.gov directly.

## Service layout (`services/edgar`)

```
services/edgar/
├── pyproject.toml            # uv; deps: edgartools, fastapi, pydantic, httpx
├── src/edgar_service/
│   ├── main.py               # FastAPI app, /health, router mounting
│   ├── deps.py               # set_identity(SEC_USER_AGENT), limiter, cache
│   ├── models.py             # Pydantic response models = cross-language contract
│   ├── routes/
│   │   ├── companies.py      # GET /companies/{ticker} → cik, name, sic, fiscal year end
│   │   ├── filings.py        # GET /companies/{ticker}/filings?form=10-K&limit=5
│   │   ├── statements.py     # GET /companies/{ticker}/statements?kind=income|balance|cashflow&period=annual|quarterly
│   │   ├── facts.py          # GET /companies/{ticker}/facts?concept=...  (raw XBRL, with dedupe)
│   │   ├── sections.py       # GET /filings/{accession}/sections → Item 1, 1A, 7, 8 text with anchors
│   │   └── search.py         # GET /search?q=...&forms=10-K (full-text search)
│   └── provenance.py         # attaches accn/form/filed/start/end/concept/unit to every line
└── tests/                    # pytest + recorded fixtures; @pytest.mark.live is opt-in
```

## Hard requirements

- Call `edgartools.set_identity(os.environ["SEC_USER_AGENT"])` once at startup. SEC blocks requests with no identity.
- Make **no more than 10 requests per second** process-wide. Keep the edgartools rate limiting on, and run the service as a single instance or worker (or move the limiter to a shared store if we scale out).
- Cache: use edgartools' local storage / HTTP cache under `data/cache/edgar/`. Persist parsed statements in Postgres keyed by accession, so a filing is never parsed twice.
- Use **standardized statements** from edgartools (`company.get_financials()` / `Financials` / `XBRL.statements`) for the model. Keep the original concept names alongside the standardized labels.
- **Provenance is mandatory.** Every statement line and fact in a response carries `accession`, `form`, `filed`, `period_start`, `period_end`, `concept`, `unit`, `scale`, plus `section/anchor` for text. Responses that would drop provenance fail the tests.
- Tests use recorded fixtures and never touch the network. Live tests are marked `@pytest.mark.live`, and the Bash hook guards them.

## XBRL rules (still apply on top of edgartools)

- Facts are duplicated across filings. Prefer the **latest filed** value for a given period (it captures restatements), _but_ keep the originally reported value too, because the restatement eval slice needs both.
- Duration facts (income, cash flow) have a start and an end; instant facts (balance sheet) have only an end. Never mix them up.
- Custom company tags and segment/dimension data are missing from the `companyfacts` API. Use edgartools' full XBRL instance parsing or the section text for those.
- Derived values (Q4 = FY − 9M, LTM) are flagged as `derived: true` and list the source facts they were built from.

## TS side

- `pnpm gen:edgar` regenerates `client.gen.ts` from `http://localhost:8100/openapi.json` (openapi-typescript + openapi-fetch). Commit the generated file in the same change as the API change.
- Agent tools wrap the client and convert responses into `Fact`/`Evidence` (Zod) objects. They never post-process the numbers.
