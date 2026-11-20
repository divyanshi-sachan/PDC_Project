# Free and Low-Cost LLM Options and Cost Optimization for DealPilot (state as of 2026-11-17)

Research date: 2026-11-17. All official pages were fetched on 2026-11-17. Most official pricing and rate-limit pages have **no visible "last updated" date**, so "fetched 2026-11-17" is the only date available for them. Third-party pages are marked with their own stated date.

**Big-picture warning for the report writer:** the model landscape in Nov 2026 is very different from 2025. Current names include Gemini 4 (Carbon/Argon/Hydrogen) and Gemini 3.x Flash, Claude Fable/Mythos/Opus 5.5/Sonnet 5.5/Haiku 5.5, GPT-6 (astra/sol/terra/luna), DeepSeek V4, and Qwen 3.8. Several free tiers seen in 2024–25 have shrunk or gone: **GitHub Models was retired on 2026-07-30**, Together has no free tier, and Cerebras and SambaNova now give small trial credits. Google, Groq and Mistral no longer publish free-tier numbers publicly; you only see them in the logged-in console.

---

## 1. Free tiers: limits, data use, tool calling

### Takeaway
A truly free, sustainable multi-agent stack is fragile in Nov 2026. Free tiers are small, often published only inside the console, and the biggest one (Gemini) trains on your data outside the EEA/UK/CH. The most usable free sources are Gemini AI Studio's free tier (for public SEC-filing text only), Groq's and Cerebras's small daily allowances, OpenRouter `:free` (1,000 RPD after a one-time $10 credit purchase), NVIDIA build.nvidia.com (~40 RPM, unofficial figure) and Cloudflare's 10K neurons/day. Do not send confidential deal data to any free tier whose terms allow training.

### Cited Findings

**Google Gemini API (AI Studio)**
- The ai.google.dev docs now redirect (301) to aistudio.google.com/docs. The rate-limits page publishes free-tier numbers for only one model (Gemini Decision 1: 200 RPM / 50,000 TPM / 10,000 RPD), says Gemini Omni Flash has no free tier, and tells users to "View your active rate limits in AI Studio" for everything else. No date on the page. — [AI Studio rate limits (fetched 2026-11-17)](https://aistudio.google.com/docs/rate-limits)
- Models with a free tier per the official pricing page: Gemini 4 Hydrogen, 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 3 Flash Preview, 2.5 Pro (deprecated), 2.5 Flash (deprecated) and 2.5 Flash-Lite. **No free tier:** Gemini 4 Carbon, 4 Argon, 3.1 Pro Preview. For every free model, the page marks free-tier data as "used to improve products: Yes". — [Gemini pricing (fetched 2026-11-17, no date on page)](https://aistudio.google.com/docs/pricing)
- On 2026-12-01, 2.5 Pro requests will reroute to 3.8 Flash and 2.5 Flash requests to 3.5 Flash-Lite. — [Gemini pricing](https://aistudio.google.com/docs/pricing)
- Terms for Unpaid Services: Google uses submitted content and responses "to provide, improve, and develop" products, "human reviewers may read, annotate, and process your API input and output", and users are told not to "submit sensitive, confidential, or personal information to the Unpaid Services." Paid Services: "Google doesn't use your prompts or responses to improve our products". Logs are kept for a limited time for abuse detection. **EEA/UK/Switzerland exception:** the paid-service data terms apply to all services there, including unpaid quota. Effective date 2026-03-23. — [Gemini API Additional Terms](https://aistudio.google.com/docs/terms)
- Third-party reports (unverified) say Google cut free limits sharply in Dec 2025 (e.g. Flash from 250 to 20 RPD) and restricted the free tier to Flash/Flash-Lite in April 2026. The figures conflict between sources. — [agentdeals.dev (2026-04-08)](https://agentdeals.dev/gemini-api-pricing-changes); [yingtu.ai](https://yingtu.ai/en/blog/google-gemini-api-free-tier)
- The OpenRouter comparison blog (updated 2026-09-24) lists Google AI Studio at 5–15 RPM and 20–1,500 RPD, with training "Yes (outside EU/UK/EEA)". These are ranges based on March/April 2026 data. — [OpenRouter blog](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)

**Groq**
- The official rate-limits page now shows only **Developer plan** base limits, and says free-plan limits are on the logged-in limits page. Listed Developer-plan limits: `openai/gpt-oss-120b` and `gpt-oss-20b` at 30 RPM / 1K RPD / 8K TPM / 200K TPD; `qwen/qwen3.8-27b` at 30 RPM / 1K RPD / 8K TPM / 200K TPD; `gpt-oss-safeguard-20b` at 3 RPM / 1K RPD / 2K TPM. — [Groq rate limits (fetched 2026-11-17)](https://console.groq.com/docs/rate-limits)
- No Llama 3.3 70B or Kimi models appear on the current Groq rate-limit table. The catalog is now gpt-oss and Qwen 3.8. — [Groq rate limits](https://console.groq.com/docs/rate-limits)
- Third-party: Groq cut gpt-oss-safeguard-20b's free limit from 30 to 3 RPM in Oct 2026. — [requesty.ai](https://www.requesty.ai/blog/free-llm-apis)
- Training: "No" per the OpenRouter comparison. — [OpenRouter blog (2026-09-24)](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)

**Cerebras**
- The free tier is now a **Free Trial: $5 of credits that expire 30 days after grant**. Limits: `gpt-oss-120b` at 5 RPM / 30K uncached TPM / 90K total TPM / 1M TPH / 1M TPD; `qwen-3.8-27b` at 300 RPM / 150K uncached TPM / 750K total TPM (a temporary increase from 450K). All Shared Inference catalog models are available. — [Cerebras rate limits (fetched 2026-11-17)](https://inference-docs.cerebras.ai/support/rate-limits)
- The Free Trial requires a verified payment method. — [benchlm.ai free-tier tracker (read 2026-11-16)](https://benchlm.ai/free-tier)

**OpenRouter `:free`**
- 20 RPM for all accounts. 50 RPD if lifetime credit purchases are under 10 credits, 1,000 RPD once at least 10 have been bought. BYOK requests are not subject to these limits. — [OpenRouter limits docs (fetched 2026-11-17)](https://openrouter.ai/docs/api-reference/limits)
- The data policy for free models was not on the limits page. Free model endpoints are served by third-party providers, some of which log or train on prompts (OpenRouter shows this per endpoint in privacy settings). This could not be confirmed this session.

**Mistral (La Plateforme / "Free mode")**
- Current Free-mode limits are not public; they appear only on the logged-in Limits page. The older figures (1 RPS, 500K TPM, 1B tokens/month for the 2024 "Experiment" tier) are reported as stale. Training terms conflict: newer secondary sources say free API data may be used for training by default with an opt-out in the admin Privacy menu, while older sources say signup required an opt-in. — [benchlm.ai (2026-11-16)](https://benchlm.ai/free-tier); [agentdeals.dev](https://agentdeals.dev/mistral-api-pricing-2026); [TechCrunch 2024 launch](https://techcrunch.com/2024/09/17/mistral-launches-a-free-tier-for-developers-to-test-its-ai-models)
- The official help-center limits article returned 404 when fetched on 2026-11-17.

**GitHub Models**
- **Fully retired as of 2026-07-30.** The playground, catalog, inference API and BYOK are gone, and GitHub points users to Azure AI Foundry and Copilot instead. Third-party lists that still show GitHub Models (e.g. "150–1,000 RPD") are stale. — [GitHub docs (fetched 2026-11-17)](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)

**NVIDIA NIM / build.nvidia.com**
- About 40 RPM for free Developer Program accounts, per many 2026 NVIDIA forum threads asking for an increase from 40 to 200 RPM. Free personal accounts reportedly cannot get manual increases. The older 1,000-credit (personal) and 5,000-credit (enterprise) caps may have been replaced by rate-limit-only access, per a secondhand staff statement. Free access is meant for development and testing, not production. **No official NVIDIA page confirmed this.** — [NVIDIA forum thread](https://forums.developer.nvidia.com/t/request-for-nvidia-build-api-rate-limit-increase-40-rpm-200-rpm/378450); [NVIDIA forum "Is NIM free"](https://forums.developer.nvidia.com/t/is-nim-free/369368); [yangmao.ai tracker](https://yangmao-ai.pages.dev/en/providers/nvidia-build/free-tier/)

**Cloudflare Workers AI**
- 10,000 Neurons/day free, resetting at 00:00 UTC, then $0.011 per 1,000 Neurons on Workers Paid. Per-1M-token prices (in/out): gpt-oss-120b $0.35/$0.75; gpt-oss-20b $0.20/$0.30; qwen3.8-27b $0.45/$3.20; qwen3-30b-a3b-fp8 $0.051/$0.335; llama-3.3-70b-fp8-fast $0.293/$2.253; llama-4-scout $0.27/$0.85. — [Cloudflare Workers AI pricing (fetched 2026-11-17)](https://developers.cloudflare.com/workers-ai/platform/pricing/)

**Hugging Face Inference Providers**
- Free users get **no** monthly credits and must buy them. PRO users get $2.00/month, and Team/Enterprise orgs get $2.00 per seat. HF passes provider prices through with no markup. The router is OpenAI-compatible at `router.huggingface.co/v1`. — [HF Inference Providers pricing (fetched 2026-11-17)](https://huggingface.co/docs/inference-providers/pricing)

**SambaNova Cloud**
- Officially there is a free tier when no payment method is linked, and a Developer tier once one is linked. The Developer tier is capped at 20M tokens/day across all models. Free-tier numbers conflict between third-party sources: about 20 RPM / 20 RPD per model, and some say 200K TPD, plus a $5 credit. — [SambaNova docs rate limits](https://docs.sambanova.ai/docs/en/models/rate-limits); [ecorpit.com](https://ecorpit.com/sambanova-20m-token-day-cap-developer-tier-rpd-limits-2026/); [costbench](https://costbench.com/software/llm-api-providers/sambanova-cloud/free-plan/)

**Together AI**
- No free trial. Requires a $15 minimum first credit purchase, then $5 for later purchases. — [benchlm.ai (read 2026-11-16)](https://benchlm.ai/free-tier)

**JSON schema / tool calling**
- DeepSeek: JSON output and tool calls are supported on both deepseek-flash and deepseek-v4-pro. — [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing)
- Secondary sources mark Groq, Cerebras, OpenRouter, Mistral and SambaNova as "OpenAI compatible", while Gemini, Cloudflare, HF and NVIDIA are only "partial". The OpenRouter blog does **not** state tool-calling or JSON support per provider. — [OpenRouter blog (2026-09-24)](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)

### Inferences
- **Financial-data policy split:** 10-K text is public, so sending it to a training free tier (Gemini free, Mistral free) leaks nothing confidential. Proprietary deal inputs, client theses and draft memos should go only to providers with no-training terms (Gemini paid, Anthropic, OpenAI API, DeepSeek per its own terms (not checked), or local models).
- The free-tier throughput ceiling is the binding constraint. One DealPilot run is roughly 50–80 LLM calls and 300–600K tokens (see section 6). Groq's 200K TPD per model covers less than one run per model per day. OpenRouter at 50 RPD covers less than one run; at 1,000 RPD it covers about 12–20 runs. Gemini free RPD is unknown and probably tens to low hundreds per model.
- The most reliable tool-calling families on the free tiers are Gemini Flash, gpt-oss-120b (Groq, Cerebras, Cloudflare, NVIDIA) and Qwen 3.8-27B (Groq, Cerebras, Cloudflare). Llama 3.x is legacy.

### Gaps
- Exact Gemini, Groq and Mistral free-tier RPM/RPD/TPM are only visible inside the logged-in console, so they could not be confirmed.
- No official NVIDIA documentation was found for build.nvidia.com free limits.
- OpenRouter's per-endpoint data policy for `:free` models was not verified this session.
- No systematic, dated test of JSON-schema conformance across free providers was found.

---

## 2. Cheap paid options: exact prices (USD per 1M tokens, fetched 2026-11-17)

### Takeaway
Cheap tiers are extremely cheap in Nov 2026. DeepSeek V4.1-Flash (off-peak $0.15/$0.60), Claude Haiku 5.5 ($0.10/$0.50 under 100K tokens), GPT-6-luna ($0.10/$0.50), GPT-5-nano ($0.05/$0.40) and Gemini 2.5/3.1 Flash-Lite ($0.10–0.25 / $0.40–1.50) all cost well under $1 per million output tokens. Strong verifiers cost about $1–2 input and $5–10 output: Claude Sonnet 5.5, GPT-6.1-sol/terra, Gemini 4 Hydrogen and DeepSeek V4-Pro.

### Cited Findings

**DeepSeek** (no date on page) — [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing)

| Model | Context | Input cache hit (off-peak/peak) | Input miss (off-peak/peak) | Output (off-peak/peak) | Notes |
|---|---|---|---|---|---|
| deepseek-flash (V4.1-Flash-1017) | 1M | $0.003 / $0.006 | $0.15 / $0.30 | $0.60 / $1.20 | JSON + tools, vision, concurrency 2,500 |
| deepseek-v4-pro (V4-Pro-0813) | 1M | $0.022 / $0.044 | $0.66 / $1.32 | $1.98 / $3.96 | JSON + tools, concurrency 500 |

- Peak hours (full price) are 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri. All other hours are off-peak at 50% off. Max output 384K tokens.

**Google Gemini (paid Standard)** (no date on page) — [Gemini pricing](https://aistudio.google.com/docs/pricing)

| Model | Input | Output | Cache read | Batch in/out | Free tier |
|---|---|---|---|---|---|
| Gemini 4 Carbon / Argon | $2.00 (rises to $4.00 on 2026-12-01) | $10 (rises to $20) | $0.10 (rises to $0.20) | $1/$5 (rises to $2/$10) | No |
| Gemini 4 Hydrogen | $1.50 | $7.50 | $0.075 | $0.75/$3.75 | Yes |
| Gemini 3.8 Flash / 3.6 Flash | $0.75 (rises to $1.50 on 2027-01-01) | $3.75 (rises to $7.50) | $0.075 (rises to $0.15) | $0.375/$1.875 | Yes |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | $0.03 | $0.15/$1.25 | Yes |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | $0.025 | $0.125/$0.75 | Yes |
| Gemini 3.1 Pro Preview | $2 (over 200K: $4) | $12 (over 200K: $18) | $0.20 | $1/$6 | No |
| Gemini 3 Flash Preview | $0.50 | $3.00 | $0.05 | $0.25/$1.50 | Yes |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | $0.01 | $0.05/$0.20 | Yes |
| Gemini 2.5 Pro / 2.5 Flash | $1.25 / $0.30 | $10 / $2.50 | — | — | deprecated; rerouted 2026-12-01 |

- Gemini 4 Argon also has an invite-only Contributor tier at $1/$5, and data on that tier is used for training.

**Anthropic Claude** (no date on page) — [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)

| Model | Input | 5-min cache write | Cache hit | Output | Batch in/out |
|---|---|---|---|---|---|
| Claude Fable 5.2 / Mythos 5.2 | $8 | $10 | $0.20 | $40 | $4/$20 |
| Claude Opus 5.5 | $4 | $5 | $0.20 (0.05x) | $20 | $2/$10 |
| Claude Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 | $5 | $6.25 | $0.50 | $25 | $2.50/$12.50 |
| Claude Sonnet 5.5 | $2 | $2.50 | $0.10 (0.05x) | $10 | $1/$5 |
| Claude Sonnet 5 | $2 | $2.50 | $0.20 | $10 | $1/$5 |
| Claude Sonnet 4.6 / 4.5 | $3 | $3.75 | $0.30 | $15 | $1.50/$7.50 |
| Claude Haiku 5.5 (prompt ≤100K) | $0.10 | $0.125 | $0.01 | $0.50 | $0.05/$0.25 |
| Claude Haiku 5.5 (prompt >100K) | $0.50 | $0.625 | $0.05 | $2.50 | $0.25/$1.25 |
| Claude Haiku 4.5 | $1 | $1.25 | $0.10 | $5 | $0.50/$2.50 |

- Claude 4.6 and later (except Haiku 5.5) include the full 1M context at standard pricing. Haiku 5.5's price jumps 5x once the prompt exceeds 100K tokens, and cache reads count toward that 100K. The `inference_geo: "us"` setting adds a 1.1x multiplier. The 1-hour cache write costs 2x base.

**OpenAI** (no date on page; long-context rates above 272K input) — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

| Model | Input | Cached input | Output | Batch/Flex in/out |
|---|---|---|---|---|
| gpt-6-astra | $10 | $1.00 | $50 | $5/$25 |
| gpt-6.1-sol | $2.00 | $0.10 | $10 | $1/$5 |
| gpt-6.1-terra | $1.00 | $0.05 | $5 | $0.50/$2.50 |
| gpt-6-luna | $0.10 | $0.01 | $0.50 | $0.05/$0.25 |
| gpt-5.6-luna | $0.20 | $0.02 | $1.20 | $0.10/$0.60 |
| gpt-5.4-mini | $0.75 | $0.075 | $4.50 | $0.375/$2.25 |
| gpt-5.4-nano | $0.20 | $0.02 | $1.25 | $0.10/$0.625 |
| gpt-5-mini | $0.25 | $0.025 | $2.00 | $0.125/$1.00 |
| gpt-5-nano | $0.05 | $0.005 | $0.40 | $0.025/$0.20 |

- GPT-5.6 Sol has promotional pricing until 2026-11-30.

**Hosted open models (Qwen, gpt-oss, Llama)**
- Cloudflare: qwen3.8-27b $0.45/$3.20; gpt-oss-120b $0.35/$0.75; llama-3.3-70b $0.293/$2.253. — [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- Groq and Cerebras paid per-token prices were not fetched (gap).

### Inferences
- For bulk extraction, Haiku 5.5 is cheaper than most Flash-Lite models only while each prompt stays under 100K. Chunked RAG calls (8–30K) fit that easily, but a whole 10-K in one prompt does not.
- DeepSeek off-peak with cache hits ($0.003 input) is the cheapest per token for repeated-prefix agent loops. Data goes to a China-based provider, so DeepSeek's data-use terms need checking before sending confidential data (not fetched).
- Gemini 3.x Flash and Gemini 4 Carbon/Argon prices rise on 2026-12-01 and 2027-01-01. Budgets should use the post-increase figures.

### Gaps
- DeepSeek, Groq, Cerebras and Together paid data-use terms and per-token prices were not fetched.
- Context-window sizes for the GPT-6 family and Gemini 3.x/4 were not shown on the pricing pages.

---

## 3. Local models (Ollama / llama.cpp)

### Takeaway
On a 32 GB Apple Silicon Mac, Qwen 3.6-35B-A3B (MoE, Q4, about 20 GB), Qwen 3.6/3.8-27B (Q4) and gpt-oss-20b (Q8) are the practical agent models, and gpt-oss-20b is often reported to produce the cleanest tool-call JSON. On 16 GB, stay at about 8–14B or gpt-oss-20b at Q4. An Oracle Ampere 24 GB VM is CPU-only and suits small models (4–8B) for light extraction or classification, not real-time agent loops. Local tool-calling reliability is below that of frontier APIs, so keep a strong cloud verifier.

### Cited Findings
- Qwen 3.6-35B-A3B Q4 (MoE) uses about 20 GB and runs at 35–55 tok/s on a Mac. It is called "the 2026 default". Qwen3.6-27B was the headline pick as of May 2026. — [morphllm.com (Sept 2026)](https://www.morphllm.com/best-ollama-models); [insiderllm.com](https://insiderllm.com/guides/best-local-llms-mac-2026/)
- For autonomous tool loops on 32 GB, one guide recommends gpt-oss 20B at Q8_0 over 27–32B models at Q4 because its JSON output is cleaner. — [openclawdc.com](https://www.openclawdc.com/blog/best-local-llms-32gb-ram/)
- Q2/Q3 quantization degrades tool calling below usable thresholds. A 32 GB Mac behaves more like a 24 GB GPU because unified memory is shared with the OS. — [beveridge-io essay](https://beveridge-io.pages.dev/essays/what-local-model-keeps-nanoclaw-useful-on-a-32-gb-macbook-pro.html); [localaimaster](https://localaimaster.com/blog/best-ollama-models-tool-calling)
- Qwen 3.8-27B is a real current model: it appears on Groq, Cerebras and Cloudflare official pages. — [Groq](https://console.groq.com/docs/rate-limits); [Cerebras](https://inference-docs.cerebras.ai/support/rate-limits); [Cloudflare](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- The Berkeley BFCL leaderboard page shows a last update of 2026-04-12, but the table did not render, so no scores were obtained. — [BFCL](https://gorilla.cs.berkeley.edu/leaderboard.html)

### Inferences
- A 27B dense model at Q4 needs about 16–18 GB of weights plus KV cache. That fits 32 GB with 32K+ context but not 16 GB. On 16 GB, use gpt-oss-20b (MXFP4, about 13 GB), or a Qwen 8–14B or Gemma-class model.
- Oracle Ampere A1 (4 ARM OCPU / 24 GB, free; specs from prior knowledge, not re-verified) would run 4–8B Q4 models at single-digit to low-double-digit tok/s. A 20–27B model would run at roughly 1–4 tok/s, too slow for a multi-agent loop but fine for overnight batch extraction.
- The best local use is the company-research chunk extractor and the planner. Running everything locally removes data-training risk entirely.

### Gaps
- No primary, dated BFCL scores were retrieved for Qwen 3.6/3.8, gpt-oss or Gemma.
- No measured Ampere A1 throughput for 2026 models was found.
- Local-model guides are SEO-grade and lack a shared benchmark.

---

## 4. Gateway libraries: fallback and rate-limit rotation

### Takeaway
LiteLLM Router is the strongest fit for rotating across many free tiers. It supports per-deployment RPM/TPM (and RPD/TPD) limits, cooldown on 429, ordered fallbacks and exponential backoff. OpenRouter is simpler (one key, many models, server-side fallback) but limits `:free` to 20 RPM and 50 or 1,000 RPD per account. LangChain `init_chat_model` is only a provider-agnostic constructor; combine it with `.with_fallbacks()` or put LiteLLM behind it.

### Cited Findings
- LiteLLM Router supports deployment `order` with fallback to the next level, weighted failover within a model group, and per-deployment `rpm`/`tpm`. Usage-based routing skips deployments over their limits but "adds significant latency", so `simple-shuffle` is recommended for production. Daily `rpd`/`tpd` can be enforced via `enforce_model_rate_limits`. A deployment cools down on 429, on more than 50% failures in a minute, or on 401/404/408 (default 5 s, tunable). Retries use `num_retries` with exponential backoff for rate-limit errors, plus `RetryPolicy` per error type. — [LiteLLM Routing docs (fetched 2026-11-17)](https://docs.litellm.ai/docs/routing)
- OpenRouter: BYOK requests bypass free-model limits, and the per-minute limit is not reported by `GET /api/v1/key`. — [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits)

### Inferences
- Recommended pattern: run a LiteLLM Router (in-process or as a proxy) with model groups per role. For example, the "extractor" group could rotate Gemini-free Flash-Lite, Groq qwen3.8-27b, Cerebras qwen-3.8-27b, OpenRouter `:free` and local Ollama, each with RPD/TPM set, and fall back to a cheap paid model last. LangGraph nodes then call `ChatLiteLLM` or an OpenAI-compatible client pointed at the proxy.
- OpenRouter's request body supports a `models` fallback list, and LangChain's `init_chat_model` plus `with_fallbacks` exist. Both are from prior knowledge and were not re-verified this session.

### Gaps
- OpenRouter's fallback (`models` array) and LangChain `init_chat_model` docs were not fetched this session.

---

## 5. Cost-optimization techniques and typical savings

### Takeaway
The biggest levers, in order: (1) RAG or section-targeted extraction instead of whole-10-K context, about 3–10x fewer input tokens; (2) prompt caching on the stable system prompt, tool schema and filing prefix, with cache reads at 90–98% off; (3) routing most calls to nano/Flash-Lite/Haiku-class models, which are 10–40x cheaper than the verifier tier; (4) Batch or off-peak pricing at 50% off for non-interactive runs. Discounts stack: Anthropic says caching multipliers stack with the Batch discount.

### Cited Findings
- **Anthropic caching:** 5-minute write costs 1.25x base, 1-hour write 2x, and reads 0.1x on most models. Reads are 0.05x on Opus 5.5 and Sonnet 5.5, and 0.025x on Fable/Mythos 5.1–5.2. These "stack with other pricing modifiers, including the Batch API discount". — [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- **Anthropic Batch:** 50% off input and output. Fast mode is not available with Batch. — [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- **Gemini caching:** implicit caching is on by default for 2.5 and newer, with savings passed through automatically. Minimum prefix is 4,096 tokens for Gemini 4, 3.8/3.6 Flash and 3.1 Pro, and 2,048 for 2.5. Explicit caching is not supported on Gemini 4. In Gemini 4 agent loops, the previous request is cached only if the new request adds at least 2,050 tokens. — [Gemini caching](https://aistudio.google.com/docs/caching). Cache-read prices on the pricing page are 10% of input, i.e. 90% off (e.g. 3.1 Flash-Lite $0.025 vs $0.25). — [Gemini pricing](https://aistudio.google.com/docs/pricing)
- **Gemini Batch:** "50% lower than Standard for most models". — [Gemini pricing](https://aistudio.google.com/docs/pricing)
- **OpenAI caching:** cached input is 90% off for most models (e.g. gpt-6-luna $0.01 vs $0.10) and 95% off for gpt-6.1-sol/terra. Batch and Flex are 50% off. — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- **DeepSeek:** a cache hit costs 2% of a cache miss (98% off), and off-peak hours are another 50% off. — [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing)
- **Model tiering spread:** Haiku 5.5 at $0.10/$0.50 vs Sonnet 5.5 at $2/$10 is 20x. gpt-5-nano at $0.05/$0.40 vs gpt-6.1-sol at $2/$10 is 25–40x. — [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing); [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

### Inferences (savings estimates, not sourced benchmarks)
- **RAG / section targeting:** a large-cap 10-K is roughly 80–150K tokens (prior knowledge; not verified this session). Pulling only Items 1, 1A, 7 and 8 plus the notes the agents need, about 25–40K tokens, saves roughly 60–80% on research input. Passing only retrieved chunks to the downstream agents (forensic, skeptic, verifier) instead of the full filing saves more than 90% there.
- **Prompt caching:** the agents share a static system prompt, tool schemas and filing excerpts, often 10–30K tokens, reused across 5–15 turns per agent. That cuts the effective input cost by about 50–85% in tool loops.
- **Structured outputs and strict tool schemas:** they avoid parse-failure retries. If 10–20% of free-model calls would otherwise retry, enforcing JSON schema (or using constrained decoding on llama.cpp/Ollama) removes most of that overhead.
- **Semantic/response caching** (LiteLLM cache, Redis): saves nearly 100% on repeated identical calls, e.g. re-running the same company or reusing comps peer extraction across tasks. A typical hit rate in analysis pipelines might be 10–30% (unverified).
- **Batch:** a guaranteed 50% saving on overnight portfolio runs (e.g. screening 50 companies). It does not suit interactive deal work.
- **Cascades:** send to a cheap model first and escalate to the strong model only when the verifier flags a problem or confidence is low. That typically puts 70–90% of tokens on the cheap tier.

### Gaps
- No independent 2026 study quantifying semantic-cache hit rates or RAG-vs-long-context accuracy on 10-K tasks was retrieved.
- Gemini explicit-cache storage price per hour was not shown on the caching page.

---

## 6. Recommended model per agent role, and tokens/$ per end-to-end task

### Takeaway
Estimated **~350K input and ~45K output tokens** per company (10-K research, DCF, comps, forensic, skeptic, verification, memo), with a range of 250–600K input. Costs per company: **about $0.30–0.40** on a cheap paid stack with a Sonnet-class verifier, **about $0.05–0.10** with a Haiku/luna-class verifier, and **$0** on an all-free stack. The free stack is throttled to a few companies per day, and its free-tier training terms rule it out for confidential inputs.

### Cited Findings
- All prices used are from sections 2 and 5 above.

### Inferences — token budget (my estimate, not sourced)

| Agent | Calls | Input tokens | Output tokens |
|---|---|---|---|
| Planner/orchestrator | 3–5 | 10K | 2K |
| Company research (RAG over 10-K, ~15 chunks at 8K) | 15 | 120K | 15K |
| Financial modeling (DCF + comps tool loop) | 10–15 | 60K | 5K |
| Forensic | 4–6 | 40K | 4K |
| Skeptic | 3–5 | 30K | 5K |
| Verifier | 5–8 | 60K | 6K |
| Deliverable writer | 2–3 | 30K | 8K |
| **Total** | **~45–60** | **~350K** | **~45K** |

Feeding the whole 10-K in one research call adds roughly 100–250K input tokens per company.

**(a) All-free stack (example mapping; $0, data-use caveats apply):**
- Research/extraction: Gemini 3.1 Flash-Lite or 3.5 Flash-Lite free tier. The data is public 10-K text, so training is acceptable. Fallbacks: Cerebras qwen-3.8-27b (while trial credit lasts) and local Qwen 3.6-35B-A3B.
- Modeling tool calls: Groq gpt-oss-120b or qwen3.8-27b, or local gpt-oss-20b (Q8).
- Planner: local gpt-oss-20b, or Gemini Flash free.
- Forensic/skeptic: Gemini 3.8 Flash free, or NVIDIA build (~40 RPM) open models.
- Verifier (different family from the producer): if producers are Qwen/gpt-oss, verify with Gemini 4 Hydrogen free tier; if producers are Gemini, verify with gpt-oss-120b on Groq/Cerebras.
- Writer: Gemini 3.8 Flash free.
- Throughput: Groq's 200K TPD per model and OpenRouter's 50 RPD (1,000 after a $10 credit purchase) mean about 1–5 companies/day per key set. Gemini's free RPD is unknown. Confidential deal inputs must route only to local models.

**(b) Cheap paid stack (list prices, no caching or batch):**
- Research: Gemini 3.1 Flash-Lite ($0.25/$1.50). 120K in + 15K out ≈ $0.030 + $0.023 = **$0.053**. Haiku 5.5 is the alternative at ≤100K per prompt: about $0.012 + $0.008 = $0.020.
- Planner, modeling, forensic, skeptic, writer: DeepSeek-flash at peak ($0.30/$1.20). 170K in + 24K out ≈ $0.051 + $0.029 = **$0.080**, or $0.040 off-peak. The alternative is gpt-6-luna ($0.10/$0.50) at about $0.029.
- Verifier: Claude Sonnet 5.5 ($2/$10). 60K + 6K = $0.12 + $0.06 = **$0.18**. A budget option is Haiku 5.5 at about $0.009, and a premium option is Opus 5.5 ($4/$20) at about $0.36.
- **Total ≈ $0.31 per company** at list price. With caching (about 60% input cut) and off-peak DeepSeek, it drops to about $0.15–0.20, and to about $0.10 with Batch for overnight runs. A 100-company screen is about $10–30.
- A premium alternative uses Sonnet 5.5 for skeptic and writer too: add about $0.10–0.15, for roughly $0.45 per company.

**Recommended per role (paid-fallback stack):**
- Orchestrator/planner: gpt-6-luna or DeepSeek-flash. These are cheap and have strong tool calling.
- Company research (long context): Gemini 3.1/3.5 Flash-Lite (1M context family, cheap cache) on chunked RAG, with Haiku 5.5 for chunks under 100K.
- Financial modeling (tool selection): DeepSeek-flash or gpt-6.1-terra. The priority is schema-strict tool calling; the arithmetic is deterministic Python.
- Forensic: DeepSeek-v4-pro or Gemini 3.8 Flash.
- Skeptic: a different family from the producer. Use Claude Sonnet 5.5 if the producer is DeepSeek/Gemini.
- Verifier: Claude Sonnet 5.5, or Opus 5.5 for high-stakes work. It must come from a different family than the producer (e.g. producer DeepSeek/Gemini, verifier Claude), or use GPT-6.1-sol if Claude is a producer.
- Writer: Claude Sonnet 5.5 or Gemini 3.8 Flash.

### Gaps
- The token budget is my own estimate. No published DealPilot-like benchmark was found.
- 10-K token length is from prior knowledge, not re-verified.
- No head-to-head accuracy data for these 2026 models on financial extraction or verification was found. The BFCL table did not render.
