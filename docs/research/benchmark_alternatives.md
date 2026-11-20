# Public benchmark alternatives to the custom 133-question set

Research date: 2026-11-17. Sources are arXiv, Hugging Face (HF) dataset cards and GitHub pages, fetched directly unless a row says otherwise.
Status labels: **[V]** I checked it on a primary page (arXiv abstract, HF card or GitHub). **[S]** It comes from a secondary source or a search snippet only. **[?]** I could not verify it.

Category key: **C1** fact extraction, **C2** numerical calculation, **C3** multi-hop or cross-document, **C4** temporal (across periods or restatements), **C5** adversarial or hallucination (unanswerable questions, false premises, missing facts).

## 1. Verified benchmarks (strongest candidates)

| Benchmark | Paper / date | Data URL | Size | Categories | Grounding | License | Grading | Gold evidence | Reported scores |
|---|---|---|---|---|---|---|---|---|---|
| **SECQUE** | arXiv 2504.04596 (Apr 2025; GEM 2025 workshop at ACL) [V] | huggingface.co/datasets/nogabenyoash/SecQue [V] | 565 questions, 45 filings, 29 companies [V] | C1, C2 (Ratio Analysis 188), C4 (Comparison & Trend Analysis 220), partial C3 (within and across filings), qualitative (Risk Factors 85, Analyst Insights 72) [S: counts from a search snippet of the paper] | Real SEC 10-K/10-Q excerpts in markdown and HTML, with accession number, Item and page [V] | **MIT** [V]. The card says it is for evaluation only and must not be used for training [V] | SECQUE-Judge, an ensemble of LLM judges [S] | Yes: context excerpt, page, item, accession number [V] | GPT-4o about 69% strict / 79% normalized [S, from alphaXiv, not checked in the paper] |
| **FailSafeQA** (Writer) | arXiv 2502.06329 (10 Feb 2025) [V] | huggingface.co/datasets/Writer/FailSafeQA [V] | 220 base examples × perturbations [V] | **C5** (empty, irrelevant or OCR-degraded context; out-of-scope, out-of-domain, incomplete and typo queries), C1, some C2 [V] | 10-K excerpts, 4.5K to 27.8K tokens [V] | **MIT** [V] | LLM judge (Qwen2.5-72B), reporting Robustness, Context Grounding and Compliance [V] | Yes: `citations` field [V] | o3-mini most robust but fabricated in 41% of cases; Palmyra-Fin-128k most compliant [V] |
| **Fin-RATE** | arXiv 2602.07294 (7 Feb 2026, KDD 2026) [V] | huggingface.co/datasets/GGLabYale/Fin-RATE; github.com/jyd777/Fin-RATE [V/S] | 7,500 QA (DR / EC / LT, about 2,500 each) [V total; S per split]; 2,472 filings, 43 companies, 2020 to 2025 [S] | **C4** (LT-QA tracks one firm across years), **C3** (EC-QA compares peer firms), C1, C2 (DR-QA) [V] | Real parsed and chunked SEC filings corpus [V] | **MIT** [V] | LLM-judge script with error taxonomy [V] | Corpus included; whether each QA row carries gold evidence is [?] | Accuracy drops 18.6% (longitudinal) and 14.35% (cross-entity) from single-doc [V]; GPT-5-websearch about 43% macro [S] |
| **FinanceBench** (Patronus) | arXiv 2311.11944 (Nov 2023) [V] | huggingface.co/datasets/PatronusAI/financebench [V] | 150 open-source of 10,231 total [V] | C1, C2, C4 (multi-year metrics), partial C3 (several statements in one filing); no C5 [V from fields and question types] | Real 10-K, 10-Q, 8-K and earnings files, with `doc_link` and `doc_period` [V] | **CC-BY-NC-4.0** (non-commercial; a commercial demo is risky) [V] | Manual review in the paper; others use LLM judge or numeric tolerance [V/S] | Yes: `evidence` (text and page) and `justification` [V] | GPT-4-Turbo plus retrieval wrong or refused on 81% [V] |
| **DocFinQA** (Kensho) | arXiv 2401.06915 (Jan 2024, ACL 2024) [S] | huggingface.co/datasets/kensho/DocFinQA [V] | 7,437 (train 5.74k, val 780, test 922) [V] | C1, C2 (program), long-document retrieval; C3 and C4 weak | Full 10-K text, FinQA questions re-grounded [V] | **MIT** [V] | Execution of the `Program` / numeric match | Program only, no span-level evidence [V] | [?] |
| **FinDER** (LinqAlpha / Yonsei) | arXiv 2504.15800 (Apr 2025) [V] | huggingface.co/datasets/Linq-AI-Research/FinDER [V] | 5,703 [V] | C1, C2 (Add/Subtract/Divide/Compositional types), RAG retrieval with ambiguous analyst-style queries; no C5 (questions without evidence were dropped) [V] | S&P 500 10-K [V] | **CC-BY-NC-4.0** [V] | Retrieval metrics plus LLM judge [S] | Yes: 1 to 6 `references` passages [V] | [?] |
| **FinanceQA** (AfterQuery) | arXiv 2501.18062 (Jan 2025) [V] | huggingface.co/datasets/AfterQuery/FinanceQA [V] | 148 [V] | C1, C2, `assumption` questions (incomplete information) are close to C5 [V] | 10-K sections, e.g. Costco FY2024 [V] | **Apache-2.0** [V] | [?] (strict match in the paper [S]) | Context plus chain of thought [V] | [?] |
| **Vals AI Finance Agent** | arXiv 2508.00828 (2025) [V] | github.com/vals-ai/finance-agent, `data/public.txt` [V] | 537 total; the public file has 50 questions [V] | C1 to C4 (e.g. a 2-year revenue CAGR for Palantir, comparing AMZN/META/GOOG capex plans), agentic EDGAR search [V] | Live EDGAR plus web search (an agent task, not a closed context) [V] | MIT repo [V] | [?] (Vals platform) | The public file holds **questions only**, with no answers or evidence [V] | o3 46.8% [V] |
| **PHANTOM** | NeurIPS 2025 Datasets & Benchmarks (Ji, Seyler, …, Bing Xiang) [V] | **No public dataset URL found** [?] | [?] | C5, but framed as **detecting** hallucinated answers, not abstaining [V/S] | SEC filings (10-K, 497K, DEF 14A), 500 to 30K tokens [S] | [?] | Classification (hallucinated or correct) | Query, answer and chunk triplets [V] | Small models near random [S] |
| **FinLFQA** | arXiv 2510.06426 (Oct 2025, EMNLP Findings) [V/S] | github.com/yitaoLong/FinLFQA [S] | 1,008 [S] | C1, C2, attribution (evidence, reasoning steps, knowledge) | Financial reports [S] | [?] | LLM judge plus attribution metrics [S] | Yes, attribution is the focus [S] | [?] |
| **FAITH** | arXiv 2508.05201 (Aug 2025) [S] | Release reported public [S]; URL [?] | [?] | C5 (intrinsic tabular hallucination), C2 | S&P 500 annual reports, masked numeric spans [S] | [?] | Exact numeric span | Context is the evidence | [?] |

## 2. Classic sets (well known, not re-verified this session)

These details come from my prior knowledge and were not fetched this session, so verify them before use.
- **FinQA** (arXiv 2109.00122, EMNLP 2021): 8,281 QA over S&P 500 10-K pages from FinTabNet; MIT; execution and program accuracy; gold facts included. Covers C1 and C2.
- **TAT-QA** (arXiv 2105.07624, ACL 2021): 16,552 QA over hybrid table and text from annual reports (not specifically SEC filings); CC BY 4.0; EM/F1. Covers C1 and C2.
- **ConvFinQA** (arXiv 2210.03849, EMNLP 2022): about 3.9k conversations built on FinQA; MIT. Covers C2 and multi-turn questions.
- **MultiHiertt** (arXiv 2206.01347, ACL 2022): about 10.4k QA over multiple hierarchical tables; MIT. Covers C2 and C3 (multi-table).
- **BizBench** (2311.06602), **FinBen** (2402.12659), **FinanceReasoning** (2506.05828), **FinSearchComp** (2509.13160), **FinGAIA** (2507.17186), **FinTextQA** (2405.09980), **FinTMMBench** (2503.05185, temporal and multimodal): all unverified this session. Most are either broad suites or not grounded in SEC filings.
- Newer items found in search, all unverified: **RealFin** (2602.07096; removes premises from exam questions, so it fits C5 but is not grounded in SEC filings), **FinBench-QA-Hallucination** (2603.20252; 755 examples on 10-K pages, CC BY-NC-ND per the arXiv page).

## 3. Gaps

- **No single public benchmark covers all five categories.** C5 (abstaining on unanswerable or false-premise questions over real filings) appears only in FailSafeQA among the permissive, downloadable sets. PHANTOM has no data release I could find.
- **Restatements:** none of the verified sets explicitly tests restated figures (original versus restated values in a later 10-K or a 10-K/A). Fin-RATE's longitudinal split is the closest. If DealPilot needs restatement handling, it still needs a small custom slice of about 10 to 20 questions, which could reuse the EDGAR ground-truth harness.

## 4. Recommendation

**Primary benchmark: SECQUE** (565 questions, MIT, real 10-K/10-Q excerpts with accession numbers and page and item evidence). It covers C1, C2 and C4, partly covers C3, and is a cheap size to run. Its weak spot is C5. Its card forbids training on the data, which is fine for evaluation.
FinanceBench-150 is the most cited alternative, but its CC-BY-NC license makes commercial or demo use questionable, and it has no C5 coverage.

**Minimal combination that covers all five categories (all MIT):**
1. **SECQUE** (565): C1, C2, C4, partly C3.
2. **FailSafeQA** (220 × perturbations): C5. It tests refusing on empty or irrelevant context, out-of-scope questions and fabrication, over 10-K text.
3. **Fin-RATE**, a sampled subset (e.g. 100 to 150 each from LT-QA and EC-QA): stronger C3 (cross-company) and C4 (longitudinal).

Optional: add FinanceBench-150 for internal-only comparison with published results, and a small custom restatement slice.

Grading note: all three recommended sets rely on LLM judges. To keep results comparable with the published numbers, run each set's own judge or rubric. For C2, add DealPilot's numeric-tolerance check against gold values on top.
