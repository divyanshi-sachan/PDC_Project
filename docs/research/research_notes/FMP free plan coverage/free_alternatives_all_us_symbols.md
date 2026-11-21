# Free market-data providers covering all US symbols (state as of 2026-11-21; no APIs were called)

Note: Several pricing pages were read through a summarising fetch tool; figures are as reported by that tool. Third-party and competitor pages (notably massive.com comparisons) are flagged. Finnhub's pricing page and docs did not render usable detail, so Finnhub endpoint-level free access is UNCONFIRMED from primary sources.

## Which free provider offers price, market cap, shares outstanding, beta and peers for any US ticker?

### Takeaway
Finnhub is the only provider where all five points plausibly sit on one free key (60 calls/min, US coverage), but endpoint-level free access to beta/market cap/shares is unverified and its terms are personal-use only, with a no-redistribution clause that makes a public demo a gray area. Practical best combo: Finnhub (or a cached snapshot) for price/beta/peers, SEC XBRL for shares, market cap computed as price x SEC shares.

### Cited Findings
- Finnhub free: 60 calls/min, US coverage, WebSocket 50 symbols; stock candles are premium (403 on free key) — [Massive vs Finnhub (competitor page)](https://massive.com/compare/massive-vs-finnhub.md). One source says 50 calls/min — [IBKR Campus](https://www.interactivebrokers.com/campus/ibkr-quant-news/exploring-the-finnhub-io-api/) (conflict; 60 is more widely repeated).
- Finnhub /stock/profile2, /stock/peers, /stock/metric are marked free in a community endpoint table (third-party, not authoritative) — [skills.sh finnhub-api](https://skills.sh/adaptationio/skrillz/finnhub-api). A Composio doc says the free tier returns only the last four quarters for metric series — [Composio](https://docs.composio.dev/toolkits/finnhub.md). Peers are described as same country and sector/industry — [docs.rs finnhub client](https://docs.rs/crate/finnhub/0.2.2/source/src/endpoints/stock/company.rs).
- Finnhub terms: "All plan listed on Finnhub website is strictly for personal use unless explicitly stated otherwise"; no redistribution or sharing of "data or derived results" with third parties without written approval; terms do not specifically address website display; data must be deleted when subscription ends — [Finnhub terms](https://finnhub.io/terms-of-service) (read via summarising tool). Competitor claim that showing data to customers requires Enterprise — [Massive vs Finnhub](https://massive.com/compare/massive-vs-finnhub).
- Twelve Data Basic (free): 8 credits/min, 800/day, real-time US equities/ETFs incl. reference data and market data, but NO fundamentals (profile, statistics) on Basic — [Twelve Data pricing](https://twelvedata.com/pricing). So price only; no market cap/beta/peers from free.
- Alpha Vantage free: 25 requests/day (no per-minute limit stated); premium from 75 req/min at 49.99/month — [Alpha Vantage premium](https://www.alphavantage.co/premium/). Quote endpoint updates end of day for free users; realtime and 15-min delayed US quotes need premium — [AV docs](https://www.alphavantage.co/documentation/). OVERVIEW fields (MarketCapitalization, SharesOutstanding, Beta, Sector) could NOT be verified from the docs I could read (page truncated); OVERVIEW is stocks-only and returns strings — [Macroption](https://www.macroption.com/alpha-vantage-company-overview/). Terms: licence for "personal, non-commercial use"; "commercial use" triggers listed in the terms PDF (I only extracted fragments) — [AV terms](https://www.alphavantage.co/terms_of_service/).
- Massive (ex-Polygon.io) free plan: end-of-day, 2 years history, 5 calls/min — [Massive vs Finnhub (competitor page)](https://massive.com/compare/massive-vs-finnhub.md), [Massive KB](https://massive.com/knowledge-base/article/on-the-free-basic-plan-when-can-i-pull-the-previous-trading-days-data). Previous trading day's bars available only after midnight ET; current day returns 403; 15-min delay starts at paid Starter. Ticker details (reference data) reportedly included for all US tickers (third-party guide, unconfirmed whether market cap/shares fields are free) — [search result summary of quantt.co.uk / qveris](https://www.quantt.co.uk/resources/polygon-api-tutorial). Pricing page lists paid plans as "Individual use only" — [Massive pricing](https://massive.com/pricing). Rebrand: api.polygon.io still works alongside api.massive.com (third-party summary).
- Tiingo free (Starter): 500 unique symbols/month, 50 req/hour, 1,000 req/day, 1 GB/month; licence "Internal Use Only", i.e. personal use, may not display or share; fundamentals are an add-on, free/evaluation covers DOW 30 only, 3 years — [Tiingo pricing](https://www.tiingo.com/about/pricing), [Tiingo fundamentals search result](https://api.tiingo.com/products/fundamental-data-api). IEX feed has a 15 ms delay requirement — [Tiingo IEX docs](https://api.tiingo.com/docs/iex/realtime). Free tier does not give market cap/beta/peers.
- EODHD free: 20 calls/day (+500 one-time bonus), 20 req/min, 1 year EOD history, 15-min delayed live data, no fundamentals — [EODHD pricing](https://eodhd.com/pricing). Personal-use terms forbid showing data to anyone else, including a free public website — [EODHD personal use](https://eodhd.com/help/personal-use) (page covers personal plans; may apply to free).
- Stooq: CSV download now requires an apikey obtained via CAPTCHA, with a daily hit limit ("Exceeded the daily hits limit") — secondary sources only: [pandas-datareader issue 1012](https://github.com/pydata/pandas-datareader/issues/1012), [Qiita](https://qiita.com/katafuchix/items/c74793e5041e1b5e3051). Price only, no market cap/beta/peers; terms not found.
- yfinance/Yahoo: unofficial scraping; project says Yahoo API is "intended for personal use only"; Apache licence covers code not data; HTTP 429 reports in 2025-2026; Yahoo publishes no limits — [Massive vs yfinance (competitor)](https://massive.com/compare/massive-vs-yfinance), [yfinance issue 2480](https://github.com/ranaroussi/yfinance/issues/2480), [discussion 2431](https://github.com/ranaroussi/yfinance/discussions/2431). Yahoo itself provides all five points (price, marketCap, sharesOutstanding, beta via quoteSummary; recommendations/similar symbols) — general knowledge, unsourced here.
- IEX Cloud: retired 31 Aug 2024 (announced 31 May 2024); ex-staff bought assets and relaunched from scratch, current status unconfirmed — [Alpha Vantage analysis](https://www.alphavantage.co/iexcloud_shutdown_analysis_and_migration/), [Waters Technology](https://waterstechnology.com/trading-tech/7951983/facing-platform-shutdown-former-iex-cloud-head-buys-its-assets-in-11th-hour-bid).
- Marketstack: free plan 100 requests/month, EOD only, 12 months history, no support; some older pages say 1,000/month — [Marketstack pricing](https://marketstack.com/pricing). Not viable.
- SEC: dei:EntityCommonStockSharesOutstanding is on the filing cover page via XBRL; no prices (general knowledge, already in project's EDGAR pipeline; not re-sourced). FRED/Treasury: rates only (not researched; general knowledge).

### Inferences
- Only Finnhub appears to cover all five fields on free; all other free tiers lack market cap/beta/peers (Twelve Data, Tiingo, EODHD explicitly exclude fundamentals; Massive/Alpha Vantage unconfirmed).
- Cheapest robust design: shares from SEC (dei cover page), price from one free source, market cap = price x shares in packages/finance, beta/peers from Finnhub with caching. This minimises dependence on any single provider's tier changes.
- Display terms: virtually every free tier is personal/internal use. A public demo is risky with Finnhub, Tiingo, EODHD, Alpha Vantage. Mitigation: label as demo, cache, show only derived/delayed figures, or contact providers.
- Twelve Data Basic (800 credits/day, real-time US prices) is the best price-only free option for volume; its terms for public display were not retrieved.

### Gaps
- Finnhub: official confirmation that beta, marketCapitalization, shareOutstanding, /stock/peers work on the free key; whether US /quote is real-time on free. Pricing page content not retrievable.
- Alpha Vantage OVERVIEW field list; full commercial-use definition in terms PDF.
- Massive ticker details market_cap and share fields on free; free-tier terms.
- Twelve Data, Tiingo (full terms), Stooq terms on public display; Yahoo's own ToS text.
- Whether relaunched IEX Cloud operates; FRED details.

## Reliability and risk notes

### Takeaway
Free tiers are small and shifting; unofficial scraping (yfinance, Stooq CSV) is the most fragile; cache aggressively.

### Cited Findings
- Alpha Vantage cut to 25 requests/day (current page) — [AV premium](https://www.alphavantage.co/premium/); older 500/day figures are in many third-party articles (from general knowledge; not sourced here).
- Marketstack older pages list 1,000/month vs official 100 — [Marketstack pricing](https://marketstack.com/pricing).
- IEX Cloud shutdown with three months notice — see above.
- Yahoo 429 blocking reports — see above.

### Inferences
- Store results in Neon with TTLs and design a provider abstraction so a tier change swaps one adapter.

### Gaps
- No dated changelog of 2025-2026 free-tier removals was found for Finnhub or Twelve Data.
