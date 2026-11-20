# Free and Low-Cost Financial Data Sources for DealPilot (DCF + Trading Comps), as of November 2026

Research done 2026-11-17. "Checked 2026-11-17" means the figure was read from the primary page on that date. Figures from third-party or vendor-comparison pages are marked as secondhand.

## SEC EDGAR: fair access policy, data.sec.gov APIs, bulk files, full-text search, Financial Statement Data Sets, XBRL quirks

### Takeaway
EDGAR is free, needs no API key, and is the right backbone for fundamentals. The rules are a limit of 10 requests/second and a declared User-Agent with a company name and contact email. The JSON APIs (submissions, companyfacts, companyconcept, frames) update in near real time. The nightly bulk zips are the efficient way to load data at scale. The XBRL APIs return only standard-taxonomy facts, so company-specific custom tags are missing from them.

### Cited Findings
- **Fair access:** the current maximum request rate is 10 requests/second. The SEC may limit rates further. Requesters should declare a User-Agent; the SEC's sample is "Sample Company Name AdminContact@<sample company domain>.com". Requests outside the policy "will be managed" (throttled or blocked). The SEC gives no tech support for scripted access. Page last reviewed/updated June 26, 2024 (checked 2026-11-17) — [SEC: Accessing EDGAR Data](https://www.sec.gov/os/accessing-edgar-data)
- **Temporary IP blocks:** a secondhand claim says going over the limit triggers a temporary IP block, "typically 10 minutes". This is **unconfirmed**; the SEC page gives no duration — [tldrfiling blog](https://tldrfiling.pages.dev/blog/sec-edgar-full-text-search-api)
- **data.sec.gov APIs:** RESTful JSON, "do not require any authentication or API keys". They cover XBRL data from 10-Q, 10-K, 8-K, 20-F, 40-F, 6-K and their variants. **CORS is not supported**, so a browser front end cannot call data.sec.gov directly and needs a backend proxy or cache — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
  - **Submissions:** `https://data.sec.gov/submissions/CIK##########.json` (10-digit CIK with leading zeros). Includes current and former names, exchanges and tickers. Covers at least 1 year or the 1,000 most recent filings, whichever is more; older filings are in extra files listed in an array — same source
  - **Companyconcept:** `/api/xbrl/companyconcept/CIK##########/us-gaap/AccountsPayableCurrent.json`. One concept for one company, with facts grouped by unit — same source
  - **Companyfacts:** `/api/xbrl/companyfacts/CIK##########.json`. Every concept for a company in one call — same source
  - **Frames:** `/api/xbrl/frames/us-gaap/AccountsPayableCurrent/USD/CY2019Q1I.json`. Returns one fact per filer, "the most recently filed fact that best fits" the period. Formats are CY#### (annual), CY####Q# (quarterly) and CY####Q#I (instant). Because fiscal calendars vary, facts in one frame can have different start and end dates — same source
  - **Coverage of the XBRL APIs:** only facts in non-custom taxonomies (us-gaap, ifrs-full, dei, srt) that apply to the whole filing entity. Custom extension tags and dimensional/segment facts are excluded — same source
  - **Latency:** updates run in real time; submissions typically lag less than 1 second and XBRL APIs less than 1 minute, longer at peak times — same source
- **Bulk zips:** `companyfacts.zip` (`/Archives/edgar/daily-index/xbrl/companyfacts.zip`) and `submissions.zip` (`/Archives/edgar/daily-index/bulkdata/submissions.zip`). Rebuilt nightly around 3:00 a.m. ET; the SEC calls them "the most efficient means" for large pulls — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- **Full-text search (FTS):** covers filings since 2001, including all attachments and exhibits. Wildcards work only at the end of a word, there is no natural-language search, and NEAR defaults to 10 words — [SEC FTS FAQ](https://www.sec.gov/edgar/search/efts-faq.html)
  - The backing endpoint `efts.sec.gov/LATEST/search-index?q=...&forms=10-K` returns Elasticsearch-style JSON. A live test on 2026-11-17 returned 100 hits per page, and `hits.total` was capped at `{"value":10000,"relation":"gte"}`. Each hit has ciks, adsh, form, file_date, period_ending, sics, items, biz_states and similar fields — [efts.sec.gov live query](https://efts.sec.gov/LATEST/search-index?q=%22goodwill%22&forms=10-K)
  - Third-party sources report a 10,000-result ceiling on deep paging, so split queries by form and date range — [Apify listing](https://apify.com/eltociear/sec-edgar-filings.md). The efts endpoint is not in the official API docs, so treat it as undocumented and subject to change
- **Financial Statement Data Sets:** numeric data from the face financial statements, flattened for cross-company comparison and including SIC. Updated **quarterly**; filings after a quarter's last business day go into the next release. Coverage starts January 2009. In **December 2024** the data was reprocessed to include only primary financial statement data "as rendered", and the NUM file gained a "segments" field. The SEC does not guarantee accuracy. A separate "Financial Statement and Notes" data set also exists — [SEC Financial Statement Data Sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets)

### Inferences
- Duplicate facts: companyfacts returns every filing in which a value appeared. A FY2023 revenue figure shows up again in the FY2024 and FY2025 10-Ks as a comparative, and in 10-Qs. Each fact carries `accn`, `fy`, `fp`, `form`, `filed` and `frame` fields. To get one value per period, dedupe on (concept, unit, start, end) and keep the latest `filed`; the `frame` field marks the SEC's own pick. This is based on general knowledge of the companyfacts schema, not on a page fetched in this session.
- Restatements: the same deduplication step decides whether you see an original or a restated value. "Latest filed" gives restated figures; "first filed" gives the as-reported (point-in-time) figures.
- dei vs us-gaap: shares outstanding (`dei:EntityCommonStockSharesOutstanding`) and public float (`dei:EntityPublicFloat`) are dei facts dated at the cover-page date, not the balance-sheet date. Weighted-average shares and EPS are us-gaap facts.
- Tag drift: different filers, and the same filer over time, use different tags for one item. Revenue may be `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet` (older filings) and others. DealPilot needs a tag-fallback map or a library that standardizes statements.
- Because there is no CORS, a public web demo needs a server-side cache. Caching also keeps DealPilot well under 10 requests/second.

### Gaps
- No official SEC statement on how long a block lasts after the rate limit is exceeded.
- No official documentation of the efts endpoint or its paging limits; the 10,000 cap was seen in a live response and is not documented.
- The SEC terms for redistributing EDGAR data were not fetched. EDGAR filings are US government public records and are generally treated as public domain, but this was not confirmed against an SEC page in this session.

## Python libraries for EDGAR: maintenance in 2026, and which ones turn XBRL into statements

### Takeaway
edgartools is the clear choice in 2026. It is actively released (6.2.0 on 2026-11-15), MIT-licensed, and builds standardized income statements, balance sheets and cash-flow statements from XBRL. It also derives Q4 and TTM figures and has full-text search and an MCP server. sec-edgar-downloader (5.1.0, Feb 2026) only downloads raw filings and is a fine helper for that job.

### Cited Findings
- **edgartools 6.2.0**, released Nov 15, 2026, MIT license, Python 3.11+ (3.11–3.14, CPython and PyPy) — [PyPI: edgartools](https://pypi.org/project/edgartools/)
  - Builds standardized income statements, balance sheets and cash-flow statements from XBRL, with rows aligned across filers. Calculates discrete quarterly figures (Q4 derived from the 10-K) and TTM totals — same source
  - Full-text search with filters for form, date and 8-K item. Extracts 10-K and 10-Q sections as text and converts filings to markdown. Parses 13F, Form 4, N-PORT and 8-K earnings exhibits. Has an agent skill and a local MCP server via the `ai` extra — same source
- **sec-edgar-downloader 5.1.0**, released Feb 2, 2026, MIT license. Downloads filings by ticker or CIK for many form types. It requires a company name and email at construction and uses them to build the User-Agent, "to comply with the SEC's fair access policy" — [PyPI: sec-edgar-downloader](https://pypi.org/project/sec-edgar-downloader/)

### Inferences
- For DealPilot, edgartools covers parsing, standardization, Q4/TTM and MCP. Its MCP server is relevant for an AI-agent product. The library's standardized statement mapping can stand in for most of a home-grown tag-fallback map, but spot-check it against the rendered statements.
- Always set the User-Agent identity (edgartools uses `set_identity(...)`; from general knowledge, not checked this session), and add caching.

### Gaps
- No 2026 release data was collected for **secedgar** or **py-xbrl** (tool budget). From prior knowledge, py-xbrl has seen little activity in recent years, but this is **unverified** for 2026. Check their PyPI and GitHub pages before using either.
- GitHub star counts and issue activity for edgartools were not collected.

## Market data APIs: prices, market cap, shares, price history for beta (current free limits and ToS)

### Takeaway
No free market-data source is both reliable and licensed for public display. yfinance is the easiest option but is unofficial and rate-limited at Yahoo's discretion. Most official free tiers are limited to personal or internal "non-display" use. For a public demo, the realistic choices are a cheap paid tier or computing market cap from EDGAR share counts times an EOD price, with the price source shown.

### Cited Findings
- **yfinance:** unofficial; it scrapes Yahoo endpoints. Latest version 1.6.0 (PyPI, Aug 13, 2026). Yahoo publishes no rate limits. Users report "Too Many Requests. Rate limited" errors and temporary IP blocks. One vendor reports a user cut off at about 950 of 7,000 tickers per day (Nov 2024). HTTP 429s were still reported in Jan 2026 (low-quality, anecdotal source) — [yfinance GitHub discussion #2431](https://github.com/ranaroussi/yfinance/discussions/2431); [orthogonal.info on yfinance 1.6.0](https://orthogonal.info/yfinance-python-stock-data-live-streaming-screening/); [usahousinginformation.com (anecdotal)](https://usahousinginformation.com/yahoo-finance-too-many-requests/)
- **Stooq:** an API key has been required for CSV downloads since about **March 2026**, which broke pandas-datareader's Stooq reader (it now gets HTML instead of CSV). The key is reportedly obtained through a CAPTCHA, and there is a daily hit limit ("Exceeded the daily hits limit"). An April 2026 Polish guide contradicts this. **Not verified on Stooq's own site** — [pandas-datareader issue #1012](https://github.com/pydata/pandas-datareader/issues/1012); [apievangelist Stooq](https://providers.apievangelist.com/providers/stooq/)
- **Alpha Vantage:** the free tier is **25 requests/day**. The cheapest premium plan is $49.99/month for 75 requests/minute (checked 2026-11-17) — [Alpha Vantage Premium](https://www.alphavantage.co/premium/)
- **Financial Modeling Prep (FMP):** the free Basic plan is **$0 for 250 calls/day**, EOD only. It reportedly includes about 5 years of stock history and 5 quarters of financial statements, and is US only — [FMP help](https://site.financialmodelingprep.com/education/other/do-you-need-a-credit-card-to-use-financial-modeling-prep); [FMP pricing](https://site.financialmodelingprep.com/pricing-plans). The official pricing page returned 403 to the fetcher. Paid prices are **conflicting/secondhand**: an Aug 2026 comparison lists Starter $22, Premium $59 and Ultimate $149 per month (billed annually), with 300, 750 and 3,000 calls/minute — [multiples.vc](https://multiples.vc/compare/fmp-api-alternatives)
- **Finnhub:** the free tier is about **60 calls/minute**, US coverage, with WebSocket for 50 symbols. It is non-commercial; a monetized or redistributing app needs a paid plan. Stock candles (price history) are reportedly premium-only. This is **secondhand**, because finnhub.io/pricing did not render for the fetcher — [Massive vs Finnhub (competitor, Oct 2026)](https://massive.com/compare/massive-vs-finnhub); [apicostcalc Finnhub](https://apicostcalc.com/finnhub.html)
- **Massive (formerly Polygon.io):** Polygon became Massive in **October 2025**; api.polygon.io and api.massive.com both work with the same keys. The free Stocks Basic plan has **5 calls/minute**, EOD data, 2 years of history and all US tickers. A day's bars become available after midnight ET. Stocks Starter is $29/month for unlimited calls, 5 years of history and 15-minute delay (secondhand/search summary). On the official pricing page fetched 2026-11-17, the visible stocks plan was Stocks Advanced at $199/month, plus "Financials & Ratios" at $29/month. These are marked "Individual use only", with separate business pricing — [Massive pricing](https://massive.com/pricing); [Massive KB](https://massive.com/knowledge-base/article/on-the-free-basic-plan-when-can-i-pull-the-previous-trading-days-data). **Pricing page and search summary conflict on the Starter tier; recheck.**
- **Tiingo:** the free Starter plan allows 50 requests/hour and 1,000/day, 500 unique symbols/month and 1 GB/month. It has 30+ years of price history and 5 years of fundamentals. Paid plans are $30/month or $300/year for individuals, and $50/month or $499/year for internal commercial use. Internal use means "you may not display or share the data with another person or organization"; redistribution is priced separately (checked 2026-11-17) — [Tiingo pricing](https://www.tiingo.com/about/pricing)
- **Twelve Data:** the free Basic plan has 8 credits/minute and 800/day, for "Internal non-display usage" only. Display rights start at the Grow plan, $79/month monthly (about 17% off yearly). The page's structured data says $29, which **conflicts** with the $79 shown (checked 2026-11-17) — [Twelve Data pricing](https://twelvedata.com/pricing)
- **EODHD:** the free Sandbox plan allows **20 calls/day** (plus a one-time 500-call bonus), 1 year of history, 15-minute delay and no fundamentals. The EOD All-World plan is $19.99/month or $199/year for 100k calls/day and 30+ years of history. The Fundamentals feed is $59.99/month and excludes EOD prices. These are personal-plan prices; commercial and B2B plans are separate (checked 2026-11-17) — [EODHD pricing](https://eodhd.com/pricing)

### Inferences
- For a public web demo, the official free tiers (Tiingo, Twelve Data, Finnhub, Massive) all restrict display or redistribution. Yahoo's terms (not fetched this session) are generally understood to bar commercial use and redistribution of scraped data. yfinance is acceptable for local development but is a licensing and reliability risk for a public demo.
- Beta needs about 2–5 years of weekly or monthly returns plus an index (SPY or ^GSPC). Free sources that cover that: Tiingo (30+ years), Massive Basic (only 2 years, too short for a 5-year monthly beta), and yfinance. An alternative is Damodaran's industry betas (bottom-up beta), which avoids needing per-company price history.
- Market cap = EDGAR `dei:EntityCommonStockSharesOutstanding` (or the latest 10-Q cover) × latest close. This keeps the share count licence-free and leaves only the price to license.

### Gaps
- **Nasdaq Data Link** free tier and current status were not researched (budget). From prior knowledge, the free WIKI prices dataset stopped updating in 2018; verify current offerings.
- Finnhub's official page did not render; the 60/minute figure is secondhand.
- Yahoo Finance ToS text was not fetched.
- FMP's official prices could not be fetched (403).

## Rates and macro: FRED API and US Treasury yield curve

### Takeaway
The FRED API (free key) provides DGS10 and corporate spread series. The Treasury's own XML/CSV feeds are a no-key, public-domain source for the yield curve. FRED's terms require an attribution notice, and third-party copyrighted series, notably ICE BofA corporate spreads, need the owner's permission beyond personal use.

### Cited Findings
- **FRED terms:** a registered API key is required. The Fed can cap bandwidth and transactions at its discretion. Apps may not replicate FRED's "essential user experience". Series whose notes contain "Copyright" are owned by third parties, and using them beyond personal use requires the owner's permission. Apps must display "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.", link to the Terms of Use, and must not use FRED names or logos in branding — [FRED API Terms of Use](https://fred.stlouisfed.org/docs/api/terms_of_use.html)
- **Treasury XML feed:** endpoint `/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=YYYYMM`. A CSV archive is also available (for example `par-yield-curve-rates-1990-2023.csv`). The R package `treasury` and the Python CLI `dailytreasuryrates` wrap it — [Treasury XML feed](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed); [Treasury CSV archive](https://home.treasury.gov/interest-rates-data-csv-archive); [PyPI dailytreasuryrates](https://www.pypi.org/project/dailytreasuryrates/)

### Inferences
- Use the Treasury feed for the risk-free rate in a public demo, since it is US government data with no third-party copyright, and FRED DGS10 as a convenience source. DGS10 is Board of Governors H.15 data and should not be copyrighted, but check the series notes.
- Credit spreads: FRED's ICE BofA OAS series (such as BAMLC0A4CBBB) carry an ICE copyright notice, so do not display them in a public demo without permission. A safer route is Damodaran's synthetic-rating spread table (see the next section) combined with interest coverage computed from EDGAR. Moody's Aaa/Baa yields on FRED should also be checked for copyright notes.

### Gaps
- FRED's numeric rate limit was not on the terms page. Widely cited as 120 requests/minute, but **unverified** this session.
- The ICE BofA copyright status was not re-verified on the FRED series pages this session.

## ERP, betas, cost of capital by industry: Damodaran (NYU Stern)

### Takeaway
Damodaran's datasets are free. They cover implied ERP (US), levered, unlevered and pure-play industry betas, cost of capital by industry, and rating-to-spread tables. The last full update was January 9, 2026, done once a year in early January. He welcomes use and sharing, but there is no formal licence, and the underlying raw data comes from commercial vendors. Use the derived figures with citation and do not bulk-mirror the spreadsheets.

### Cited Findings
- **Datasets:** implied ERP (two-stage augmented DDM), country risk premiums (Moody's ratings plus CDS), levered, unlevered and pure-play betas by industry, total betas, cost of equity, debt and capital by industry, and S&P rating classes with default spreads and typical interest coverage. Also tax rates, multiples, margins and more, split by US, Europe, Japan, emerging markets, Global and other regions — [Damodaran Current Data](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html)
- **Timing:** the last full update was **January 9, 2026** (country risk premiums January 5, 2026, with interim CRP updates in April and July). Updates run once a year in the first two weeks of January, using trailing-12-month data through Q3 of the prior year. Monthly implied-ERP updates are posted separately (from general knowledge, not on the fetched page) — same source
- **Terms:** no formal licence was found. In his own words, he asks only that users pass the sharing on, and he says he has "no desire to be a data service" (2024) — [Damodaran blog, Moneyball and investing data (2012)](https://aswathdamodaran.blogspot.com/2012/01/moneyball-and-investing-data.html?m=0); [Data Update 1 for 2024](https://aswathdamodaran.substack.com/p/data-update-1-for-2024-the-data-speaks). He asks for credit to KPMG for the marginal tax rate file — [Damodaran Current Data](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html)

### Inferences
- A safe approach for a public demo: cite "Source: Damodaran Online, NYU Stern (Jan 2026)", show only the few figures DealPilot uses (ERP, the industry unlevered beta, the spread for the synthetic rating), and link to his site rather than rehosting the files.
- Damodaran's industry groups (about 94 US industries) can serve as a free peer taxonomy, and he publishes a company-to-industry mapping file. This is based on prior knowledge and was not verified this session.

### Gaps
- The "About Data" page (sources, caveats, usage rules) returned 404 at the URL tried; its exact wording is unconfirmed. The raw data is believed to come from S&P Capital IQ, Bloomberg and similar vendors (prior knowledge, unverified).

## Peer selection: SIC codes and free alternatives to GICS

### Takeaway
SIC codes come free with EDGAR (submissions JSON, FTS hits and the Financial Statement Data Sets). They are coarse and dated, but legally clean. GICS is proprietary to S&P/MSCI. Free supplements are NAICS, Damodaran's industry groups, the Fama-French industry groupings of SIC codes, and text similarity of 10-K Item 1 business descriptions.

### Cited Findings
- The FTS JSON includes `sics` for each hit — [efts.sec.gov live query](https://efts.sec.gov/LATEST/search-index?q=%22goodwill%22&forms=10-K)
- The Financial Statement Data Sets include each filer's SIC — [SEC FS Data Sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets)
- The submissions API includes company metadata (names, tickers, exchanges) — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

### Inferences
- The submissions JSON also has `sic` and `sicDescription` fields (prior knowledge of the schema). Loading `submissions.zip` nightly gives a free SIC-to-company table covering all of EDGAR.
- A practical peer algorithm: same 4-digit SIC, falling back to 3- or 2-digit; then a size filter (market cap or revenue within 0.3–3x); then a check on business-description similarity. edgartools can extract Item 1 text, and an LLM or embeddings can compare it. An LLM-native product can lean on that last step.

### Gaps
- No primary sources were fetched on GICS licensing, Fama-French industry definitions, or the SEC's 2024–2025 SIC reassignments. All are prior knowledge.

## Consensus estimates: is there a free source?

### Takeaway
No free, licence-clean consensus source was found. Free tiers that mention estimates (Finnhub, FMP, Yahoo via yfinance) are restricted to personal or non-display use, or are scraped. For DealPilot, base projections on historical trends from EDGAR plus management guidance from 8-K earnings exhibits and the 10-K MD&A, and label them as such.

### Cited Findings
- Finnhub advertises "Estimates" among its APIs, but its free tier is non-commercial — [Finnhub pricing (title only)](https://finnhub.io/pricing); [apicostcalc Finnhub](https://apicostcalc.com/finnhub.html)
- edgartools parses 8-K items and earnings exhibits, and extracts 10-K and 10-Q sections. This is the raw material for guidance extraction — [PyPI: edgartools](https://pypi.org/project/edgartools/)
- 8-K item filtering is also available in EDGAR full-text search (the `items` field) — [efts.sec.gov live query](https://efts.sec.gov/LATEST/search-index?q=%22goodwill%22&forms=10-K)

### Inferences
- Recommended approach: (1) base case from 3–5-year historical CAGRs and margins out of companyfacts; (2) pull explicit guidance from the latest 8-K Item 2.02 Exhibit 99.1 and the MD&A with an LLM, quoting the source sentence; (3) cite the source of each assumption in the UI. If consensus is ever needed, it is a paid add-on (for example FMP or Finnhub paid tiers, with commercial-display licensing checked).

### Gaps
- Free-tier coverage of estimates for FMP and Finnhub was not verified on primary pages.

## Pitfalls: survivorship, restatements, fiscal-year alignment, share-count timing

### Takeaway
Most valuation errors come from timing. Share counts are dated at the cover page, fiscal years do not match calendar years, values get restated, and peer lists built from today's filers include only survivors.

### Cited Findings
- Frames assemble data from dates that only "best align" with calendar periods, so facts in one frame can have different start and end dates — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- Filings made after a quarter-end appear in the next quarterly FS Data Set release. The 2024 reprocessing changed the data to "as rendered" primary statements — [SEC FS Data Sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets)
- edgartools derives Q4 from the 10-K and computes TTM — [PyPI: edgartools](https://pypi.org/project/edgartools/)
- Massive Basic bars become available only after midnight ET — [Massive KB](https://massive.com/knowledge-base/article/on-the-free-basic-plan-when-can-i-pull-the-previous-trading-days-data)

### Inferences
- **Fiscal-year alignment:** for comps, compute LTM (TTM) from the latest 10-Q rather than comparing fiscal years. For forward multiples, calendarize. The `fy` field in companyfacts is the fiscal year of the filing, not of the period; use the period `end` date.
- **Restatements:** decide between point-in-time (first filed) and latest (last filed) values and stay consistent. For a valuation as of today, use latest.
- **Share-count timing:** use the cover-page share count (dei, dated near the filing date) for market cap, not period-end weighted-average shares. Add dilution from options and RSUs (treasury stock method) using the equity footnote, which is often in custom tags missing from the XBRL APIs. Watch for stock splits between the filing date and the price date.
- **Survivorship:** peer sets and historical betas built from currently listed tickers leave out delisted and acquired names. This matters for backtests more than for current comps.
- **Units and scale:** check `units` (USD vs USD-per-shares vs shares) and sign conventions in companyfacts.

### Gaps
- No primary sources were consulted specifically on XBRL restatement and duplicate-fact handling; the guidance above is practitioner inference.

## Recommended free data stack and cheap paid upgrade

### Takeaway
**Free stack:**
- **Fundamentals:** EDGAR (companyfacts and submissions bulk zips plus live JSON) via edgartools, with a server-side cache.
- **Share count:** dei facts from EDGAR.
- **Risk-free rate:** Treasury XML feed, with FRED DGS10 as backup.
- **ERP, industry betas, rating spreads:** Damodaran (Jan 2026).
- **Peers:** SIC from EDGAR plus 10-K text similarity.
- **Projections:** historicals plus guidance from 8-Ks.
- **Prices:** Tiingo free for development (1,000/day, 500 symbols/month, 30+ years). yfinance only as a local fallback.

**Cheapest paid upgrade for a public demo:** a plan with display rights. Candidates include EODHD EOD at $19.99/month, Tiingo at $30–50/month, Massive Starter at $29/month, or FMP Starter at about $22/month. Confirm in writing that showing prices on a public page is allowed, because most personal tiers forbid it.

### Cited Findings
- Tiingo free: 1,000 requests/day, 500 symbols/month, 30+ years of prices; internal use bars display; individual $30/month, commercial internal $50/month — [Tiingo pricing](https://www.tiingo.com/about/pricing)
- EODHD EOD All-World: $19.99/month, 100k calls/day, 30+ years; personal plan — [EODHD pricing](https://eodhd.com/pricing)
- Twelve Data display rights start at Grow, $79/month — [Twelve Data pricing](https://twelvedata.com/pricing)
- Massive Starter: $29/month (secondhand); Massive plans shown as "Individual use only" — [Massive pricing](https://massive.com/pricing)
- FMP Starter: about $22/month annual (secondhand) — [multiples.vc](https://multiples.vc/compare/fmp-api-alternatives)
- Alpha Vantage: $49.99/month for 75/minute — [Alpha Vantage Premium](https://www.alphavantage.co/premium/)

### Inferences
- For a public demo with zero licensing risk, show price and market cap only for a small curated set of tickers, add a "data delayed / for demonstration" notice, and buy the lowest tier that explicitly allows display. Most "personal" tiers do not, so the true cost of a public demo may be a commercial or B2B tier, often priced on request.
- Keep the EDGAR, Treasury and Damodaran parts free in production. Only market prices (and optionally consensus estimates) need to be paid for.

### Gaps
- None of the vendors' commercial or display-licence prices were visible on public pages (Tiingo redistribution, EODHD commercial, Massive business, Finnhub). They need sales contact.
