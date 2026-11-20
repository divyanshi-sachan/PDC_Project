# DealPilot low-cost stack: hosting, DB, storage, queues, observability (as of 2026-11-17)

All figures were retrieved on 2026-11-17 from the linked page unless noted. "UNCONFIRMED" means the figure came from a third-party aggregator or from memory and was not verified on a vendor page. Workload assumed: FastAPI + LangGraph, agent jobs of 2-15 min (LLM calls, SEC downloads, PyMuPDF parsing, openpyxl), plus a worker/queue, Postgres + pgvector (hundreds of MB up to a few GB), object storage for .xlsx/.md, and a Next.js dashboard.

## Backend compute: which free/cheap hosts support long jobs and background workers?

### Takeaway
By late 2026 most "free PaaS" options no longer suit a 2-15 min worker. Fly.io, Railway and Hugging Face Docker Spaces have dropped or crippled their free compute. Render free has no background workers and spins down. Koyeb's free instance is 0.1 vCPU/512 MB and can't be a worker. The real $0 options are Oracle Always Free (an always-on ARM VM, with an idle-reclaim risk), Google Cloud Run (60-min services / 24-h jobs within a monthly free quota) and Modal ($30/month credits). Cheapest paid: Railway Hobby at $5, Fly.io about $3.7-$13/month per machine, Render Starter (price not retrieved).

### Cited Findings
**Render (free)**
- Free instances exist only for web services, Postgres and Key Value. Background workers and cron jobs are not listed as free ("other service types don't support Free instances"). — [Render docs: Deploy for Free](https://render.com/docs/free)
- A free web service spins down after 15 min without inbound HTTP/WebSocket traffic. Spin-up takes about 1 min. Each workspace gets 750 free instance hours per month (spun-down time doesn't count). When hours run out, all free web services are suspended until next month. — [Render docs](https://render.com/docs/free)
- The free filesystem is ephemeral and persistent disks aren't available. Render "may restart the service at any time". One-off jobs, shell access, scaling beyond one instance and private-network traffic aren't supported. — [Render docs](https://render.com/docs/free)
- Free Render Postgres: one per workspace, 1 GB, **expires 30 days after creation**, then a 14-day grace period before deletion. No backups. — [Render docs](https://render.com/docs/free)
- Free Key Value is in-memory only and loses data on restart. — [Render docs](https://render.com/docs/free)
- The render.com/pricing page returned no figures when fetched (it renders client-side), so the RAM/CPU of free instances and Starter pricing were not retrieved. — [render.com/pricing](https://render.com/pricing)

**Fly.io**
- "New organizations don't have a free tier or a monthly free usage allowance." New accounts get a $1 credit for 7 days. Personal orgs with a monthly bill under $5 have it waived. Free allowances survive only for orgs on plans discontinued in **October 2024**. — [Fly.io pricing docs](https://docs.fly.io/about/pricing)
- Always-on prices (iad/ewr): shared-cpu-1x 256 MB $2.19/mo, 512 MB $3.69/mo, 1 GB $6.70/mo; shared-cpu-2x 2 GB $13.39/mo. Volumes cost $0.15/GB-mo. Egress is $0.02/GB in NA/EU. Managed Postgres Basic is $38/mo + $0.28/GB. — [Fly.io pricing docs](https://docs.fly.io/about/pricing)

**Railway**
- Free Trial: one-time $5 credit that expires after 30 days, no card needed, 2 vCPU / 1 GB per service, 5 services. — [Railway pricing](https://railway.com/pricing)
- Free plan (after trial): $1/month of usage credits, 1 vCPU / 0.5 GB per service, 1 project, 3 services, no custom domains. — [Railway pricing](https://railway.com/pricing)
- Hobby: $5/month including $5 of usage, up to 48 vCPU / 48 GB per service, 5 GB max volume. Usage rates: RAM about $10/GB-mo, CPU about $20/vCPU-mo, volume $0.15/GB-mo, egress $0.05/GB, object storage $0.015/GB-mo with free egress. — [Railway pricing](https://railway.com/pricing)

**Koyeb** (conflicting sources)
- Koyeb's instance docs still describe a Free Instance: 512 MB RAM, 0.1 vCPU, 2 GB SSD, one per org, web service only (**cannot be a Worker Service**), no volumes, Frankfurt or Washington only, scales to zero after 1 h without traffic. The cheapest paid instance is eco-nano at $1.61/mo (0.1 vCPU, 256 MB). — [Koyeb instances docs](https://www.koyeb.com/docs/reference/instances)
- The current Koyeb pricing page lists no free compute. It shows Pro at $29/mo (includes $10 compute) and a free Postgres tier ("Free 5h", 0.25 vCPU, 1 GB RAM, 1 GB storage). — [Koyeb pricing](https://www.koyeb.com/pricing)
- Aggregators report that the free/Starter compute tier was removed for new customers around **2026-02-26**. Mistral AI agreed to acquire Koyeb on 2026-02-17. UNCONFIRMED (third-party). — [agentdeals Koyeb vs Versoly](https://agentdeals.dev/compare/koyeb-vs-versoly); [sliplane Koyeb alternatives 2026](https://sliplane.io/blog/5-awesome-koyeb-alternatives)

**Hugging Face Spaces (major change)**
- "Gradio and Docker Spaces run on compute and require a paid plan to create: PRO for personal accounts, Team or Enterprise for organizations." Only Static Spaces are free for everyone. Free personal accounts can still host up to 2 Gradio Spaces on ZeroGPU. — [HF Spaces overview](https://huggingface.co/docs/hub/spaces-overview)
- CPU Basic is 2 vCPU / 16 GB RAM / 50 GB non-persistent disk with no hourly charge. Free hardware "goes to sleep" after a period of inactivity (the docs give no duration). Only outbound ports 80, 443 and 8080 are allowed. — [HF Spaces overview](https://huggingface.co/docs/hub/spaces-overview)

**Google Cloud Run**
- Monthly free tier: 180,000 vCPU-seconds, 360,000 GiB-seconds and 2M requests, plus 1 GiB of free egress. Services allow a **max request timeout of 60 min**. **Cloud Run jobs allow max task timeout of 24 h**. Instance-based billing (CPU always allocated) is available for background work. — [Cloud Run pricing](https://cloud.google.com/run/pricing). Caveat: the fetched page was truncated, and the tool filled these numbers in from Google's documentation. They match long-standing published values but should be re-checked.

**Oracle Cloud Always Free**
- Ampere A1: 1,500 OCPU-hours and 9,000 GB-hours per month, **equivalent to 2 OCPUs + 12 GB RAM** (in one instance or two 1-OCPU instances), home region only. — [OCI Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
  - **Change flag:** The brief's "4 OCPU / 24 GB" is the older allowance. Oracle's current doc says 2 OCPU / 12 GB. The date of the cut was not found.
- 200 GB total block/boot volume, 5 backups, 10 TB/month egress, 20 GB object storage (Always-Free-only account), two Always Free Autonomous DBs (1 OCPU, 20 GB each, Oracle DB rather than Postgres). — [OCI docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- **Idle reclamation:** an Always Free instance can be reclaimed if, over 7 days, its 95th-percentile CPU is below 20%, network is below 20% and memory is below 20% (A1). If a trial ends with more than 20 GB of object storage in use, **all objects are deleted**. — [OCI docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

**Modal**
- Starter (free): $30/month of compute credits, 100 containers, 5 deployed crons, 200 apps. Team is $250/mo with $100 of credits. CPU costs $0.0000131 per physical core per second (= 2 vCPU, minimum 0.125 core) and memory $0.00000222 per GiB per second. — [Modal pricing](https://modal.com/pricing)

**Vercel Functions**
- Hobby: max duration **300 s (5 min)**, 2 GB / 1 vCPU. Pro: 800 s max, 1800 s extended (beta), 4 GB / 2 vCPU. Python bundles up to 500 MB. Request/response body limit is 4.5 MB. Docs last updated 2026-08-24. Vercel points to "Vercel Workflows" for unlimited-duration work. — [Vercel Functions limits](https://vercel.com/docs/functions/limitations)

**Cloudflare Workers**
- Free: 100k requests/day, **10 ms CPU per request**, 128 MB memory. Paid: 5 min CPU (default 30 s), 128 MB. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Python Workers support FastAPI, LangChain and Pydantic. The page gives no beta/GA status and doesn't mention native wheels such as PyMuPDF. — [Python Workers docs](https://developers.cloudflare.com/workers/languages/python/)

### Inferences
- **Fits 2-15 min jobs at $0:** Oracle A1 (always-on VM, no timeouts), Cloud Run jobs (24 h max) or a Cloud Run service with a 60-min timeout, and Modal (credits). On Cloud Run, a 1 vCPU / 2 GiB job running 10 min uses about 600 vCPU-s and 1,200 GiB-s, so the free tier covers roughly 300 such job-runs per month at that size. This assumes free-tier quotas apply to jobs as described.
- **Doesn't fit at $0:** Render free (no worker; an in-process job dies on spin-down or restart, and the 750 h quota is shared), Koyeb free (0.1 vCPU / 512 MB is too small for PyMuPDF plus LangGraph, and it can't be a worker), HF Docker Spaces (now need PRO), Fly.io and Railway (no lasting free compute), Vercel Hobby (5 min cap), Cloudflare Workers (10 ms CPU free, 128 MB, no native PyMuPDF).
- A workable Render-free hack is to run the job inside the web service and ping it to stay awake. That burns about 744 h/month, which is just under 750, and the instance can still be restarted at any time. Fragile; not recommended for anything but a demo.
- Keeping an Oracle A1 VM busy above the 20% thresholds avoids reclamation. Upgrading the account to Pay-As-You-Go while staying within Always Free limits is commonly cited as making reclamation less likely, but this was not verified here.

### Gaps
- Render: RAM/CPU of free instances, Starter web/worker price and the HTTP request timeout weren't retrieved (pricing page rendered empty). From memory: 512 MB / 0.1 CPU free, Starter $7/mo, 100-min HTTP timeout. UNCONFIRMED.
- Railway HTTP request timeout not found (commonly cited as 15 min). UNCONFIRMED.
- HF Spaces sleep duration on free hardware is not stated in the docs (historically 48 h). Whether PRO ($9/mo, from memory) lets CPU Basic Docker Spaces run without sleep is unconfirmed.
- Whether Oracle's A1 cut from 4 OCPU/24 GB to 2 OCPU/12 GB applies to existing tenancies, and when it happened.
- Cloudflare Containers pricing/limits, Deno Deploy and other hosts were not researched.
- Exact Cloud Run free-tier numbers weren't shown on the truncated fetched page.

## Queues / workers, and LangGraph Platform/Server licensing

### Takeaway
At this scale, use a Postgres-backed queue (procrastinate/pgqueuer, or a simple `SELECT ... FOR UPDATE SKIP LOCKED` jobs table) on the same Postgres. It costs nothing extra and needs no Redis. Hosted queues (QStash, Inngest, Trigger.dev) have small free quotas, and only Trigger.dev runs the compute itself. Self-hosting LangGraph Server / Agent Server in production requires a LangSmith license key, reportedly Enterprise-only (ELv2). Plain `langgraph` the library (MIT) inside FastAPI, or the Apache-2.0 "Aegra" drop-in, avoids that.

### Cited Findings
- Agent Server standalone deploy uses `LANGGRAPH_CLOUD_LICENSE_KEY`, validated at startup and periodically. A running server tolerates failed checks for 24 h. — [LangChain docs: standalone server](https://docs.langchain.com/langsmith/deploy-standalone-server); [LangChain KB: license renewal](https://kb.langchain.com/articles/2179908067-self-hosted-license-renewal-expiration-warnings-and-post-expiry-grace-period)
- A LangChain forum reply says self-hosted deployment currently requires being an Enterprise customer with LangGraph keys. — [LangChain forum](https://forum.langchain.com/t/best-practices-for-self-hosting-langgraph-server-oss-without-langgraph-keys/3779)
- langgraph-api is reported as Elastic License 2.0 and needs a commercial key in production. Aegra is an Apache-2.0 alternative that works without a key. — [rvernica: langchain license (2026-03)](https://rvernica.github.io/2026/03/langchain-license); [Aegra](https://awesome.ecosyste.ms/projects/github.com%2Faegra%2Faegra) (third-party)
- LangSmith Plus ($39/seat/mo) includes "one free small serverless Agent Server". Developer (free) has no deployment. Deployment metering is in LSUs ($1 each): runtime at 0.0675 LSU/vCPU-h, 0.0090 LSU/GiB-h, etc. — [LangChain pricing](https://www.langchain.com/pricing)
- QStash free: 500 messages/day. Inngest free: 25k or 50k runs/month (sources conflict). Trigger.dev free: about $5/month compute credit, 20 concurrent runs, 10 schedules, 1-day log retention. All UNCONFIRMED (aggregators). — [freetier.co background jobs 2026](https://freetier.co/articles/free-tier-background-jobs-cron-2026); [agentdeals Inngest](https://agentdeals.dev/vendor/inngest); [CostBench Trigger.dev free plan](https://costbench.com/software/ai-workflow-orchestration/trigger-dev/free-plan/)

### Inferences
- QStash and Inngest only *invoke* your HTTP endpoint, so the compute host's timeout still applies. Trigger.dev runs the task itself, but its TypeScript-first runtime doesn't natively fit a Python worker.
- Recommended: an arq/Celery-free design with procrastinate or pgqueuer on Postgres. The worker runs as a second process on the same VM (Oracle) or as a Cloud Run job triggered per task. LangGraph checkpointing via `langgraph-checkpoint-postgres` on the same DB.

### Gaps
- No vendor-page confirmation of QStash, Inngest or Trigger.dev free quotas; Upstash Redis free limits not retrieved.
- LangGraph "Lite"/"Developer" self-hosted tiers (formerly up to 1M nodes executed free): no current doc found. They seem to have been folded into Agent Server licensing. UNCONFIRMED.
- procrastinate/pgqueuer/arq maturity not researched (all are OSS, $0).

## Postgres + pgvector

### Takeaway
Neon free is the best managed fit: 1 GB/project (20 GB total), 100 CU-hours/project/month, scale-to-zero after 5 min, pgvector on all plans. Its catch is a 1 GB-per-project cap. Supabase free (500 MB, pauses after 7 days idle) is too small for multi-GB embeddings. Render free PG expires after 30 days. For "a few GB" at $0, self-hosting Postgres + pgvector on Oracle's 200 GB block storage is the only real option. Paid: Neon Launch (about $0.35/GB-mo + $0.106/CU-h, no minimum) or Supabase Pro at $25.

### Cited Findings
- Supabase Free: 500 MB DB, 5 GB egress, 1 GB file storage, 50k MAU, **projects pause after 7 days inactivity**, 2 active projects, shared CPU / 500 MB RAM. Pro from $25/mo: 8 GB disk per project, 100 GB storage, 250 GB egress, $10 compute credits (one Micro). — [Supabase pricing](https://supabase.com/pricing)
- Neon Free: 1 GB storage per project, 20 GB across projects, 100 CU-hours per project per month, 100 projects, autoscale up to 2 CU (8 GB RAM), scale-to-zero after 5 min (can't be disabled), 5 GB egress per project. Launch: $0.106/CU-h, $0.35/GB-mo, no minimum (invoices under $0.50 aren't collected), 500 GB egress. pgvector is on all plans. — [Neon pricing](https://neon.com/pricing)
- Koyeb free Postgres: "Free 5h", 0.25 vCPU, 1 GB RAM, 1 GB storage. — [Koyeb pricing](https://www.koyeb.com/pricing)
- Render free PG: 1 GB, expires 30 days after creation. — [Render docs](https://render.com/docs/free)
- Fly Managed Postgres starts at $38/mo. — [Fly.io pricing](https://docs.fly.io/about/pricing)
- Oracle Always Free: 200 GB block storage, A1 2 OCPU / 12 GB. Enough for self-hosted Postgres + pgvector. — [OCI docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Inferences
- Embedding sizing: 1536-dim float32 is about 6 KB per vector before index overhead, so 100k chunks is about 600 MB plus HNSW index. Neon's 1 GB cap fits about 100k chunks. Using halfvec or 768/1024-dim embeddings roughly halves that. A few GB needs Neon Launch (for example, 5 GB is about $1.75/mo storage plus compute) or self-hosting.
- Supabase's 7-day pause is a problem for a demo that sits idle. Neon's scale-to-zero only adds a cold start of seconds.

### Gaps
- pgvector on Supabase free is not stated on the pricing page (it is widely documented as available).
- Not researched: Xata, Aiven free PG, Prisma Postgres, Tembo, Nile, CockroachDB. From memory, Tembo shut down its managed Postgres in 2025 and CockroachDB lacked pgvector until recent vector-index support. Both UNCONFIRMED.

## Object storage

### Takeaway
Cloudflare R2 free (10 GB-month, zero egress) easily covers the generated .xlsx/.md deliverables. Oracle gives 20 GB object storage and Supabase gives 1 GB.

### Cited Findings
- R2 free: 10 GB-month Standard, 1M Class A ops, 10M Class B ops per month, free egress. Paid: $0.015/GB-mo Standard. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- Supabase Storage: 1 GB free, 100 GB on Pro. — [Supabase pricing](https://supabase.com/pricing)
- Railway object storage: $0.015/GB-mo, free egress. — [Railway pricing](https://railway.com/pricing)
- Oracle: 20 GB object storage (Always-Free-only accounts). — [OCI docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Gaps
- Backblaze B2 free tier (historically 10 GB) not verified.

## Frontend hosting (Next.js)

### Takeaway
Vercel Hobby is the easiest Next.js host but is personal/non-commercial only. A startup demo that is commercial in intent should use Cloudflare Workers via OpenNext or Netlify Free (300 credits), or pay for Vercel Pro ($20/user/mo).

### Cited Findings
- The Vercel Hobby plan is personal, non-commercial use only; commercial use needs Pro or Enterprise. — [Vercel fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- Vercel Pro is $20/user/mo. Hobby allowances of about 100 GB transfer, 1M invocations and 4 h active CPU are UNCONFIRMED (third-party). — [deploywise Vercel free tier 2026](https://deploywise.dev/blog/vercel-free-tier-limits-2026)
- Netlify Free: 300-credit limit. Bandwidth costs 20 credits/GB. Personal is $9/mo (1,000 credits), Pro $20/mo (3,000 credits). — [Netlify pricing](https://www.netlify.com/pricing/)
- Cloudflare Workers Free: 100k requests/day, 10 ms CPU/request, 64 MiB worker size. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### Inferences
- 300 Netlify credits works out to roughly 15 GB of bandwidth if spent only on bandwidth. That's fine for a demo dashboard.
- Next.js SSR on Workers Free may hit the 10 ms CPU limit on heavy pages. Keep the dashboard mostly client-rendered and calling the FastAPI backend.

### Gaps
- OpenNext Cloudflare adapter compatibility/limits and Cloudflare Pages status not verified; whether Netlify credits reset monthly is not stated on the page.

## Observability / evals

### Takeaway
LangSmith Developer (5k traces/month, 14-day retention) has the most native LangGraph integration. Langfuse Cloud Hobby (50k units/month, 30 days) is more generous, and Langfuse self-hosted is MIT with all product features free since June 2025. Arize Phoenix (ELv2, self-host free) and Opik (OSS) are alternatives. Helicone reportedly entered maintenance mode after a March 2026 acquisition, so avoid it.

### Cited Findings
- LangSmith Developer: $0, 1 seat, 5,000 base traces/mo, base retention 14 days (extended 180 days). Plus: $39/seat/mo, 10k traces. — [LangChain pricing](https://www.langchain.com/pricing)
- Langfuse Hobby: 50k units/mo, 30-day data access, 2 users. Core: $29/mo, 100k units, $8 per extra 100k, 90 days. — [Langfuse pricing](https://langfuse.com/pricing)
- In June 2025, Langfuse open-sourced all remaining product features (LLM-as-judge evals, annotation queues, prompt experiments, playground) under MIT. Only SCIM, audit logs and data-retention policies stay commercial (the `ee/` dirs). — [Langfuse blog 2025-06-04](https://langfuse.com/blog/2025-06-04-open-sourcing-langfuse-product); [Langfuse self-host pricing](https://langfuse.com/pricing-self-host)
- Langfuse reportedly became part of ClickHouse in January 2026. UNCONFIRMED. — [developersdigest](https://www.developersdigest.tech/llm-observability/langfuse)
- Helicone reported in maintenance mode since a March 2026 acquisition. Opik Free Cloud cut from unlimited to 10 team members in spring 2026. Phoenix self-host is free (ELv2) and Arize AX Pro is $50/mo for 50k spans. W&B Weave free is about 1 GB/mo ingestion with conflicting Pro prices. Braintrust free quota unverified. All UNCONFIRMED (aggregators). — [agentmarketcap 2026-04-23](https://agentmarketcap.ai/blog/2026/04/23/agent-observability-platform-race-wb-weave-arize-phoenix-braintrust-helicone); [costbench AI observability](https://www.costbench.com/software/ai-observability/); [rework 2026 tools list](https://resources.rework.com/tools/ai-data-infra/best-llm-observability-tools-2026)

### Inferences
- LangGraph integration: LangSmith is native (env vars only). Langfuse, Phoenix and Opik all ship LangChain/LangGraph callback or OpenTelemetry integrations; this is widely documented but wasn't re-verified here.
- One DealPilot job with several LLM calls plus tool spans could be 1 trace (LangSmith) but about 10-50 units/observations (Langfuse), so the two free tiers are closer in practice than 5k vs 50k suggests. Unit definitions not re-checked.
- Self-hosting Langfuse v3 needs Postgres + ClickHouse + Redis + S3. That's heavy for a 12 GB Oracle VM shared with the app, so Langfuse Cloud Hobby is the pragmatic $0 choice.

### Gaps
- Official free quotas for Braintrust, Weave, Opik Cloud and Phoenix Cloud weren't retrieved from vendor pages, and the LangSmith overage price per 1k traces wasn't shown.

## CI

### Takeaway
GitHub Actions is free and unlimited on standard runners for public repos. Private repos get a dollar-denominated compute allowance (Free $12/mo, about 2,000 Linux minutes).

### Cited Findings
- Included per month for private repos: Free $12 compute / 500 MB artifacts; Pro and Team $18. At $0.006/min for a 2-core Linux runner, that's about 2,000 and 3,000 minutes. Standard runners in public repos and self-hosted runners are free. — [GitHub Actions billing docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- **Change flag:** allowances are now expressed in dollars rather than minutes (previously 2,000 min Free / 3,000 min Pro/Team).

### Gaps
- Whether GitHub's planned self-hosted-runner platform fee took effect in 2026 wasn't confirmed on the page.

---

### Recommended architecture (synthesis, based on the findings above)
**$0 demo:** Oracle A1 VM (2 OCPU / 12 GB) running FastAPI + LangGraph + a Postgres-queue worker (procrastinate/pgqueuer) via Docker Compose, plus Postgres + pgvector on the same VM (200 GB disk). Alternative DB: Neon Free if the corpus stays under 1 GB. Storage: Cloudflare R2. Frontend: Cloudflare Workers via OpenNext or Netlify Free (Vercel Hobby only if the demo stays non-commercial). Observability: Langfuse Cloud Hobby or LangSmith Developer. CI: GitHub Actions. Fallback if Oracle capacity or reclaim is a problem: Cloud Run service (API) plus Cloud Run jobs (agent runs, 24 h cap) with Neon.

**About $5-25/month upgrade:**
- Option A: Railway Hobby at $5 (API + worker, about 1 GB each, likely $10-20 of usage), Neon Launch (a few GB, about $2-8), R2 (about $0), frontend on Cloudflare/Netlify Free, Langfuse Hobby. Roughly $15-25.
- Option B: Fly.io (2x shared-cpu-1x 1 GB = $13.40, plus volume) with Neon Launch, about $15-20.
- Option C: keep Oracle and add Supabase Pro ($25) for a managed DB + storage.

Exact totals are estimates, not quotes.
