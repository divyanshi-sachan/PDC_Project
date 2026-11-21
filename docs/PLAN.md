# DealPilot — build plan (v2, draft for approval)

Based on [the stack research](research/reports/DealPilot%20low%20cost%20stack.md) and [the benchmark alternatives](research/benchmark_alternatives.md), November 2026.
**Changes in v2:** the backend is **Node.js + Express (TypeScript)** and the frontend is a **Next.js chat app with a deliverable side panel**. The custom 133-question set is replaced by **public benchmarks: SECQUE + FailSafeQA + Fin-RATE**.
**v2.1:** two **Python services** are added where Python has the better library: **edgar-service** (FastAPI + edgartools) and the **LiteLLM proxy**. Valuation math stays TypeScript only.
**v2.3: this is a portfolio/learning project, not a product.** There are no real users and no confidential deal data. So we target **$0 out-of-pocket hosting: the AWS Free plan's credits for the first ~6 months, then Render + Neon free**, use free market data (no display licence to buy), and drop the confidential-data routing. The only real cost is Anthropic usage, about $5–15/month.
Principle: **build and host at $0. The only paid service is the Anthropic API, spent mainly on the verifier.**

---

## 1. Chosen stack

### Application
| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces (`apps/api`, `apps/worker`, `apps/web`, `packages/*`) + `services/edgar` (uv). TypeScript strict on Node 24 LTS, Python 3.12 | A TS core shares Zod schemas between backend and frontend. Python is limited to data and gateway services |
| HTTP API | **Express 5** + Zod validation + one typed error middleware + SSE for live progress | Your choice. Express 5 has native async error handling |
| Jobs | **pg-boss** (Postgres-backed queue) in a separate `worker` process | No Redis needed. Agent jobs take 2–15 minutes, so they never run inside a request |
| Agents | **LangGraph.js** (`@langchain/langgraph`, MIT) + Postgres checkpointer | The JS port of LangGraph. Jobs can resume after a crash. We avoid the licensed LangGraph Server |
| LLM gateway | **LiteLLM proxy (Python service)**, OpenAI-compatible, config in `infra/litellm/config.yaml` + `@dealpilot/llm` thin TS client | Rotates free tiers with RPM/RPD limits, cools down on 429s, falls back to cheap paid models, and tracks cost |
| Finance math | `@dealpilot/finance`: pure TS, Vitest + fast-check | Deterministic and auditable. Uses IEEE doubles, the same as Excel |
| EDGAR | **edgar-service (Python): FastAPI + edgartools**. It handles identity and rate limits, standardized statements from XBRL, filing sections, and full-text search, and returns provenance on every line. A typed TS client is generated from its OpenAPI spec | edgartools is the best-maintained EDGAR library (v6.2, MIT), which saves us from writing our own XBRL normalizer |
| Parsing | Filing sections and text from edgartools. unpdf only for rare PDF exhibits | |
| DB | **Neon** Postgres + pgvector (`halfvec` + HNSW) + `tsvector`, **Drizzle ORM** (pooled URL for the app, direct URL for migrations) | Hybrid search fused with RRF. Drizzle supports pgvector natively |
| Embeddings / rerank | Voyage free tokens (voyage-4-lite) **or** local via Ollama (EmbeddingGemma / Qwen3-Embedding); bge-reranker via Ollama or Voyage rerank-lite | Free. Local means no data leaves the machine |
| Deliverables | **ExcelJS** (live formulas), `docx` (memo), parity check through LibreOffice headless in CI | |
| Frontend | **Next.js chat app** (App Router): chat thread on the left, deliverable panel on the right. Tailwind + TanStack Query + Recharts | Chat is the product; tables and models need a panel, not chat text |
| Observability | Langfuse (JS SDK), Cloud Hobby tier | Free, with native LangChain.js callbacks |
| Tooling | TS: Biome, Vitest · Python: uv, ruff, mypy, pytest · Lefthook + gitleaks, GitHub Actions | |

### Models and data (decided)
| Role | Primary | Fallback |
|---|---|---|
| Producers: orchestrator, research, modeling, forensic | Free tiers: Gemini free, Groq / OpenRouter `:free` (gpt-oss-120b, qwen3.8-27b). All input is public SEC data, so free-tier training terms don't matter | **Claude Haiku 5.5** (your Anthropic key; $0.10/$0.50 per M tokens, under 100K-token prompts) |
| **Verifier + Skeptic** | **Claude Sonnet 5.5** (your Anthropic key) | Haiku 5.5 when the budget is tight |
| Deliverable writer (memo prose) | Claude Sonnet 5.5 | Haiku 5.5 |
| Web research | Tavily (1k/mo free), Exa ($10/mo free credit), `ddgs` throttled | none needed |
| Fundamentals / macro | edgar-service (EDGAR), Treasury yield feed, FRED, Damodaran | none |
| Market prices | **Under review.** FMP free serves only a fixed ~87-symbol allow-list and bars public display of its data; see [docs/research/reports/FMP free plan coverage.md](research/reports/FMP%20free%20plan%20coverage.md). Direction: shares, sector and peer candidates from SEC EDGAR; one dated closing price behind a swappable adapter; user-confirmed price for the public demo | Paid display rights only if needed (Twelve Data Grow $79/mo is the cheapest published) |

**Cross-family note:** the producers run on non-Claude models and the verifier runs on Claude, so their errors stay uncorrelated. When a producer step falls back to Haiku, the verifier still recomputes every number deterministically, and the trace flags that step.

**Market data terms:** most free tiers say "personal / non-commercial use". A non-commercial portfolio demo fits that better than a product would, but it is still a grey area for a public site. To keep exposure small:
- show only the few prices a valuation actually uses (current price and market cap), not a ticker feed
- cite the source
- never redistribute bulk data

**Anthropic cost levers we will use:**
- prompt caching on the system prompts and filing context (cache reads cost 0.05–0.1×)
- the Batch API (50% off) for eval runs and overnight screens
- a per-task budget cap in the gateway (`MAX_COST_PER_TASK_USD`)

### Hosting: AWS Free plan (primary) → Render + Neon free (after AWS credits end)

**AWS Free plan terms** (for accounts created on or after 2025-07-15; [AWS Free Tier](https://aws.amazon.com/free/), checked 2026-11-18):
- **$100 in credits at sign-up, plus up to $100 more** for trying services: launching EC2, setting up an AWS Budget, creating an RDS database, using Bedrock, building a Lambda web app.
- The plan ends **6 months after sign-up or when the credits run out, whichever comes first**. There are no charges unless you upgrade to the Paid plan.
- So AWS is **free for about 6 months, not forever**. We design for that from day one: everything runs in Docker Compose, so moving later is a config change, not a rewrite.
- If your AWS account is older than July 2025, the legacy 12-month free tier applies instead (750 h/month of t2/t3.micro, plus RDS micro). Check the Billing → Credits page.

**Layout: one EC2 box running everything except the frontend**

| Piece | Where | Approx. cost to credits | Note |
|---|---|---|---|
| `api` (Express + pg-boss worker), `edgar-service`, `litellm`, Caddy (TLS). **DB, auth and files are on Neon** | **One EC2 `t4g.small`** (2 vCPU ARM, 2 GB RAM + 2 GB swap) running Docker Compose | ~$12/mo instance + ~$1.60 for 20 GB gp3 EBS + ~$3.60 public IPv4 ≈ **$17/mo** | Always on, so there's no spin-down and long jobs just run. With Postgres on Neon, the 2 GB box has more headroom and needs no RDS |
| Next.js chat app | **Vercel Hobby** | $0 | Hobby is non-commercial only, which fits a portfolio project. It's also the best host for Next.js |
| Artifacts (.xlsx/.docx) | **Neon Object Storage** (`assets` bucket, presigned downloads) | $0 (Neon Free) | |
| Auth | **Neon Managed Better Auth** (email + password) | $0 (Neon Free) | |
| Domain / TLS | Caddy + a free subdomain (sslip.io or DuckDNS) | $0 | |
| **6-month credit burn** | | **≈ $100–105 of $100–200** | It fits even if only the first $100 is earned |

*Costs are approximate on-demand prices from memory; confirm them in the AWS Pricing Calculator. Upgrade to `t4g.medium` (4 GB, about $25/mo) only if memory is tight. That runs about $175 over 6 months, so it needs the extra $100 of credits.*

**Guardrails (set up on day 1):**
- **AWS Budgets** alert at $5 / $15 / $25 per month. Setting one up also earns credits. Remember that credits show as negative cost, so the alert must watch *gross* usage.
- Single-AZ only, no NAT gateway, no load balancer, no RDS. These are the usual causes of credits quietly running out.
- Multi-arch Docker images (`linux/arm64`) for the Node and Python services. Confirm the pgvector and LiteLLM images have arm64 builds, or build them ourselves.
- No DB backup job is needed: Neon keeps the data and offers instant restore, independent of AWS.

**When AWS credits end (about month 6), choose one:**
- **$0 option:** move the same containers to **Render free web services + Neon Free**.
  - The four services become Render Free web services, protected by shared keys, with Neon Free as the database.
  - Free services spin down after 15 minutes idle. Jobs then rely on the warm-up and heartbeat logic, plus resuming from the pg-boss queue and the LangGraph checkpointer. We build that logic anyway, because it also makes restarts on EC2 safe.
- **Paid option:** upgrade the AWS account and keep the box, for about $17/mo.

### Monthly budget
| Item | $/mo |
|---|---|
| Hosting: AWS EC2 paid from Free-plan credits (~$17/mo of credits), Vercel Hobby | 0 out of pocket for about 6 months |
| Market data (FMP/Tiingo free), search (Tavily/Exa free), Langfuse Hobby, GitHub Actions | 0 |
| Anthropic API: Sonnet 5.5 verifier/skeptic/writer + Haiku fallback, for dev runs and a few dozen demo analyses | ~5–15 |
| BankerToolBench subset runs (only when we evaluate; run via Batch at 50% off) | ~5–20 per eval round |
| **Typical month** | **≈ $5–15** |

**Per company analysed:** about $0.17–0.40 in LLM cost, or about $0.10–0.20 with prompt caching and Batch. Free-tier producers keep most tokens off the bill.

---

## 2. Evaluation suite (all public except one small slice)

| Category | Benchmark | Size we run | License |
|---|---|---|---|
| End-to-end IB deliverables, rubric score | **BankerToolBench** | 10–20 tasks in dev, 100 for releases | Apache-2.0 / CC-BY-4.0 |
| Fact extraction, numerical / ratios, trends, risk, citation evidence | **SECQUE** (primary) | 565 | MIT (evaluation-only) |
| Adversarial hallucination / refusal | **FailSafeQA** | 220 | MIT |
| Multi-hop cross-company + temporal multi-year | **Fin-RATE** (EC-QA + LT-QA splits) | ~250 sampled | MIT |
| Restatements (no public set covers this) | Internal slice from EDGAR XBRL history | ~20 | ours |
| Deal-risk P/R, cross-output consistency | Internal labelled sets | ~30 each | ours |

Each suite is scored with its own published judge so our numbers compare with published results. We add a numeric-tolerance check for calculation questions and log cost and latency per task.
Optional: FinanceBench-150 (CC-BY-NC) for internal comparison only.

---

## 3. Milestones

Each milestone ends with green offline tests and a short demo command.

### M1: Monorepo foundations and data layer (≈1–1.5 weeks)
- pnpm workspace, tsconfig base, Biome, Vitest, Lefthook, CI (Node + Python jobs), and `infra/docker-compose.yml` (Postgres + pgvector, LiteLLM, edgar-service).
- `packages/db`: Drizzle schema (companies, filings, chunks with `halfvec`, facts, evidence, jobs, traces, defects, artifacts) and migrations.
- **`services/edgar` (Python):** a FastAPI service over edgartools.
  - Routes: companies, filings, standardized statements (annual/quarterly), raw facts with dedupe, original-vs-restated values, filing sections with anchors, and full-text search.
  - A provenance model on every line, Pydantic contracts, and pytest with recorded fixtures.
- `packages/sources`: the TS client generated from OpenAPI (`pnpm gen:edgar`), a mapper into `Fact`/`Evidence`, chunking with anchors, embeddings, and hybrid search.
- `packages/finance`: ratios, UFCF, WACC/CAPM, terminal value (Gordon + exit), EV→equity bridge, TSM, comps stats, sensitivity grids. All of it is covered by hand-computed and property tests.
- **Done when:** `pnpm cli facts AAPL` prints cited facts, and the finance tests are 100% green.

### M2: Express API, worker, gateway, Research and Modeling agents (✅ done 2026-11-21)

**Verified live:** `pnpm cli chat` (graph only) and `pnpm cli e2e` (real HTTP: auth → API → pg-boss → worker → LangGraph → SSE → stored messages). A first valuation takes 20–80 s and costs about $0.002; a follow-up recompute takes 1–10 s with no SEC or model reading. Beta now uses Damodaran industry betas. Known gaps: Twelve Data live check (its key was rejected), a longer DCF horizon for high-growth companies (a 5-year fade to 2.5% undervalues them, e.g. MSFT ≈ $139 vs $484), pacing the free Gemini embedding quota when indexing a 10-K.

- `apps/api` (chat API, auth-protected via `@dealpilot/auth`):
  - `POST /threads` and `GET /threads`
  - `POST /threads/:id/messages`, which enqueues a task
  - `GET /threads/:id/events` (SSE: agent steps, tokens, panel updates)
  - `GET /artifacts/:id` (presigned download)
  - Zod-validated routes and one error middleware
- `packages/db`: new `threads` and `messages` tables, linked to the Neon Auth user id. Each message links to its task, trace and artifacts.
- **Orchestrator intent routing** sorts each chat message into one of three types:
  - (a) a new analysis, which runs the full graph
  - (b) a follow-up recompute, such as a different WACC or peers; it reruns only the finance tools on cached facts, with no LLM reading
  - (c) a question about evidence, which is RAG over the cited chunks
- `apps/worker`: a pg-boss consumer that runs the graph with the Postgres checkpointer.
- `packages/llm`: client for LiteLLM model groups per role, structured output with Zod, response cache, budget cap, and Langfuse tracing.
- `packages/graph` + agents: Orchestrator, Research (facts + evidence), and Modeling (tool calls into finance; peers by SIC, size and 10-K text similarity).
- **Done when:** posting "Value Apple with a DCF and comps" to a thread streams agent steps over SSE and ends with a cited answer and a DCF + comps in state, at ≤ $0.05 on the free or budget stack. A follow-up "What if WACC is 9%?" recomputes with zero LLM reading.

### M3: Verification loop, Forensic and Skeptic agents (≈1–1.5 weeks)
- A Verifier with a fresh context. It recomputes figures through finance, resolves citations to spans and checks the quotes support the claims, and runs integrity and consistency checks.
- A defect schema, routed back to the owning agent with `maxRetries` per type. Unresolved defects are surfaced in the output.
- Forensic agent: rule-based red flags first, then LLM reading of the notes. Skeptic agent: argues against assumptions, builds alternative scenarios, reruns sensitivities.
- **Done when:** the error-injection test set (wrong number, fake citation, period mismatch) is caught and corrected.

### M4: Deliverables and audit trail (≈1 week)
- An ExcelJS workbook with live formulas, tabs for Inputs / Model / DCF / Comps / Sensitivity / Sources / Defects, and a LibreOffice parity test.
- A deal memo (Markdown → `.docx`) with evidence footnotes, plus an audit-trail export (JSON + timeline).

### M5: Evaluation harness (≈1–1.5 weeks)
- An `evals/` runner with `--estimate`, `compare`, and the live-run guard. Adapters for BTB, SECQUE, FailSafeQA and Fin-RATE, plus the internal slices.
- A model-per-role bake-off that picks the cheapest model passing each node's quality bar.

### M6: Next.js chat app, deliverable panel and deployment (≈1.5–2 weeks)
- **Chat (left):**
  - thread list, plus sign-up and sign-in (Neon Auth)
  - streaming messages, with agent steps shown as collapsible progress items
  - suggested follow-ups
  - every number rendered as a citation chip that opens the source quote
- **Deliverable panel (right):** opens with the first result and updates live.
  - tabs: Summary · DCF · Comps · Sensitivity (heatmap) · Risks · Evidence · Defects
  - downloads for the `.xlsx` and the memo
- **`/admin` (owner only):** eval scores, cost and latency per run. This replaces the old "dashboard" idea.
- Deployment, AWS:
  - `infra/docker-compose.prod.yml` (arm64 images, Caddy TLS, health checks, restart policies) and an EC2 bootstrap script (Docker, swap, compose up).
  - GitHub Actions deploy over SSH (or SSM), and AWS Budgets alerts.
  - Next.js on Vercel.
- Portability: a `render.yaml` kept ready for the post-credits move, plus the warm-up and heartbeat logic for free-tier hosts.
- Market-price adapter (FMP free, Tiingo fallback), with a Postgres cache, source attribution, and a "demo / not investment advice" banner.
- **Done when:** the public Vercel URL, backed by EC2, runs an AAPL analysis end to end, and the chat answer and the panel show the price, DCF, comps, evidence and defects. A follow-up message updates the panel.

**Total:** about 7–9 weeks for one developer with Claude Code. Using edgartools removes the week we would have spent building our own XBRL normalizer. M1–M4 is the minimum demo.

---

## 4. Decisions (all resolved)

| Decision | Choice |
|---|---|
| Backend / frontend | Node.js + Express (TS) / **Next.js chat app with a deliverable side panel** |
| Python services | edgar-service (edgartools), LiteLLM proxy |
| Benchmarks | BankerToolBench, SECQUE, FailSafeQA, Fin-RATE + a small restatement slice |
| Project type | Portfolio / learning project: no real users, public SEC data only |
| Hosting | **AWS Free plan**: one EC2 `t4g.small` running Docker Compose (api + worker, edgar-service, litellm), paid from credits, with **Neon** for Postgres, Auth and object storage for about 6 months. **Vercel Hobby** for Next.js. After the credits end, Render Free + Neon Free ($0) or about $17/mo on AWS |
| Market prices | Free (FMP / Tiingo), cached, with attribution. Nothing to buy |
| LLMs | Free tiers for producers; **your Anthropic key** for Sonnet 5.5 verifier, skeptic and writer, and Haiku 5.5 as fallback |

**What I'll need from you, and when:**
- **M1:** your SEC User-Agent contact email, which you put in your own `.env`; I won't read or write that file.
- **M2:** your Anthropic key and free-tier keys (Gemini, Groq, OpenRouter) in `.env`.
- **M6:** an AWS account (you create it and set up billing alerts; I won't handle card or login details), a Vercel account, and a free FMP key.

---

## 5. Already done (M0)
- README, CLAUDE.md / AGENTS.md agent rules (Node/Express/Next.js), `.gitignore`, `.env.example`, `lefthook.yml` (Biome, gitleaks, finance purity).
- Claude Code hooks in Node, all 19 tests passing (including ruff formatting of Python services via uv):
  - path guard (secrets, `evals/golden/`, `data/raw/`)
  - bash guard (force-push, hard reset, broad `rm`, reading `.env`, destructive Drizzle commands, live evals without opt-in)
  - post-edit Biome formatting, plus the purity check for `packages/finance`
- Project skills: `/sec-edgar`, `/fin-calc`, `/new-agent`, `/run-evals`. Subagents: `finance-reviewer`, `eval-analyst`.
- Research: stack/cost report, plus the benchmark alternatives notes.
