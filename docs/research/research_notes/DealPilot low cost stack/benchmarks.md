# DealPilot Evaluation Benchmarks: Verification and Alternatives (as of 17 Nov 2026)

Method note: 16 web search and fetch calls covering arXiv, GitHub, Hugging Face, vals.ai, joinhandshake.com, sec.gov, and secondary write-ups. Leaderboard figures were taken from vals.ai pages as fetched on 17 Nov 2026. Model names such as "Gemini 4 Argon", "Claude Fable 5.2" and "Muse Spark" are reproduced exactly as those pages show them and were not checked against any other source. Fetched pages were summarised by a tool model, so a figure that drives a decision should be re-checked on the primary page.

## Q1. Does "BankerToolBench" exist, and do the proposal's details hold?

### Takeaway
Yes. BankerToolBench (BTB) is a real open-source benchmark from Handshake AI, released April 2026. The proposal's description ("100 end-to-end IB tasks, expert rubrics, deliverable-based evaluation, dataset and evaluation code available") is accurate. The only correction: grading is done by an LLM agent verifier (default Gemini 3 Flash Preview), validated against human bankers, so it is not human grading. Code is Apache-2.0 and data is CC-BY-4.0, so commercial and demo use is allowed with attribution.

### Cited Findings
- **Name and paper:** "BankerToolBench: Evaluating AI Agents in End-to-End Investment Banking Workflows", arXiv:2604.11304, submitted 13 Apr 2026, 27 authors (lead author Elaine Lau), listed as NeurIPS 2026. — [arXiv abs](https://arxiv.org/abs/2604.11304)
- **Affiliations:** All authors are listed as Handshake AI, and one also lists McGill University. Secondary coverage describes it as "Handshake AI and McGill". — [arXiv HTML](https://arxiv.org/html/2604.11304); [the-decoder](https://the-decoder.com/500-investment-bankers-review-ai-outputs-and-find-none-ready-for-client-delivery/)
- **How it was built:** The authors worked with 502 investment bankers from leading firms. A task takes a banker up to 21 hours. Tasks span IB product groups (e.g. M&A, Leveraged Finance) and workflow categories (Financial Modeling, Valuation, Client Materials). — [arXiv abs](https://arxiv.org/abs/2604.11304); [Handshake page](https://joinhandshake.com/research/benchmarks/bankertool-bench/)
- **Size and rubrics:** 100 tasks. Each task has a prompt, optional input files, and a rubric. Rubrics average about 150 criteria, and most exceed 100. Each criterion is pass/fail with a weight of 1, 3, 5 or 10, and the task score is the weighted fraction passed. — [GitHub](https://github.com/Handshake-AI-Research/bankertoolbench); [arXiv HTML](https://arxiv.org/html/2604.11304)
- **Environment:** Agents navigate data rooms and reach an SEC filings database, a market-data platform and brand assets through three MCP tool servers. They produce Excel models, PowerPoint decks and Word/PDF reports. — [GitHub](https://github.com/Handshake-AI-Research/bankertoolbench); [arXiv abs](https://arxiv.org/abs/2604.11304)
- **Grading:** The agentic verifier ("Gandalf the Grader") opens spreadsheets, checks formulas and parses decks. Its default model is `gemini/gemini-3-flash-preview`, which can be changed by flag. Its accuracy against experts is 88.2% (κ=0.76), compared with 84.6% human inter-rater agreement (κ 0.69–0.82). Run-to-run standard deviation is 0.4 pp. — [GitHub](https://github.com/Handshake-AI-Research/bankertoolbench); [arXiv HTML](https://arxiv.org/html/2604.11304)
- **Data access and license:** Dataset at huggingface.co/datasets/handshake-ai-research/bankertoolbench. Code is Apache-2.0, dataset is CC-BY-4.0. It runs as a Harbor task suite with OpenHands, OpenCode or Goose harnesses. v1.0 is the version in the paper, and v1.1 (`main`) is recommended for new runs. — [GitHub](https://github.com/Handshake-AI-Research/bankertoolbench)
- **Baseline scores:** Bankers rated 0% of AI deliverables "Sendable as-is". The best model, GPT-5.4, passes 16% of tasks at the acceptability threshold (Pass@1), or 13% under Pass^3. Only 2% of its tasks pass all critical-weight criteria (Gemini 2.5 Pro 0%, other frontier models 1%). In the harness comparison with OpenCode, GPT-5.2 scored 56.1±0.2 and Claude Opus 4.6 scored 53.2±0.5. Nine frontier models were tested. — [arXiv HTML](https://arxiv.org/html/2604.11304)
- **Compute and cost:** 30–50 GB of disk, Docker, and API keys for both the agent model and the verifier. Shared data is about 5.5 GB compressed. Runs average 701.6 s per task (Opus 4.6) and 977.3 s (GPT-5.2), with up to 539 LLM calls per task. No dollar cost is reported. — [GitHub](https://github.com/Handshake-AI-Research/bankertoolbench); [arXiv HTML](https://arxiv.org/html/2604.11304)
- **Failure modes:** Outputs looked polished but contained errors in Excel formulas and numbers. Models produced hard-coded models, so changing the purchase price updated nothing. — [the-decoder](https://the-decoder.com/500-investment-bankers-review-ai-outputs-and-find-none-ready-for-client-delivery/)

### Inferences
- BTB is the best available match for DealPilot's "rubric score" and "task completion" metrics, and it covers Excel, deck and memo deliverables. Its permissive license makes it usable for a public demo.
- A full 100-task run is expensive. At about 150 criteria per task, about 15,000 verifier checks, and up to 539 agent calls per task, plausible API spend is in the hundreds of dollars per model run. That is an estimate, not a reported figure. A 10–20 task subset is a sensible dev-loop eval.
- A cheap-model verifier (Gemini 3 Flash) at 88% agreement adds roughly ±12% per-criterion noise. Aggregate scores are stable (0.4 pp std), but individual criterion verdicts are not.

### Gaps
- Full per-model score table (paper Figure 6) was not extracted. Read it from the paper PDF or the Handshake leaderboard images. No text leaderboard was found on the Handshake page.
- No dollar cost per run is published.

## Q2. Does a "FinAgent Benchmark" with 133 questions exist?

### Takeaway
I could not find any benchmark named "FinAgent Benchmark" with 133 questions and the five listed categories (fact extraction, numerical reasoning, multi-hop, temporal, adversarial hallucination checks). The description does not match a known public benchmark and should be treated as unverified, possibly an internal or proposal-authored set. The closest real match is Vals AI's **Finance Agent Benchmark** (FAB). Its current edition is v2.1 with 926 questions: 27 public, 450 private validation (licensable), and 449 private test. Leaderboard scores use only the private test split.

### Cited Findings
- **Search result:** Targeted searches for "133 questions" with these categories found no match. They returned the Vals Finance Agent Benchmark (537 questions in the paper), FinAgentBench (agentic retrieval, arXiv 2508.14052), FinReflectKG-MultiHop (arXiv 2510.02906), and a 100-question financial time-series agent benchmark. — [Vals FAB paper](https://arxiv.org/abs/2508.00828); [FinAgentBench](https://arxiv.org/html/2508.14052); [FinReflectKG-MultiHop](https://arxiv.org/abs/2510.02906)
- **Vals FAB paper:** "Finance Agent Benchmark: Benchmarking LLMs on Real-world Financial Research Tasks", arXiv:2508.00828. It has 537 expert-authored questions in 9 categories over SEC filings published after 2024. The best model then reached 46.8% class-balanced accuracy. — [arXiv](https://arxiv.org/pdf/2508.00828)
- **v1.1 splits:** 50 public, 150 private validation (licensable), and 337 test. Results were reported on test only. — [Vals v1.1](https://vals.ai/benchmarks/finance_agent)
- **v2 (archived, superseded by v2.1):** 927 questions, split 27 public / 450 private validation / 450 test. Nine categories: General Qualitative, General Quantitative, Market Analysis, Comparables, Precedents, Adjustments, Earnings Analysis, Disclosure Analysis, Financial Modeling. Tools given to the agent: edgar_search, web_search, parse_html_page, retrieve_information, calculator, price_history. Each task has a 2-hour limit. Grading uses weighted checks plus "dealbreaker" items that zero a question if failed, with Partial Credit as the primary metric and All-Pass as secondary. A 3-LLM jury (GPT-5.4, Gemini-3.1-Pro, Claude Sonnet 4.6) grades responses, and each model is run 3 times. The top v2 score was 65.40% (Gemini 4 Argon, $4.38 per test, 16m21s). — [Vals FAB v2](https://www.vals.ai/benchmarks/fabv2)
- **v2.1 (updated 11 Nov 2026):** 27 public / 450 private validation / 449 test. It adds a new jury (GPT-6.1 Sol, Gemini 3.8 Flash, Claude Sonnet 5.5), a grading prompt updated for hedged answers, and data fixes. Top three: Claude Fable 5.2 at 69.47% ($4.83 per test, 3m28s), Claude Opus 5.5 at 67.85% ($8.91, 33m00s), Gemini 4 Argon at 67.66% ($4.32, 13m13s). The public set and harness are at github.com/vals-ai/finance-agent-v2. — [Vals FAB v2.1](https://www.vals.ai/benchmarks/fabv2-1)
- **Edition comparability:** Scores are not comparable across editions because questions, rubrics and jury changed. — [BenchLM mirror](https://benchlm.ai/benchmarks/financeagentv2)
- Vals publishes only test-set scores, which stay private. A public validation set shows the question style, and a larger private validation set is licensed to enterprises. — [Vals FAB page](https://vals.ai/benchmark/finance-agent)

### Inferences
- The proposal's "FinAgent Benchmark (133 questions)" is most likely a mislabel of Vals FAB, or a self-built set. The proposal should say "Vals AI Finance Agent Benchmark v2.1" and state that DealPilot can only self-score on the 27 public questions. Scores directly comparable to the leaderboard require Vals to run the private test set, or a license.
- If the team wants the five listed categories, it should build that set itself from EDGAR (see Q6) and call it an internal set, not a named external benchmark.
- FAB's tool set closely matches a DealPilot agent loop (EDGAR search, web, parse, calculator, price history), so its harness can be reused as a design reference.

### Gaps
- The license of the vals-ai/finance-agent-v2 GitHub repo and its public set was not stated on the fetched page. Check the repo LICENSE file before demo use.
- The cost and terms of licensing the 450-question private validation set were not found.

## Q3. FinanceBench: size, license, grading

### Takeaway
Confirmed. FinanceBench (Patronus AI, Nov 2023) has 10,231 question/answer/evidence triplets. Only 150 are open on Hugging Face, under **CC-BY-NC-4.0**, which allows non-commercial use only. A commercial product demo is a grey or no-go area without permission from Patronus. The paper graded about 2,400 answers by manual human review, not an automated metric.

### Cited Findings
- arXiv:2311.11944 (20 Nov 2023), authors Islam, Kannappan, Kiela, Qian, Scherrer, Vidgen. The benchmark "comprises 10,231 questions about publicly traded companies" with answer and evidence strings. 150 cases were tested and open-sourced. Authors manually reviewed 2,400 answers from 16 model configurations. GPT-4-Turbo with retrieval "incorrectly answered or refused to answer 81% of questions." — [arXiv](https://arxiv.org/abs/2311.11944)
- Hugging Face `PatronusAI/financebench`: license cc-by-nc-4.0, 150 rows. Fields include question, answer, justification, `evidence` (passages with page numbers and full page text), doc_link, question_type (metrics-generated / domain-relevant / novel-generated) and question_reasoning (e.g. information extraction, numerical reasoning, logical reasoning). The full dataset is available by contacting Patronus. Source PDFs are on GitHub. — [HF dataset](https://huggingface.co/datasets/PatronusAI/financebench)

### Inferences
- Because evidence includes page numbers, FinanceBench-150 is cheap to use for citation correctness (did the agent cite the right page?) as well as for answer accuracy, scored by numeric tolerance plus an LLM judge.
- For internal development the NC license is fine. Before publishing scores in a commercial pitch, confirm the terms or rely on BTB (CC-BY) or self-built EDGAR data.

### Gaps
- No official automated grader or rubric is shipped with the dataset, so DealPilot must define one.

## Q4. Benchmarks for citation/evidence correctness and hallucination resistance

### Takeaway
No single established leaderboard exists for 10-K citation accuracy. The usable options are FinanceBench-150 (page-level evidence), FinLFQA (attribution of evidence, numerical reasoning and domain knowledge), PHANTOM (hallucination detection on SEC long context) and ECTs-100 (citation-grounded earnings calls). BTB and FAB rubrics also penalise unsupported numbers.

### Cited Findings
- **FinLFQA** (arXiv 2510.06426, Oct 2025): 1,008 expert-annotated instances from 10-Q reports. It scores attribution beyond citation, covering supporting passages, numerical-reasoning steps and domain knowledge. GPT-4o scored best among the models tested. — [arXiv](https://arxiv.org/pdf/2510.06426)
- **PHANTOM** (NeurIPS 2025): hallucination detection on SEC filings, judging whether an answer is grounded in or fabricated from long-context passages. Small models score near random. Details come from a secondary review. — [beancount.io review](https://beancount.io/nl/bean-labs/research-logs/2026/04/19/phantom-hallucination-detection-financial-long-context)
- **ECTs-100** (NeurIPS 2026 listing): citation-grounded benchmark on earnings call transcripts for the top 100 S&P 500 constituents. It uses numeric evidence evaluation without expert annotation. — [NeurIPS 2026](https://neurips.cc/virtual/2026/161678)
- FinanceBench evidence fields include page numbers. — [HF](https://huggingface.co/datasets/PatronusAI/financebench)

### Inferences
- For "citation correctness", score (a) whether the cited filing, page or XBRL fact actually contains the claimed value, and (b) whether the value matches within tolerance. This can be automated against XBRL (Q6) and FinanceBench evidence pages.
- For "deal-risk detection precision/recall", no public benchmark was found. Build a labelled set of risk flags (going-concern language, covenant breaches, restatements, related-party transactions, customer concentration) from real filings.

### Gaps
- PHANTOM's and ECTs-100's licenses, sizes and score tables were not verified from primary sources.
- No public benchmark for deal-risk detection or cross-document consistency was found.

## Q5. Spreadsheet / financial-model generation benchmarks

### Takeaway
SpreadsheetBench (v1 Verified, and the harder v2 with a financial-modeling category) is public and widely reported, but its leaderboards are mostly vendor-reported and inconsistent. Vals AI's Excel Modeling Benchmark (Jul 2026, LBO/DCF/M&A) is the most finance-relevant but private. BTB's Excel tasks are the best open option. I found no benchmark called "FinSheet".

### Cited Findings
- **SpreadsheetBench official site** (Mar 2026 snapshot): top entry Claude Opus 4.6 + Bash Agent at 34.89% overall, financial-modeling sub-score 34%. Submissions require contacting the organisers. — [spreadsheetbench.github.io](https://spreadsheetbench.github.io)
- **SpreadsheetBench V1 Verified (400 tasks):** vendor claims above 90% (GPT for Excel 92.5%, GRID 91.25%). These are self-reported. — [GPT for Work](https://gptforwork.com/blog/gpt-for-excel-on-spreadsheetbench); [GRID](https://grid.is/blog/an-agent-with-a-spreadsheet-engine-beats-one-without); [benchmarklist](https://benchmarklist.com/benchmarks/spreadsheetbench_v1_verified/)
- **SpreadsheetBench 2:** harder set covering financial modeling, debugging and visualization. Kimi K3 scored 34.8% (Jul 2026), but only one model is listed. — [BenchLM](https://benchlm.ai/benchmarks/spreadsheetbench2)
- **Vals Excel Modeling Benchmark** (1 Jul 2026): agents build complete LBO, DCF and M&A models, compared against expert gold spreadsheets on formula-structure and number checks. It is private. Top scores: Claude Opus 4.8 at 69.4% (87% formula structure, 61% numbers, about $12 per task), Claude Sonnet 5 at 66.3%, GPT-5.5 at 64.5%. MiMo V2.5 Pro scored above 50% at $0.22 per task. — [letsdatascience](https://letsdatascience.com/news/vals-ai-launches-excel-modeling-benchmark-for-finance-agents-6a2d5a85)

### Inferences
- For DealPilot's "calculation accuracy", use BTB Excel tasks plus a self-built check: recompute model outputs with a formula engine and test that changing an input propagates (the hard-coding failure BTB found).

### Gaps
- The SpreadsheetBench license, the task count of Vals EMB, and the verified current official leaderboard were not confirmed. No benchmark named "FinSheet" was found (no search hit; not searched exhaustively).
- FinQA, TAT-QA, ConvFinQA, DocFinQA, FinanceQA, BizBench, FinBen/PIXIU, SEC-QA, FinSearchComp and FinGAIA were not individually verified within the call budget. They are older or narrower QA sets and should be verified separately if cited.

## Q6. Building an EDGAR-grounded gold set cheaply; recommended suite

### Takeaway
SEC's free, keyless XBRL APIs (companyfacts, companyconcept, frames, plus nightly bulk `companyfacts.zip`) give machine-readable reported values with accession numbers and periods. That makes auto-generated gold answers for extraction, calculation, temporal and cross-document questions almost free. The recommended suite combines BTB, Vals FAB public set, FinanceBench-150, an internal XBRL set, and an internal risk-flag set.

### Cited Findings
- **Endpoints:** `data.sec.gov/api/xbrl/companyfacts/CIK##########.json` (all facts for one company); `companyconcept/CIK…/us-gaap/<Tag>.json` (one concept across filings, with a facts array per unit); `frames/us-gaap/<Tag>/USD/CY2019Q1I.json` (one fact per filer for a period, in CY####, CY####Q# or CY####Q#I format). — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- **Access:** No authentication or API keys. CORS is not supported. Bulk `companyfacts.zip` and `submissions.zip` are republished nightly around 3:00 a.m. ET. The APIs update within about a minute of a filing being disseminated. Automated access must follow SEC's Privacy and Security Policy and Developer FAQ. — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

### Inferences
**Building the internal gold set:**
- **Fact extraction:** Pick a tag, company and period from companyfacts. The gold answer is the value, unit and accession number, and the citation check is that the agent cites that accession or filing.
- **Calculation:** Derive ratios (margins, leverage, YoY growth) from 2+ XBRL facts, with ±0.5% relative tolerance as gold.
- **Temporal reasoning:** Use multiple periods from companyconcept, e.g. "Q3 FY24 vs Q3 FY23". Restated values (the same period reported in a later filing) give "which filing is current" tests.
- **Cross-document consistency:** Compare 10-Q against 10-K values and segment sums against totals.
- **Adversarial hallucination checks:** Ask for tags or periods that do not exist. The gold answer is a refusal or "not reported".
- **Cost:** Generating 500–1,000 questions takes a few scripts and no data cost. A light human spot-check of about 10% catches XBRL tagging quirks (dimensions, sign, scale).

Caveat: the SEC fair-access limits (commonly cited as 10 req/s with a declared User-Agent) are on the SEC Developer FAQ, which I did not fetch. Verify before scripting.

**Recommended suite (metric → source → grading):**

| DealPilot metric | Primary eval | Grading | License / access |
|---|---|---|---|
| Rubric score, task completion | BankerToolBench v1.1 (10–20 task dev subset; full 100 for releases) | Agentic LLM verifier, weighted pass/fail; report Pass@1 and critical-criteria pass | Apache-2.0 / CC-BY-4.0, public |
| Calculation accuracy | Internal XBRL set + BTB Excel tasks (input-propagation check) | Numeric tolerance, formula-engine recompute | Public-domain SEC data |
| Citation correctness | FinanceBench-150 (page evidence) + internal XBRL (accession match) | Exact match on source ID/page + value tolerance | FinanceBench CC-BY-NC (internal only) |
| Research-agent accuracy (comparability) | Vals FAB v2.1, 27 public questions (self-run); optional license or Vals run for test set | LLM-jury rubric with dealbreakers | Public set on GitHub (license unverified) |
| Hallucination resistance | Internal unanswerable-question set; optionally PHANTOM / FinLFQA | Refusal accuracy, LLM judge | Verify licenses |
| Deal-risk detection P/R | Internal labelled risk-flag set from real filings (no public benchmark found) | Precision/recall vs human labels | Internal |
| Cross-document consistency | Internal 10-Q/10-K/segment reconciliation set | Exact/tolerance match | Internal |
| Latency / cost | Log per task across all of the above; compare with Vals cost/test and duration reporting | Wall-clock, $ per task | n/a |

- Replace "FinAgent Benchmark (133 questions)" in the proposal with either "Vals AI Finance Agent Benchmark v2.1 (public split)" or an explicitly labelled internal set.

### Gaps
- The SEC rate limit and User-Agent rule were not confirmed from the fetched page.
- No published cost per run exists for BTB or for licensing Vals data.
