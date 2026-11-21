# DealPilot — agent rules

These rules are for any AI coding agent working in this repo (Claude Code, Codex, Cursor and others).
Read `README.md` for what the product is, `docs/PLAN.md` for the build plan, and `docs/research/` for the stack decisions.

**Stack:** TypeScript (strict) on Node.js 24, pnpm workspaces. The backend is Express 5, the agents are LangGraph.js, the frontend is a Next.js + Tailwind **chat app with a deliverable side panel**, and the database is Postgres + pgvector via Drizzle.
There are also **two Python services**:

- `services/edgar`: FastAPI + edgartools, for SEC data.
- The **LiteLLM proxy** (`infra/litellm/`): the LLM gateway.

**Language boundary.** Python is used _only_ where it has the clearly better library: fetching and normalizing SEC data, and LLM routing.

- **Valuation and ratio math is TypeScript only** (`packages/finance`). Never re-implement a finance formula in Python.
- Any new Python service needs the user's OK first.

## Non-negotiables (correctness of financial output)

1. **No LLM-generated numbers.** Every figure in a deliverable is computed by a function in
   `packages/finance/`. Agents choose _which_ function to call and explain the result. They never
   do arithmetic in a prompt or write a number into text that code did not compute.
2. **The finance package is pure and deterministic.** That means:
   - no I/O, `fetch`, `fs`, `process.env`, `Date.now()`, `Math.random()`, LLM SDKs, or global mutable state
   - every exported function has TSDoc with the formula, the units, and the sign convention
   - every function has Vitest tests against hand-computed values, plus fast-check property tests where they apply
   - `number` (IEEE double, the same as Excel) with tolerance-based comparisons; round only at presentation
   - never compare computed floats with `===` in tests; use `toBeCloseTo` or a relative-tolerance helper
3. **Every fact carries provenance**: `sourceDoc` (accession no.), `section/page`, `quoteSpan`, `period`,
   `unit`, `concept`. Code that drops provenance is a bug. A claim without evidence must not reach a
   deliverable.
4. **Units and periods are explicit.** Store values in base units (USD, not "$mm") with a `scale` field. Be
   explicit about FY vs. calendar year, LTM, and fiscal-period end dates. Never mix periods in one ratio without an
   explicit conversion.
5. **The Verifier is independent.** It must not share prompts, memory, or scratch state with the agent it checks.
   It recomputes figures through the finance package and resolves citations itself.
6. **Fail loudly.** If something is unverified, report it as unverified in the output. Never silently drop a defect
   or "fix" a number to make a check pass.

## Architecture conventions

- **Monorepo boundaries:**
  - `apps/api` (Express) and `apps/worker` depend on `packages/*`. They reach `services/edgar` and LiteLLM over HTTP only.
  - `apps/web` depends only on `@dealpilot/shared` and talks to the API over HTTP/SSE.
- **UI model: chat-first.**
  - Chat (left) shows the user's messages, streamed agent steps and short cited answers.
  - The deliverable panel (right) shows structured results: Summary, DCF, Comps, Sensitivity, Risks, Evidence, Defects, and downloads.
  - Never render big tables or models as chat text; put them in the panel.
  - Every number in chat or panel links to its `Evidence` or `CalcResult`.
  - A follow-up that only changes assumptions (WACC, peers, scenario) reruns finance tools on cached facts, with no LLM reading.
  - `packages/finance` depends on nothing internal.
- **Express:**
  - every route validates `req.body`/`req.query` with a Zod schema from `@dealpilot/shared`
  - errors go through one error middleware, which returns a typed `{ error: { code, message } }`
  - long work never runs in a request handler; enqueue a pg-boss job and stream status over SSE
- The LangGraph.js state is defined with Zod in `packages/graph/src/state.ts`. Agents communicate only through
  typed state fields and structured tool outputs. They do not pass free text to each other.
- Every LLM call goes through `packages/llm` (an OpenAI-compatible client to the LiteLLM proxy). It handles routing, retries,
  caching, token and $ accounting, and tracing. Never import a provider SDK inside an agent.
- DealPilot is a **portfolio/learning project**. It processes only public SEC data, so free LLM tiers are fine for any
  node. Keep the code simple: there are no multi-tenant, auth-heavy or compliance features unless the user asks.
- Prompts live in versioned files (`packages/agents/src/<agent>/prompts/v1.md`), not in inline strings. When a
  prompt changes, add a new version so eval runs stay comparable.
- Every agent step writes a trace event with its inputs, outputs, tool calls, model, tokens, cost, and latency.
- **All SEC EDGAR access goes through `services/edgar`.** It sets `User-Agent` from `SEC_USER_AGENT` (through edgartools'
  `set_identity`), enforces at most 10 req/s, and caches under `data/cache/`. TypeScript code never calls sec.gov directly.
  It uses the client generated from the service's OpenAPI spec (`packages/sources/src/edgar/client.gen.ts`, built with `pnpm gen:edgar`).
- **Python service conventions** (`services/*`):
  - Python 3.12, managed by uv. FastAPI, with Pydantic v2 response models; those models _are_ the cross-language contract.
  - ruff (format + lint), mypy, and pytest with recorded fixtures (`tests/fixtures/`) that never touch the network.
  - Live tests are `@pytest.mark.live` and opt-in.
  - Every response that returns a fact or statement line includes provenance: accession no., form, filed date, period start/end, concept, unit.
  - When the API changes, regenerate the TS client in the same change.

## Neon (database, auth, object storage)

- **Neon is the only database.** Project `DealPilot` (shiny-lab-10573392), branch `production`, configured in `neon.ts`.
  `neon deploy` provisions it and `neon env pull` writes the env vars. Do not point the app at the local Docker Postgres,
  which only serves offline CI.
- **Postgres:**
  - `DATABASE_URL` is pooled (`-pooler`) and serves app traffic through `postgres-js` + Drizzle.
  - Migrations (`pnpm db:migrate`) use the **direct** URL, `DATABASE_URL_UNPOOLED` or the host with `-pooler` stripped, via `directDatabaseUrl()`.
  - Test schema changes on a Neon branch (`neon checkout dev --create`) before production.
- **Auth:** Neon Managed Better Auth, reached through `@dealpilot/auth`, which wraps `@neon/auth/server`.
  - Users and sessions live in the `neon_auth` schema. Never call `betterAuth()` or run auth migrations.
  - Express binds requests with `authContextMiddleware()`. Scripts and tests use `cookieJarContext()`.
  - Proof: `pnpm cli auth smoke`.
- **Object storage:** `@dealpilot/storage` uses the AWS S3 SDK (`forcePathStyle: true`) against the private `assets` bucket.
  - Artifacts are stored under `tasks/<taskId>/<file>`, and the `artifacts` table keeps only `storage_key`.
  - Downloads go through presigned URLs. Proof: `pnpm cli storage smoke`.
- Never print or read `.env` values. When checking config, log variable names or hostnames only.

## Deployment

- **Primary: AWS Free plan (about 6 months of credits).**
  - One EC2 `t4g.small` (ARM, 2 GB) runs `infra/docker-compose.prod.yml`: api + worker, edgar-service, litellm, and Caddy. **Postgres is on Neon**, not the box.
  - Next.js is on **Vercel Hobby**.
- **Protect the credits.** Never add RDS, NAT gateways, load balancers, Multi-AZ, or extra instances without asking the user.
  Images must build for `linux/arm64`.
- **Never run AWS commands that create billable resources** (`aws ec2 run-instances`, `terraform apply`, and so on) yourself.
  Prepare the script or config, and the user runs it.
- **Portable by design.** The same containers must also run on Render Free + Neon Free, the plan once credits end. So jobs:
  - warm up edgar-service and litellm at the start
  - send a heartbeat every 5 minutes while running
  - are resumable through the pg-boss queue and the LangGraph Postgres checkpointer
- Never rely on long HTTP requests; use the queue + SSE.
- Artifacts (xlsx/docx) go to Neon Object Storage, and caches go to Neon Postgres. `data/cache/` is local-dev only.
  Neon's instant restore covers backups.
- Secrets live in a server-side `.env` on EC2 (mode 600) or in SSM Parameter Store, and in Vercel env vars. Never put them in compose files or `render.yaml`.

## Market data (decided 2026-11-21; see docs/research/reports/FMP free plan coverage.md)

- **Own the shares, rent only the price.**
  - Shares outstanding come from SEC filings (`dei:EntityCommonStockSharesOutstanding`; fallbacks: balance-sheet count, then weighted-average diluted, each flagged).
  - Market cap is computed by `marketCap()` in `@dealpilot/finance` as price × SEC shares. Never use a vendor's market cap.
  - Store the price date and the share-count date, and flag a stale price.
- **Price** goes through one `PriceProvider` chain (`PRICE_PROVIDERS`, default finnhub → fmp → twelvedata; providers without a key are skipped).
  - **Finnhub is the primary source** (verified live 2026-11-21): free key, quotes for every US symbol tried (incl. HPQ, DELL, QCOM, ORCL, IBM that FMP rejects), plus US-focused peers, profile and beta.
  - The Twelve Data adapter is written but its key was rejected (401) when tested, so it is unverified.
  - **FMP's free plan serves only a fixed allow-list of about 87 symbols** and bars public display of its data, so it is a private-use convenience, not the core provider.
  - A **user-stated price** ("Value HPQ, the price is $38") always works and is labelled as provided by the user.
  - Free tiers are personal or internal use. Do not show vendor prices on a public page without checking the terms.
- **Beta:** Damodaran US industry beta (committed snapshot `packages/market/data/damodaran-betas-us.json`, refreshed each January with `scripts/damodaran/convert.py`). The model only *picks* the industry from the real list; code relevers the cash-corrected unlevered beta to the company D/E with `relevered()`. Fallbacks, always labelled: the provider company beta, then 1.0. Regression beta (`betaFromReturns()`) exists in finance but is not wired in yet. Cite Damodaran and show only the figures used.

## Valuation model (decided 2026-11-21)

- **10-year DCF.** The model proposes growth and margins for years 1–5 only (bounded and checked against a filing-based baseline); **code fades growth linearly from the year-5 rate to terminal growth over years 6–10**, and margins hold. A 5-year horizon forced high-growth companies to terminal growth too early and undervalued them (Microsoft at a 9% WACC: $163 with 5 years, $223–243 with 10).
- **Repeatability.** The assumptions and industry-beta steps run on the paid model at temperature 0 (about $0.001 per run), because the free-tier rotation changed WACC and growth from run to run. Everything else that can use free tiers still does.
- Typical result: terminal value is about 50–60% of EV. A large gap to the market price is flagged, not hidden.

## Local development

- `pnpm dev:edgar` and `pnpm dev:litellm` start the two Python services from the repo-root `.env`. LiteLLM is given only its own keys, never `DATABASE_URL`.
- `node scripts/with-neon-branch.mjs m2-dev -- <command>` runs any command against a Neon dev branch without touching `.env`. Use it for DB tests and live runs; never run DB work against production first.
- `pnpm cli chat "…"` runs the graph with the real services. `pnpm --filter @dealpilot/api start` and `pnpm --filter @dealpilot/worker start` run the API and worker. `pnpm cli e2e "…"` drives them over HTTP.

## Cost discipline

- Default to the cheapest model that passes evals for each node. Use stronger models only where evals show
  they are needed (usually the Verifier and Skeptic).
- Cache aggressively: EDGAR responses, parsed documents, embeddings, and LLM responses (keyed on prompt version +
  inputs).
- Tests must not call paid APIs. Use recorded LLM fixtures (`**/__fixtures__/llm/`). Live-model tests live in
  `*.live.test.ts`, run only via `pnpm test:live`, and are opt-in.

## Code style

- TypeScript `strict`, `noUncheckedIndexedAccess`, ESM only, no `any` (use `unknown` + Zod).
- Biome for lint and format (`pnpm check`). Keep modules small, and prefer plain functions over classes.
  Write no speculative abstractions.
- Next.js: App Router, Server Components by default, Tailwind, and no data fetching from EDGAR in the browser.

## Commands

```bash
pnpm install
pnpm dev                 # api + worker + web
pnpm test                # all offline tests (vitest)
pnpm test:live           # opt-in tests that hit real APIs (hook-guarded)
pnpm check               # biome lint + format
pnpm typecheck           # tsc -b across the workspace
pnpm db:migrate          # drizzle migrations
pnpm gen:edgar           # regenerate TS client from services/edgar OpenAPI

# Python service (run inside services/edgar)
uv sync
uv run pytest            # offline tests
uv run ruff check --fix . && uv run ruff format .
uv run mypy src
uv run fastapi dev src/edgar_service/main.py --port 8100
```

## Protected paths (hooks enforce these)

- `.env`, `*.pem`, `*.key`, and anything containing `secret`: never write.
- `evals/golden/`: ground-truth answers. Change only when the user explicitly asks.
- `data/raw/`: immutable source-document cache.

## Git

- Do not commit or push unless the user asks. Propose a commit message instead.
- Never commit `.env`, `data/`, or eval run outputs.

## Project skills and subagents

- `/sec-edgar`: the edgar-service (edgartools) and fetching filings and XBRL facts correctly
- `/fin-calc`: adding or changing a deterministic finance function
- `/new-agent`: scaffolding a LangGraph.js agent node
- `/run-evals`: running benchmarks and reading results
- Subagent `finance-reviewer`: review any diff that touches `packages/finance`, the modeling or verifier agents, or `packages/deliverables`
- Subagent `eval-analyst`: diagnose eval regressions and cost or latency changes
