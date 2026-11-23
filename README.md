# DealPilot

**An agentic AI investment-banking analyst.**
DealPilot is a multi-agent system. It researches companies, builds financial analyses, checks its own work independently, and produces investment-banking deliverables in which every claim is backed by evidence.

> Status: **pre-alpha / planning.** The repo scaffolding and dev tooling are in place. The application code is not written yet. See [Roadmap](#roadmap) and [docs/PLAN.md](docs/PLAN.md).

---

## Why DealPilot

An analyst on a deal spends most of their time on four jobs:

1. pulling numbers out of filings
2. rebuilding the same ratio, DCF and comps math
3. checking that the numbers tie out across the workbook and the memo
4. defending every assumption

LLMs handle the reading and writing well. They are **unreliable at arithmetic and at citing sources**. DealPilot splits the work so that each part goes to the component that handles it best:

| Concern                                                                   | Who does it                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Reading filings, extracting facts, drafting narrative                     | LLM agents (structured tool calls validated with Zod)                                         |
| Every number that ends up in a deliverable                                | `@dealpilot/finance`: deterministic, unit-tested TypeScript functions                         |
| Is the number right, is the citation real, does the memo match the model? | An independent Verification agent with no shared context. It can reject work and send it back |
| Why the system decided what it did                                        | A full, replayable trace of agent decisions                                                   |

**Core rule: an LLM never produces a financial figure on its own.** It may _choose_ which calculation to run and _explain_ the result. The value itself always comes from code, from inputs that are traceable to a source.

---

## How you use it: chat + deliverable panel

DealPilot is a **chat app**. You ask in plain language, the agents work visibly in the thread, and the results build up in a side panel.

```
┌──────────────────────────────────┬──────────────────────────────────────────┐
│ CHAT                             │ DELIVERABLE PANEL                        │
│                                  │                                          │
│ You: Value Apple with a DCF and  │  Apple Inc. (AAPL) · FY2026 10-K         │
│      comps                       │  EV $X.XXT · $XXX/share (base)           │
│                                  │  ┌ DCF ┬ Comps ┬ Sensitivity ┬ Risks ┐   │
│ ▸ Reading 10-K (filed 2026-11-03)│  │ WACC × g grid … live table          │   │
│ ▸ 42 facts extracted, all cited  │  └─────────────────────────────────────┘   │
│ ▸ Building DCF + 6 peers         │  Evidence: click any number → the exact  │
│ ▸ Verifier: 2 issues → fixed     │  filing quote it came from               │
│                                  │                                          │
│ DealPilot: Base case $XXX/share… │  [Download .xlsx]  [Download memo]       │
│                                  │                                          │
│ You: What if WACC is 9%?         │  (panel updates; only the finance code   │
│                                  │   reruns, so it's near-instant and free) │
└──────────────────────────────────┴──────────────────────────────────────────┘
```

- **Ask anything about a company:** "Value Nvidia", "What are the main risks in Tesla's last 10-K?", "Compare Apple's margins with Microsoft".
- **Watch the agents work:** each step streams into the chat (SSE), including what the Verifier caught and fixed.
- **Follow-ups are cheap:** "Use 9% WACC", "Drop Dell from peers" or "Show the bear case" rerun only the deterministic finance code. Nothing is re-read.
- **Every number is clickable** in both the chat and the panel, and opens its source quote.
- **The panel holds the deliverables:** valuation summary, DCF, comps, sensitivity heatmap, risk list, evidence viewer, defects, and downloads for the Excel model and the memo.
- An `/admin` page (owner only) shows eval scores, cost and latency per run. It is a developer view, not the product.

## Features

### 1. Company Research Agent

- Pulls filings (10-K, 10-Q, 8-K, DEF 14A, S-1) and XBRL company facts from SEC EDGAR.
- Gets standardized statements and filing sections from edgartools (via edgar-service), splits the text into chunks, and indexes them in pgvector so evidence can be retrieved with hybrid search.
- Extracts financial facts as typed records: `value`, `unit`, `period`, `concept`, `sourceDoc`, `section/page`, `quoteSpan`.
- Links every claim to evidence it can cite. A fact with no evidence is never used downstream.

### 2. Financial Modeling Agent

- Ratios: profitability, liquidity, leverage, efficiency, and cash conversion.
- **DCF**: unlevered FCF build, WACC (CAPM), terminal value by both Gordon growth and exit multiple, and an EV → equity bridge.
- **Comparable companies**: peer selection with a written rationale, LTM/NTM multiples, and summary statistics.
- **Sensitivity analysis**: WACC × g and WACC × exit-multiple grids, plus scenario cases (base, upside, downside).

### 3. Forensic & Skeptic Agents

- **Forensic**: finds accounting red flags and inconsistencies, such as accruals quality, revenue vs. receivables divergence, unusual one-offs, restatements, auditor changes, related-party items, and segment mismatches.
- **Skeptic**: argues against the model's assumptions (growth, margins, WACC, terminal value share of EV). It also proposes and runs alternative scenarios and lists deal risks.

### 4. Independent Verification Agent

- Recomputes every figure through the deterministic library and compares the results against what is reported.
- Checks that each citation resolves to a real document span and that the quote supports the claim.
- Checks model integrity (balance-sheet balances, cash ties out, no hard-coded values) and consistency between the workbook, the memo, and what the chat and panel show.
- **Sends errors back** to the responsible agent with a structured defect report. This loop has a limit on retries. Anything still unresolved is flagged in the deliverable, never hidden.

### 5. Deliverable & Audit Agent

- **Valuation workbook** (`.xlsx`, ExcelJS), with live formulas rather than pasted values. It has separate tabs for inputs, the model, sensitivities, comps, and sources.
- **Deal-analysis memo** (Markdown → `.docx`): thesis, valuation summary, key assumptions, evidence, risks, and open questions.
- **Audit trail**: every agent step, tool call, input, output, verification verdict, and retry.

---

## Architecture

```
          Financial documents + SEC EDGAR filings / XBRL facts
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │     Orchestrator Agent     │  plans tasks, routes work,
                    │      (LangGraph.js)        │  enforces budgets
                    └─────────────┬─────────────┘
          ┌──────────────┬────────┴─────┬──────────────┐
          ▼              ▼              ▼              ▼
     ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐
     │Research │   │ Modeling │   │ Forensic │   │ Skeptic │
     └────┬────┘   └────┬─────┘   └────┬─────┘   └────┬────┘
          └─────────────┴──────┬───────┴──────────────┘
                               ▼
        ┌──────────────────────────────────────────────┐
        │  Verification loop  ◄──►  @dealpilot/finance  │
        │  (independent agent)      (deterministic TS)  │
        │        │ defects → back to the source agent   │
        └────────┼─────────────────────────────────────┘
                 ▼
     Chat answers (cited)  ·  Deliverable panel  ·  Excel model  ·  Deal memo
```

**Runtime layout.** DealPilot is a TypeScript core with two Python services, chosen where Python has the better library:

```
 Next.js web ──HTTP/SSE──► Express API ──pg-boss──► Worker (LangGraph.js agents)
                                                     │            │
                                     typed HTTP      │            │ OpenAI-compatible
                                                     ▼            ▼
                              edgar-service (Python)        LiteLLM proxy (Python)
                              FastAPI + edgartools          free-tier rotation,
                              filings, XBRL → statements    fallbacks, cost tracking
                                                     │
                                                     ▼
                                       Postgres + pgvector (shared)
```

- **Express API** accepts tasks and streams progress over SSE. The **worker** runs the LangGraph.js graph from a pg-boss queue.
- **edgar-service** (Python, FastAPI) wraps **edgartools**. It handles EDGAR access (User-Agent, 10 req/s, caching), standardized financial statements from XBRL, filing text and sections, and full-text search. Every fact is returned with its provenance.
- **LiteLLM proxy** (Python) is the single gateway for every LLM call. It rotates free-tier models, falls back to cheap paid ones, and keeps count of the cost.
- **Boundary rule:** the Python services _fetch and normalize data_. **All valuation math lives in TypeScript** (`@dealpilot/finance`), so every number has exactly one implementation.

**Shared state.** A typed LangGraph state object (Zod schemas in `@dealpilot/shared`) holds the deal context, the facts with their evidence, model outputs, defects, and the trace. Every agent reads from and writes to that state through validated schemas. Agents never pass free-form text to each other.

---

## Tech stack

| Layer              | Choice                                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / runtime | TypeScript (strict) on Node.js 24 LTS, pnpm workspaces. **Python 3.12 (uv)** for the data and LLM-gateway services                                                                                                                                    |
| SEC data service   | **Python: FastAPI + edgartools** (filings, XBRL → standardized statements, full-text search). A typed TS client is generated from its OpenAPI spec                                                                                                    |
| Backend            | **Express 5**, Zod validation, SSE for live progress, pg-boss job queue                                                                                                                                                                               |
| Agents             | **LangGraph.js** (`@langchain/langgraph`, MIT), structured tool calling with Zod schemas                                                                                                                                                              |
| LLM routing        | **Python: LiteLLM proxy** (OpenAI-compatible). Free and low-cost models first, see [research](docs/research/)                                                                                                                                         |
| Finance            | `@dealpilot/finance`: pure TypeScript, Vitest + fast-check property tests                                                                                                                                                                             |
| Data               | SEC EDGAR via edgar-service, Treasury/FRED, Damodaran                                                                                                                                                                                                 |
| Documents          | edgartools (filing sections and text), ExcelJS (workbook), docx (memo)                                                                                                                                                                                |
| Database           | PostgreSQL 16 + pgvector (`halfvec`, HNSW) + `tsvector` hybrid search, Drizzle ORM                                                                                                                                                                    |
| Frontend           | **Next.js** chat app (App Router): chat thread + deliverable side panel, TypeScript, Tailwind CSS, TanStack Query, Recharts                                                                                                                                                                          |
| LLM providers      | Free tiers (Gemini, Groq, OpenRouter) for producer agents; **Anthropic Claude** Sonnet 5.5 for the verifier, skeptic and writer, and Haiku 5.5 as fallback                                                                                            |
| Market data        | Free tiers (FMP / Tiingo), cached. Treasury/FRED for rates, Damodaran for ERP and betas                                                                                                                                                               |
| Hosting            | **AWS Free plan**: one EC2 `t4g.small` with Docker Compose (API + worker, edgar-service, LiteLLM, Caddy), paid from credits. **Neon** provides Postgres + pgvector, Managed Better Auth and object storage. **Vercel Hobby** hosts Next.js |
| Observability      | Langfuse (JS SDK)                                                                                                                                                                                                                                     |
| Tooling            | TS: Biome, Vitest · Python: uv, ruff, pytest, mypy · Lefthook git hooks, gitleaks, AI coding-agent config                                                                                                                                         |

---

## Repository layout

```
dealpilot/
├── apps/
│   ├── api/                 # Express 5 server: routes, SSE, auth, artifact download
│   ├── worker/              # pg-boss consumer that runs the LangGraph.js graph
│   └── web/                 # Next.js chat app (thread + deliverable panel, /admin evals)
├── packages/
│   ├── agents/              # orchestrator, research, modeling, forensic, skeptic, verifier, deliverable
│   ├── graph/               # LangGraph state, nodes, edges, retry/defect routing
│   ├── finance/             # deterministic calcs: ratios, dcf, wacc, comps, sensitivity (pure + tested)
│   ├── sources/             # typed edgar-service client, chunking, embeddings, evidence store
│   ├── llm/                 # gateway client: routing, caching, cost accounting
│   ├── deliverables/        # ExcelJS workbook + memo renderers
│   ├── db/                  # Drizzle schema + migrations (pgvector)
│   └── shared/              # Zod schemas & types shared by api, worker, web
├── services/
│   └── edgar/               # Python: FastAPI + edgartools (uv project, pytest, ruff)
├── evals/                   # benchmark runners, metrics, golden sets
├── infra/                   # docker-compose (dev + prod/EC2), litellm/config.yaml, Caddyfile, ec2 bootstrap
├── render.yaml              # fallback Blueprint (Render Free + Neon) for after AWS credits
├── docs/                    # architecture, plan, research
└── .claude/                 # coding-agent rules, hooks, skills, subagents for development
```

---

## Evaluation

| Benchmark                                                                                       | What it tests                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[BankerToolBench](https://github.com/Handshake-AI-Research/bankertoolbench)** (primary)       | 100 end-to-end IB tasks (Handshake AI, arXiv:2604.11304). Deliverables are graded against expert rubrics of about 150 criteria each by an LLM verifier that agrees with experts 88% of the time. Code is Apache-2.0, data is CC-BY-4.0 |
| **[SECQUE](https://huggingface.co/datasets/nogabenyoash/SecQue)** (arXiv 2504.04596)            | 565 expert questions on real 10-K/10-Q filings, covering fact extraction, ratio calculation, comparison and trends, and risk. Each question includes gold evidence (accession no., Item, page). MIT, evaluation-only                   |
| **[FailSafeQA](https://huggingface.co/datasets/Writer/FailSafeQA)** (Writer, arXiv 2502.06329)  | 220 adversarial / robustness cases over 10-K text: missing or irrelevant context, out-of-scope questions, incomplete queries. Tests hallucination and refusal. MIT                                                                     |
| **[Fin-RATE](https://huggingface.co/datasets/GGLabYale/Fin-RATE)** (KDD 2026, arXiv 2602.07294) | Questions on SEC filings that require comparing peer companies (cross-document) or tracing one company across years (temporal). We sample about 250 of them. MIT                                                                       |
| **Restatement slice** (internal, about 20 questions)                                            | Original vs. restated values from EDGAR XBRL history. No public set covers this                                                                                                                                                        |
| **Internal risk and consistency sets**                                                          | Hand-labelled deal-risk flags, plus workbook↔memo reconciliation checks                                                                                                                                                                |

**Metrics:** financial calculation accuracy · evidence and citation correctness · expert-rubric score · deal-risk detection precision/recall · task completion rate · cross-document consistency · latency and cost per task.

Every run is logged with its model, prompt version, token usage, and $ cost, so quality and cost can be compared run against run.

---

## Getting started

> The commands below describe the target developer experience. They work once milestone M1 lands.

```bash
# prerequisites: Node.js 24+, pnpm 10+, uv (Python 3.12), Docker
cp .env.example .env                 # add your SEC User-Agent + LLM keys
neon deploy && neon env pull         # Neon Postgres, Auth, Object Storage → .env
pnpm db:migrate                      # migrations over the direct Neon URL
pnpm cli auth smoke && pnpm cli storage smoke
pnpm install && (cd services/edgar && uv sync)
pnpm db:migrate
pnpm test                            # offline tests (finance package must be 100% green)
pnpm dev                             # api :4000, worker, web :3000, edgar-service :8100
pnpm cli analyze --ticker AAPL --task "standalone DCF + comps"
```

**SEC EDGAR etiquette.** SEC requires a descriptive `User-Agent` that includes contact info, and allows at most 10 requests per second. DealPilot enforces both and caches every response. data.sec.gov does not send CORS headers, so all EDGAR calls go through the backend.

---

## Roadmap

| Milestone | Scope                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------ |
| **M0**    | Repo setup, agent rules, hooks, skills, stack research ✅                                        |
| **M1**    | Monorepo + edgar-service (edgartools) + evidence store, deterministic finance package with tests |
| **M2** ✅  | LangGraph.js orchestrator + Research and Modeling agents, end to end for one ticker              |
| **M3** ✅  | Verification loop with defect routing, plus the Forensic and Skeptic agents                      |
| **M4** ✅  | Excel workbook, deal memo, audit trail                                                           |
| **M5**    | Eval harness (BankerToolBench, SECQUE, FailSafeQA, Fin-RATE) with cost and latency tracking      |
| **M6**    | Next.js chat app + deliverable panel, AWS EC2 + Vercel deployment                            |

---

## Disclaimer

DealPilot is a portfolio and learning project. It uses only public SEC data and is not used by any real company. Its output is **not investment advice**, and a qualified professional must review it before it is used for any real transaction.
