# Low-cost web search, page extraction, embeddings and reranking for DealPilot (as of Nov 16-17, 2026)

Research date: 2026-11-17. Pricing pages were fetched where possible. Many vendor pricing figures came only from third-party aggregators (costbench, usagepricing, apiserpent and similar), which conflict with each other. Each is labelled "official" or "third-party". Anything from training knowledge (not re-verified this session) is labelled **[unverified - training knowledge]** and appears only in Gaps or Inferences.

## Search APIs: free tiers, prices, quality, integration and ToS

### Takeaway
As of Nov 2026, the main *recurring* free search quotas are:
- Tavily: 1,000 credits/month.
- Exa: $10/month in credits, about 2,500 Lite searches.
- Brave: a $5/month credit, about 1,000 searches, card required.
- Gemini 2.5 Flash grounding: 500 requests/day on the free tier.
- DuckDuckGo (`ddgs`): unlimited but unofficial and rate-limited.
- SearXNG: self-hosted.

Serper is a one-time 2,500 grant. SerpAPI gives about 250/month. Google Custom Search JSON API is closed to new customers and shuts down on Jan 1, 2027, so it is not an option.

### Cited Findings
**Tavily**
- Free tier is 1,000 API credits/month with no credit card. Pay-as-you-go is $0.008/credit (official docs, fetched via search snippet Nov 2026). — [Tavily docs: API credits](https://docs.tavily.com/documentation/api-credits.md)
- Paid "Project" plan is reported at $30/month for 4,000 credits (third-party). CostBench lists a conflicting "$100/month Startup" plan. — [ColdIQ Tavily pricing](https://coldiq.com/blog/tavily-pricing); [CostBench Tavily](https://www.costbench.com/software/web-scraping/tavily/)

**Exa** (official pricing doc, fetched Nov 17, 2026; the page carries no effective date)
- Search per 1k requests (up to 10 results): `lite` $4, `instant` $4, `auto`/`fast` $7. Deep search: `deep-lite`/`deep` $12, `deep-reasoning` $15. — [Exa pricing docs](https://exa.ai/docs/reference/pricing.md)
- Contents cost $1 per 1k pages per content type (text, highlights, summary). Answer costs $5 per 1k. — [Exa pricing docs](https://exa.ai/docs/reference/pricing.md)
- Free credits: $10 for new accounts, which "resets to $10 on the first of every month", with no payment method required. A one-time $10 bonus is paid after dashboard onboarding. Enterprise is $12,000/yr with 25 QPS. — [Exa pricing docs](https://exa.ai/docs/reference/pricing.md)
- Conflict: a third-party July 2026 note says the signup credit "doubled" (to $20). The official doc fetched now says $10 plus a $10 onboarding bonus. The Lite tier launched about Oct 23, 2026 (third-party tracker). — [usagepricing Exa signup credit](https://usagepricing.com/blueprint/activity/exa-ai-2026-07-29-signup-credit-doubled); [usagepricing Exa Lite launch](https://www.usagepricing.com/blueprint/activity/exa-ai-2026-10-23-lite-search-launch)

**Brave Search API** (the official plans page did not render, so all figures are third-party)
- Reportedly, the 2,000 queries/month free tier was removed in Feb 2026. It was replaced by a $5 monthly credit (about 1,000 searches at $5/1k) on Search and Answers. A credit card is required, overages are uncapped, and attribution is required. — [apiserpent: Free Brave Search API](https://apiserpent.com/blog/free-brave-search-api); [agentdeals Brave](https://agentdeals.dev/vendor/brave-search-api)
- CostBench puts paid usage at $4-$5 per 1k as of Sep 2026. Older pages list about $3/1k and the old 2,000/month free tier, and are likely stale. — [CostBench Brave price history](https://costbench.com/software/ai-search-apis/brave-search-api/price-history/)

**Serper / SerpAPI** (third-party only)
- Serper's free tier is a one-time 2,500 queries, not monthly. Paid is about $50 for 50k ($1/1k), down to about $0.30/1k at volume. One source reports that serper.dev/pricing returns 404, so the figures are unverified. — [apiserpent: Serper pricing](https://apiserpent.com/blog/serper-pricing-credits-explained); [Serper vs SerpApi (fastcrw)](https://fastcrw.com/alternatives/serper-vs-serpapi)
- SerpAPI's free plan is about 250 searches/month at 50/hour; one source says 100. Paid starts at $25/month for 1,000 searches. — [apiserpent: SerpApi pricing](https://apiserpent.com/blog/serpapi-pricing-explained); [CostBench SerpApi free plan](https://costbench.com/software/web-scraping/serpapi/free-plan/)

**Jina (s.jina.ai search, r.jina.ai reader)** (third-party only; official dashboard not checked)
- Each new API key gets 10M free tokens shared across Reader, Search, Embeddings and Reranker; one source says 1M. Reader works without a key at about 20 RPM. One source says Search costs at least 10,000 tokens/request, so the free tokens cover at most about 1,000 searches. — [activepieces Jina pricing](https://www.activepieces.com/blog/jina-ai-api-pricing-token-costs-limits-2026); [xpay Jina Reader](https://www.xpay.sh/saas-pricing/jina-reader)
- **ToS caveat:** the free tokens are reportedly "restricted to non-commercial use under a CC-BY-NC license". This most likely refers to the open *model weights* (jina-embeddings/reranker on HF) rather than the API. Confirm before relying on it. — [activepieces Jina pricing](https://www.activepieces.com/blog/jina-ai-api-pricing-token-costs-limits-2026)

**Firecrawl** (search + scrape)
- The official pricing page lists Free at 1,000 credits/month, $0, no card, 2 concurrent requests and "low rate limits". Earlier in 2026 it was a 500 one-time credit. One credit is about one basic scraped page. — [Firecrawl pricing](https://www.firecrawl.dev/pricing); [eesel Firecrawl pricing 2026](https://www.eesel.ai/blog/firecrawl-pricing)

**DuckDuckGo (`ddgs`)**
- The `duckduckgo_search` package was renamed to `ddgs` (`pip install ddgs`). — [PyPI duckduckgo-search](https://pypi.org/project/duckduckgo-search)
- Users report HTTP 202 "Ratelimit" responses in agent frameworks. The fix was about 1 req/s limiting, exponential backoff and caching. — [Agno community thread](https://community.agno.com/t/duckduckgo-search-rate-limit-issue/1021); [MetaGPT issue #1567](https://github.com/FoundationAgents/MetaGPT/issues/1567)
- It is an unofficial scraper; the README says "educational purposes only". A SERP vendor blog (biased source) claims the ratelimit exception is not reliably raised and reports 403s on news via the DDG backend. — [apiserpent: Free DuckDuckGo API](https://apiserpent.com/blog/free-duckduckgo-api)

**Google Programmable Search (Custom Search JSON API)**
- It is closed to new customers and scheduled to shut down Jan 1, 2027. Google points to Vertex AI Search (being renamed "Agent Search"), which searches up to 50 domains and is *not* a full-web replacement. — [Brave: Google API shutdown](https://brave.com/learn/google-api-shutdown/); [Firecrawl: Google Search JSON API alternative](https://www.firecrawl.dev/blog/google-search-json-api-alternative); [Apify migration guide](https://blog.apify.com/google-custom-search-api-alternative/)

**Gemini Grounding with Google Search** (official AI Studio pricing page, fetched Nov 17, 2026)
- Gemini 2.5 Flash / Flash-Lite: the free tier allows "up to 500 RPD" (shared). The paid tier gets 1,500 RPD free, then $35 per 1,000 grounded prompts. — [Gemini API pricing](https://aistudio.google.com/docs/pricing)
- Gemini 2.5 Pro: no grounding on the free tier. Paid gets 1,500 RPD free, then $35/1k. — [Gemini API pricing](https://aistudio.google.com/docs/pricing)
- Gemini 3+ models (e.g. `gemini-3.8-flash`, `gemini-3.1-flash-lite`): **not available on the free tier**. Paid gets 5,000 free search requests/month shared across Gemini 3+, then $14/1k, with a 1,500/day cap. One grounded prompt can trigger multiple billed queries. — [Gemini API pricing](https://aistudio.google.com/docs/pricing); [Google AI forum on 429 after monthly allowance](https://discuss.ai.google.dev/t/429-resource-exhausted-on-gemini-3-standard-api-search-grounding-after-monthly-free-tier-exhausted-pay-as-you-go-billing-not-activating-tier-3/167290)
- **ToS caveat:** free-tier data for 2.5 Flash/Flash-Lite/3.x Flash and Gemini Embedding is "used to improve products". — [Gemini API pricing](https://aistudio.google.com/docs/pricing)

**Anthropic web search tool**
- $10 per 1,000 searches plus token costs, since results count as input tokens. Failed searches are not billed. Can be allowed or blocked at org level (launch May 2025; still cited at $10/1k in 2026 articles). — [TechCrunch May 2025](https://techcrunch.com/2025/05/07/anthropic-rolls-out-an-api-for-ai-powered-web-search/); [Parallel: save money on Claude API (Oct 2026)](https://parallel.ai/articles/how-to-save-money-on-claude-api)
- Vendor claim (Parallel, biased): Parallel Search API at $1/1k requests. — [Parallel article](https://parallel.ai/articles/how-to-save-money-on-claude-api)

### Inferences
- For DealPilot's research agents, a good default is Tavily, which offers a free monthly quota and `langchain-tavily` integration [integration package name: unverified - training knowledge]. Exa Lite is a second option (about 2,500 free searches/month, strong semantic search for "companies like X" peer discovery). `ddgs` is the zero-cost fallback behind a rate limiter. Exa's neural "similar companies" search is well suited to peer-company discovery.
- Gemini grounding is attractive only on 2.5 Flash/Flash-Lite (500 free RPD). The free-tier data-use clause makes it unsuitable for confidential deal context. Grounded answers are synthesized text rather than raw URLs, so evidence tracing is weaker.
- Avoid building on the Google CSE JSON API (dies Jan 1, 2027) and on Brave's old free tier (gone).

### Gaps
- **OpenAI web search tool and Perplexity Sonar pricing were not found in this session.** [Unverified - training knowledge, ~mid-2025]: OpenAI web search tool calls were about $10-$25/1k plus tokens depending on model. Sonar was about $1/M tokens plus $5-$12 per 1k requests by context size. Neither has a meaningful free tier. Verify on the vendors' pricing pages.
- Tavily's credit cost per search depth (basic vs. advanced, and Extract) was not confirmed. [Unverified - training knowledge]: basic = 1 credit, advanced = 2.
- The Brave official plans page did not render. The $5 credit, the price and the AI-use/storage rights terms are third-party only.
- SearXNG: no 2026 source was gathered. It is free, self-hosted and AGPL. It meta-searches upstream engines, which may rate-limit or block it, and it needs the JSON output format enabled [unverified - training knowledge].
- No independent 2025-2026 quality benchmark of search APIs for agents was retrieved. Most comparison pages are written by competing vendors (you.com, Firecrawl, Parallel, apiserpent).

## Page reading / extraction (Jina Reader, Firecrawl, trafilatura, crawl4ai, Playwright)

### Takeaway
Paid/hosted options include Jina Reader (keyless at about 20 RPM, token-billed with a key) and Firecrawl (1,000 free credits/month, 2 concurrency). For a free-first stack, self-hosted extraction with trafilatura, plus crawl4ai/Playwright for JS-heavy pages, avoids quotas entirely.

### Cited Findings
- Jina Reader is usable without a key at about 20 RPM. Keyed usage draws on the shared token pool (third-party). — [activepieces Jina pricing](https://www.activepieces.com/blog/jina-ai-api-pricing-token-costs-limits-2026)
- Firecrawl Free gives 1,000 credits/month (about 1 credit per basic page scrape) at 2 concurrent requests. It can also be self-hosted. — [Firecrawl pricing](https://www.firecrawl.dev/pricing); [webscraping.ai Firecrawl guide](https://webscraping.ai/blog/firecrawl-guide)
- Exa Contents costs $1 per 1k pages per content type, so it is a cheap way to get clean text for URLs Exa returns. — [Exa pricing docs](https://exa.ai/docs/reference/pricing.md)

### Inferences
- The recommended pipeline: `httpx` fetch, then `trafilatura.extract()` for news and articles (fast, CPU-only). Escalate to crawl4ai (Playwright-backed, produces markdown) only for JS-rendered pages. Use Jina Reader as a zero-setup fallback. SEC filings themselves should come from EDGAR, not these tools.

### Gaps
- No 2026 sources were fetched for trafilatura, crawl4ai or Playwright. [Unverified - training knowledge]: trafilatura is Apache-2.0 (earlier GPL), consistently top-ranked in academic boilerplate-removal benchmarks, and CPU-only. crawl4ai is Apache-2.0, built on Playwright, outputs LLM-ready markdown, and has LangChain community loaders. Playwright is Apache-2.0 and needs about 200-400 MB of Chromium. Verify licenses and versions.
- Site ToS and robots.txt compliance is the user's responsibility for all scrapers. Paywalled news sites (WSJ, FT, Bloomberg) generally prohibit scraping.

## Embeddings: local open-source models and API free tiers

### Takeaway
The best free *API* option is Voyage: 200M free tokens on voyage-4 family models, and 50M on voyage-finance-2. This is enough to embed tens of thousands of 10-K/10-Q filings once. Gemini Embedding is free on the free tier, but free-tier data is used to improve Google's products. Locally, Qwen3-Embedding-0.6B (1024-d, about 70.5 MTEB-Eng v2) and EmbeddingGemma-300M (768-d, about 68-69.7, small memory footprint) lead the sub-1B class. bge-m3 (1024-d, 8K context, dense+sparse) is the safe multilingual/hybrid choice.

### Cited Findings
**APIs**
- Voyage (official pricing doc, fetched Nov 17, 2026):

  | Model | Price | Free tokens |
  |---|---|---|
  | voyage-4-large | $0.12/M | 200M |
  | voyage-4 | $0.06/M | 200M |
  | voyage-4-lite | $0.02/M | 200M |
  | voyage-finance-2 | $0.12/M | 50M |

  — [Voyage pricing](https://docs.voyageai.com/docs/pricing); 50M figure for finance-2 also in [MongoDB Voyage docs](https://mongodb.com/docs/voyageai/models/)
- Gemini (official, fetched Nov 17, 2026): `gemini-embedding-001` is free on the free tier and $0.15/M paid. `gemini-embedding-2` is free on the free tier and $0.20/M paid for text. Free-tier data is "used to improve products". — [Gemini API pricing](https://aistudio.google.com/docs/pricing)
- Jina embeddings draw from the shared 10M free tokens per key (third-party), then about $0.05/M (one source). — [markaicode Jina pricing](https://markaicode.com/pricing/jina-ai-pricing/); [activepieces Jina](https://www.activepieces.com/blog/jina-ai-api-pricing-token-costs-limits-2026)
- Cohere trial key: free, but **not permitted for production/commercial use**. 1,000 API calls/month total across *all* endpoints. Embed limits are reported variously as 2,000 inputs/min or 100 RPM (third-party, conflicting). — [codenote: Cohere trial limits](https://codenote.net/en/posts/cohere-trial-api-key-pricing-and-limits/); [fast.io Cohere rate limits](https://fast.io/resources/cohere-rate-limit/)

**Local models** (secondary sources; scores come from mixed MTEB versions and are not strictly comparable)
- Qwen3-Embedding-0.6B: MTEB English v2 about 70.5 (EmbeddingGemma 2 tech-report figure); other sources say 70.7 or 71.7. Multilingual about 64.3. 1024-d, Matryoshka down to 32, 32K context. — [fourweekmba](https://fourweekmba.com/ai-google-paper-embeddinggemma-2-trails-qwen-on-text-not-code/); [codesota](https://codesota.com/tasks/text-embeddings); [dev.co](https://dev.co/ai/llms/qwen3-embedding-0-6b)
- EmbeddingGemma-300M: MTEB-Eng v2 about 69.67 (EmbeddingGemma 2 about 68.46). 768-d, Matryoshka down to 128. Context is listed as 2K or 8K (conflicting). An Ollama test showed about 542 MB RAM at 8K context, versus 5.8 GB for Qwen3-0.6B at default context. — [fourweekmba](https://fourweekmba.com/ai-google-paper-embeddinggemma-2-trails-qwen-on-text-not-code/); [regolo benchmarks](https://regolo.ai/?p=9111); [surrealdb comparison](https://surrealdb.com/blog/embedding-models-comparison)
- bge-m3: 1024-d, 8,192-token context, multilingual MTEB about 59.6. — [surrealdb comparison](https://surrealdb.com/blog/embedding-models-comparison); [codesota](https://codesota.com/tasks/text-embeddings)

### Inferences
- **Volume estimate.** A 10-K is roughly 50k-150k tokens, so one embedding pass over about 1,000 filings is about 0.1B tokens. Voyage's 200M free tokens cover the initial corpus build with room for re-indexing. After that, voyage-4-lite at $0.02/M makes re-embedding essentially free.
- **Pick EmbeddingGemma or bge-small/base for CPU-only dev boxes.** Pick Qwen3-Embedding-0.6B for best quality per parameter, but cap the context (512-2048 tokens per chunk) to control memory.
- **Matryoshka truncation saves storage.** Qwen3 at 1024 can be cut to 768/512, and EmbeddingGemma to 256. This reduces pgvector storage at modest quality loss.

### Gaps
- No session sources were found for these models:
  - bge-small-en-v1.5 / bge-base-en-v1.5. [Unverified - training knowledge]: 384-d / 768-d, about 33M / 110M params, MTEB-Eng v1 about 62 / 63.5, 512-token context, MIT license. These are the fastest on CPU.
  - nomic-embed-text v1.5 / v2. [Unverified]: v1.5 is 768-d Matryoshka with 8K context and needs `search_query:`/`search_document:` prefixes. v2 is MoE, multilingual and 512 context. Apache-2.0.
  - Snowflake arctic-embed-m/l v2.0. [Unverified]: 768/1024-d, strong retrieval (BEIR), Apache-2.0.
  - gte-modernbert / gte-Qwen2. [Unverified]: gte-Qwen2-7B is high-scoring but too heavy for CPU.
  - Mistral embed. [Unverified]: 1024-d, about $0.10/M, with a free "Experiment" tier that has data-use terms.
  - OpenAI text-embedding-3-small. [Unverified]: $0.02/M ($0.01/M batch), 1536-d. text-embedding-3-large is $0.13/M, 3072-d.
- Measured CPU throughput (docs/sec) for these models was not found. Benchmark locally.
- The live MTEB leaderboard was not fetched in this session.

## Reranking (bge-reranker-v2-m3, Jina, Cohere, Voyage)

### Takeaway
Voyage rerank-2.5 and rerank-2.5-lite list 200M free tokens, though the doc is internally ambiguous. This is the best free hosted reranker. Locally, bge-reranker-v2-m3 (about 568M params, Apache-2.0 [unverified - training knowledge]) is free with no quota. The Cohere trial is too small (1,000 calls/month across all endpoints) and bars production use.

### Cited Findings
- Voyage rerank-2.5 is $0.05/M tokens and rerank-2.5-lite is $0.02/M, each with 200M free tokens. However, the same page's "older models" section says older models get no free tokens and lists these rerankers there, so the doc is contradictory (official, fetched Nov 17, 2026). — [Voyage pricing](https://docs.voyageai.com/docs/pricing)
- Cohere Rerank on a trial key runs 10 RPM (one source says 5) within the 1,000 calls/month global cap, then returns 429 until the next month. Commercial use is not permitted. — [codenote: Cohere trial](https://codenote.net/en/posts/cohere-trial-api-key-pricing-and-limits/); [fast.io Cohere rate limits](https://fast.io/resources/cohere-rate-limit/)
- Jina reranker free-tier limits are reported at 100 RPM and 100K TPM, drawing on the shared token pool (third-party). — [activepieces Jina pricing](https://www.activepieces.com/blog/jina-ai-api-pricing-token-costs-limits-2026)
- pgvector's README recommends merging full-text and vector results with Reciprocal Rank Fusion or a cross-encoder reranker. — [pgvector README](https://github.com/pgvector/pgvector)
- One EmbeddingGemma 2 vs. Qwen3 benchmark also covers reranking. — [regolo benchmarks](https://regolo.ai/embeddinggemma-2-vs-qwen3-embedding-benchmarks.md)

### Inferences
- **CPU cost of local reranking.** bge-reranker-v2-m3 on CPU reranking top-50 x 512-token chunks will likely take seconds per query. That is acceptable for an analyst agent but slow interactively. A smaller cross-encoder (bge-reranker-base, about 278M) or Voyage rerank-2.5-lite reduces latency.

### Gaps
- No session source was found for bge-reranker-v2-m3 specs or license, or for Jina reranker v2/v3 licensing. Jina's open reranker weights are commonly CC-BY-NC [unverified - training knowledge], which matters for commercial self-hosting.
- Cohere Rerank paid price was not retrieved. [Unverified - training knowledge]: about $2 per 1k searches (rerank-v3.5).

## pgvector specifics and hybrid search

### Takeaway
pgvector 0.8.7 indexes up to 2,000 dims for `vector` and 4,000 for `halfvec` (HNSW and IVFFlat). Storage is 4·d+8 bytes (`vector`) or 2·d+8 bytes (`halfvec`) per row. One million 1024-d chunks is about 4.1 GB raw as `vector` and about 2.06 GB as `halfvec`, before the HNSW index. Hybrid (tsvector BM25-style + vector, fused with RRF) is recommended by pgvector itself and supported by FinMTEB's finding that bag-of-words beats dense models on financial STS.

### Cited Findings
- Latest version is 0.8.7. Max storable dims are 16,000 for `vector` and `halfvec`. `sparsevec` allows up to 16,000 non-zeros. — [pgvector README](https://github.com/pgvector/pgvector)
- Index limits (HNSW and IVFFlat):

  | Type | Max indexed dims |
  |---|---|
  | `vector` | 2,000 |
  | `halfvec` | 4,000 |
  | `bit` | 64,000 |
  | `sparsevec` (HNSW) | 1,000 non-zeros |

  — [pgvector README](https://github.com/pgvector/pgvector)
- Storage per row is `vector` = 4×d + 8 bytes and `halfvec` = 2×d + 8 bytes. — [pgvector README](https://github.com/pgvector/pgvector)
- pgvector is designed to be combined with Postgres full-text search, with RRF or cross-encoder fusion examples linked. — [pgvector README](https://github.com/pgvector/pgvector)
- FinMTEB found that "traditional Bag-of-Words models surpass dense embedding models on financial STS tasks". — [FinMTEB arXiv 2502.10990](https://arxiv.org/abs/2502.10990v2)

### Inferences
Computed from the README formula; raw column data only, excluding the HNSW index, TOAST and row overhead:

| Dims | `vector` per 1M rows | `halfvec` per 1M rows | Notes |
|---|---|---|---|
| 384 | 1.54 GB | 0.78 GB | |
| 768 | 3.08 GB | 1.54 GB | |
| 1024 | 4.10 GB | 2.06 GB | |
| 1536 | 6.15 GB | 3.08 GB | |
| 2048 | 8.20 GB | 4.10 GB | Indexable only as `halfvec` |
| 3072 | 12.3 GB | 6.15 GB | Indexable only as `halfvec` |

- An HNSW index typically adds roughly another 1-2x of the vector data size [unverified estimate].
- Hybrid search is likely worth it for SEC text. Exact tokens such as tickers, CUSIPs, "EBITDA", segment names, covenant terms and line-item labels ("Total net revenue") are where dense retrieval is weak and lexical matching is strong. Start with built-in `tsvector` + `ts_rank_cd` and RRF, which is free with no extension. Consider ParadeDB `pg_search` (true BM25) only if ranking quality is insufficient.
- Use `halfvec` by default, since the quality loss from fp16 is negligible for retrieval [unverified - training knowledge].

### Gaps
- ParadeDB `pg_search` was not researched in this session (license AGPL-3.0, managed-Postgres availability, BM25 quality vs. ts_rank) [unverified - training knowledge: AGPL; not available on most managed Postgres such as RDS].
- No quantitative SEC-specific benchmark of hybrid vs. dense-only retrieval was found.

## Do finance-specific embeddings beat general ones on SEC filings?

### Takeaway
FinMTEB (EMNLP 2025, 64 datasets) finds that domain-adapted models "significantly outperform" general ones, and that general MTEB scores poorly predict finance performance. However, the top model (Fin-E5, 7B) is large and may not have public weights. voyage-finance-2 is the practical hosted finance model (50M free tokens). No independent head-to-head versus 2026-generation general models (voyage-4, Qwen3-Embedding) on SEC 10-K retrieval was found.

### Cited Findings
- FinMTEB has 64 datasets across 7 task types, English and Chinese, and evaluates 15 models. Domain-specific models including Fin-E5 significantly outperform general-purpose models. General-benchmark performance is a poor predictor of financial-task success. — [FinMTEB arXiv](https://arxiv.org/abs/2502.10990v2); [ACL Anthology EMNLP 2025](https://preview.aclanthology.org/ingest-emnlp/2025.emnlp-main.179)
- Fin-E5 is a finance-adapted e5-Mistral-7B-Instruct trained on persona-based synthetic data, and ranks first on FinMTEB. — [FinMTEB arXiv](https://arxiv.org/abs/2502.10990v2)
- A self-reported HF model card cites Fin-E5 at a 0.677 overall mean on English FinMTEB (18 models), and claims Fin-E5 weights are not public. This contradicts the paper's stated intent to open-source. — [FinModernBERT-embed-large card](https://huggingface.co/BatuhanECB/FinModernBERT-embed-large-v1)
- voyage-finance-2 costs $0.12/M with 50M free tokens. — [Voyage pricing](https://docs.voyageai.com/docs/pricing)

### Inferences
- The FinMTEB comparisons predate voyage-4 and Qwen3-Embedding. Newer general models may close the gap, so DealPilot should build a small eval set and run an A/B test. A reasonable set is about 100 analyst questions with gold chunks from 10-Ks, comparing voyage-finance-2, voyage-4-lite, bge-m3 and Qwen3-0.6B (recall@10, nDCG@10). The test is cheap within the free token allowances.
- Reranking plus hybrid BM25 probably matters more than finance-specific embeddings for SEC retrieval.

### Gaps
- No public FinMTEB score for voyage-finance-2 or 2026 models was retrieved.
- No result was found for SEC-filing-specific retrieval benchmarks (e.g. FinanceBench retrieval, FinQA/TAT-QA retrieval) comparing these models.

## Comparison table (all figures dated Nov 2026 unless noted)

| Option | Category | Free tier | Paid price | Quality / notes | LangChain/LangGraph | ToS caveats | Confidence |
|---|---|---|---|---|---|---|---|
| Tavily | Search+extract | 1,000 credits/mo, no card | $0.008/credit PAYG; ~$30/mo for 4k | Agent-oriented, returns cleaned snippets | `langchain-tavily` [unverified] | Standard | Official (free/PAYG) |
| Exa | Neural search + contents | $10/mo credit (~2,500 Lite), no card | Lite/instant $4/1k; auto/fast $7/1k; contents $1/1k pages | Strong for "similar companies" | `langchain-exa` [unverified] | Standard | Official |
| Brave Search API | Search | $5/mo credit (~1k), card required | ~$4-5/1k | Independent index | `BraveSearch` community tool [unverified] | Attribution required; uncapped overage | Third-party |
| Serper | Google SERP | 2,500 one-time | ~$1/1k down to $0.30/1k | Google results, cheap | `GoogleSerperAPIWrapper` [unverified] | Scraped Google | Third-party |
| SerpAPI | Google SERP | ~250/mo | from $25/mo for 1k | Broad engine coverage | `SerpAPIWrapper` [unverified] | | Third-party |
| Jina s.jina.ai / r.jina.ai | Search + reader | 10M tokens/key (1M per one source); Reader keyless ~20 RPM | token-based | Search ≥10k tokens/call | `JinaSearch` community [unverified] | Possible non-commercial restriction to confirm | Third-party |
| Firecrawl | Scrape/search | 1,000 credits/mo, 2 concurrency | paid plans (not retrieved) | JS rendering, markdown | `FireCrawlLoader` [unverified] | Self-host option | Official (free) |
| ddgs | Search (scraper) | Unlimited but rate-limited (~1 req/s) | — | Unreliable; 202/403 reports | `DuckDuckGoSearchRun` [unverified] | Unofficial; "educational purposes" | Mixed |
| SearXNG | Meta-search (self-host) | Free | Hosting cost | Depends on upstream engines | `SearxSearchWrapper` [unverified] | AGPL [unverified] | Not researched |
| Google CSE JSON API | Search | Closed to new customers | — | **Shuts down Jan 1, 2027** | — | — | Multiple sources |
| Gemini grounding | LLM-integrated search | 2.5 Flash/Flash-Lite: 500 RPD; Gemini 3: none | 2.5: 1,500 RPD free then $35/1k; 3+: 5k/mo free then $14/1k | Synthesized answers + citations | via `langchain-google-genai` [unverified] | Free-tier data used to improve products | Official |
| Anthropic web search | LLM-integrated | none | $10/1k + tokens | | native tool | | Third-party + 2025 launch |
| OpenAI web search / Perplexity Sonar | LLM-integrated | none [unverified] | not retrieved | | | | Gap |
| Voyage embeddings | Embeddings | 200M tokens (voyage-4 family); 50M finance-2 | $0.02 / $0.06 / $0.12 per M; finance-2 $0.12/M | voyage-finance-2 domain model | `langchain-voyageai` [unverified] | | Official |
| Gemini embedding | Embeddings | Free on free tier | $0.15/M (001), $0.20/M (2) | | `GoogleGenerativeAIEmbeddings` [unverified] | Free-tier data used to improve products | Official |
| Jina embeddings | Embeddings | shared 10M tokens | ~$0.05/M (one source) | | `JinaEmbeddings` [unverified] | Weights CC-BY-NC [unverified] | Third-party |
| Cohere trial | Embed + rerank | 1,000 calls/mo total, all endpoints | not retrieved | | `langchain-cohere` [unverified] | No production/commercial use | Third-party |
| Qwen3-Embedding-0.6B | Local embed | Free | — | ~70.5 MTEB-Eng v2, 1024-d, 32K ctx, MRL | HuggingFaceEmbeddings | Apache-2.0 [unverified] | Secondary |
| EmbeddingGemma-300M | Local embed | Free | — | ~69.7 MTEB-Eng v2, 768-d, MRL, ~0.5 GB RAM | HuggingFaceEmbeddings | Gemma terms [unverified] | Secondary |
| bge-m3 | Local embed | Free | — | 1024-d, 8K ctx, ~59.6 multilingual MTEB | HuggingFaceEmbeddings | MIT [unverified] | Secondary |
| Voyage rerank-2.5 / -lite | Rerank | 200M tokens (doc ambiguous) | $0.05 / $0.02 per M | | `VoyageAIRerank` [unverified] | | Official (ambiguous) |
| Cohere Rerank trial | Rerank | 10 RPM within 1,000 calls/mo | not retrieved | | `CohereRerank` | No production use | Third-party |
| Jina reranker | Rerank | 100 RPM / 100K TPM, shared tokens | token-based | | `JinaRerank` [unverified] | | Third-party |
| bge-reranker-v2-m3 | Local rerank | Free | — | Strong multilingual cross-encoder | `CrossEncoderReranker` | Apache-2.0 [unverified] | Not re-verified |

### Recommended free setup (inference)
1. **Search:** Use Tavily (1k/month) as the primary for news and industry context, and Exa Lite ($10/month credit) for peer-company discovery. Fall back to `ddgs` behind a 1 req/s limiter, retries and a cache. Optionally self-host SearXNG. Avoid the Google CSE JSON API.
2. **Extraction:** Use trafilatura first, crawl4ai/Playwright for JS-heavy pages, and Jina Reader (keyless) as a fallback. Use EDGAR full-text and the XBRL APIs for filings.
3. **Embeddings:**
   - Corpus build: voyage-4-lite or voyage-finance-2 (free tokens).
   - Fully local option: EmbeddingGemma-300M (CPU-friendly) or Qwen3-Embedding-0.6B (best quality, cap the context).
   - Storage: `halfvec(1024)` or smaller, with an HNSW index.
4. **Retrieval:** Fuse Postgres `tsvector` full-text search with pgvector using RRF, then rerank the top 30-50 with bge-reranker-v2-m3 locally or Voyage rerank-2.5-lite (free tokens).
5. **Avoid in production:** Cohere trial keys (no commercial use) and Gemini free tier for confidential data (data used for training).

### Upgrade path (inference)
- **Search:**
  1. Tavily PAYG ($0.008/credit) or Exa PAYG ($4-7/1k).
  2. Serper (~$1/1k) for cheap Google SERP.
  3. Gemini 2.5 Flash paid grounding (1,500 RPD free on the paid tier) if synthesized grounded answers are useful.
- **Extraction:** Firecrawl paid only if self-hosted crawl4ai becomes an ops burden.
- **Embeddings:** Voyage paid ($0.02-$0.12/M), since a re-index of the full corpus costs only dollars.
- **Rerank:** Voyage rerank-2.5 ($0.05/M).
- **BM25:** ParadeDB `pg_search` if `ts_rank` proves insufficient (check its AGPL license and managed-Postgres support).
- **Evaluate first:** build a 100-question SEC eval set before paying for finance-specific models.
