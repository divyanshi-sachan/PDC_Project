# FMP (Financial Modeling Prep) free plan: endpoints, limits, pricing, terms (state as of 2026-11-21)

Method note: every financialmodelingprep.com page (pricing, ToS, FAQ, docs) returned HTTP 403 to my fetch tool. No FMP primary page was read in full. FMP-owned content below comes only from web-search result summaries of FMP pages; the rest comes from third-party pages that say they transcribed or checked FMP's pricing page (Oct 28, Nov 3, Nov 6, 2026) and from GitHub PRs/issues in which developers probed a free key. Third-party pricing sites include competitors of FMP (Edgrapi, Narwhal), so treat them with caution. I did not call the FMP API.

## 1. Which endpoints on /stable are free vs paid (quote, profile, peers, market cap, shares, statements, screener, etc.)

### Takeaway
The free plan is NOT "any US company": the best evidence (a developer probe, one source) says about 39 endpoints, including quote, price history, statements, ratios, key-metrics, enterprise values and DCF, accept only a fixed list of about 87 symbols (e.g. AAPL, MSFT, NVDA, TSLA, SPY, AMZN); other US names such as ORCL and GME return HTTP 402. Profile works for any US-traded symbol. Batch quote, screener, intraday, news and calendars are reported as excluded. No official per-endpoint free/paid table was reachable, so most items in the requested list remain unconfirmed.

### Cited Findings
- 39 endpoints (quotes, prices, statements, ratios, key metrics, analyst data, dividends, earnings, DCF) accept only a fixed list of 87 stocks and ETFs plus some indices, FX pairs, crypto, commodities on a free key. Other symbols get HTTP 402 `premium_required`, even ORCL, PLUG, GME, QQQ. The list equals what the "All Shares Float" endpoint returns on a free key. The author says FMP does not publish these limits and that the PR corrected an earlier belief that free keys were "US-listed symbols." — [GitHub PR #15, Tradingview-data-grabber](https://github.com/themaainuser/Tradingview-data-grabber/pull/15) (third-party, single source, undated in my read)
- Same source: `profile` accepts any US-traded symbol including OTC but refuses non-US exchanges (SAP.DE, RY.TO). Calendars and All Shares Float do not refuse symbols but return only rows for the fixed list. — same PR #15
- Free-key row caps (`limit`): 5 rows for statements, key metrics, ratios, growth, enterprise values, owner earnings, dividends, earnings, splits; 10 for analyst estimates and historical grades; 1 for historical ratings; 20 for SEC filing searches; 100 for insider trades. — same PR #15
- Date windows: earnings/dividends/splits calendars, latest 8-K and financial filings, filings by form type, sector/industry snapshots limited to start dates within 30 days; SEC filings by symbol/CIK within a year; NOT limited: price history (AAPL back to 1985 reported), treasury rates, sector history, quarterly periods. — same PR #15
- Narwhal (competitor) lists as excluded on free: batch quotes, intraday charts, news, IPO and economic calendars, screener, transcripts, 13F, ETF holdings. Statements capped at 5 rows per call; profiles limited to US exchanges; SEC filings endpoints US-only, 20 rows, one page; economic indicators (24 US series) included but with no start date return only 3 months. Fixed symbol list described as "AAPL, TSLA, AMZN and 84 more" (87 total, consistent with PR #15). Checked 3 Nov 2026. — [Narwhal](https://narwhalapi.com/compare/financial-modeling-prep-review)
- Edgrapi (competitor, checked 6 Nov 2026): free plan includes EOD prices, company profiles, up to 5 years of annual statements for US companies; most datasets "Limited Coverage"; no 13F, transcripts, ETF holdings, bulk; roughly 83 companies' three statements per day (each statement is one call). Legacy APIs limited to existing paid customers; free and new plans use /stable/. — [Edgrapi](https://edgrapi.com/blog/financial-modeling-prep-api-pricing)
- /stable/quote rejects comma-separated symbols on non-legacy keys with HTTP 402 "Premium Query Parameter"; the old /api/v3/quote/A,B,C batch syntax returns 403 for keys created after 2025-08-31; fix was one symbol per call. A free-tier key evaluated 18 of 30 symbols (rest plan-gated or provider errors). — [GitHub PR #1, claude-trading-skills](https://github.com/fabbo-repo/claude-trading-skills/pull/1)
- A free plan answered /stable/profile?symbol=BRK.B with HTTP 402 "Premium Query Parameter ... not available under your current subscription" (staging report, marked unresolved). Contrast with PR #15 saying profile accepts any US symbol; so share-class symbols may be an exception. — [PerennialBackend PR #67](https://github.com/Perennial-asian-boiz/PerennialBackend/pull/67)
- "Restricted Endpoint" HTTP 402 (plain text) seen on batch-quote; fixed with per-symbol /quote fallback. Plan tier not stated. — [Stockpy PR #1094](https://github.com/kevinmarko/Stockpy/pull/1094) (from search snippet; page not read)
- Other 402s: grades/price-target "latest news" only page=0; calendars only ~last 12 months; EOD prices 402 "value set for 'symbol' is not available" for 47 non-US/OTC names. Plan tier not stated. — [StockHarness issue #291](https://github.com/bhajian/StockHarness/issues/291)
- FMP's own FAQ (via search summary) says some endpoints, such as earnings calendar and stock peers, are only available on paid subscriptions. — [FMP FAQ](https://site.financialmodelingprep.com/faqs) (page not readable by me; claim from search summary only)
- Basic card claims "150+ endpoints"; a different FMP page says 100+. — [Narwhal](https://narwhalapi.com/compare/financial-modeling-prep-review); [apis.io transcription of FMP pricing, 2026-10-28](https://apis.io/plans/financial-modeling-prep/financial-modeling-prep-plans-pricing/)

### Inferences
- For the DealPilot needs: price/quote, market cap, beta (via profile), sector/industry (profile) would work only for the ~87-symbol list, except profile (any US symbol, if PR #15 holds, but BRK.B-type tickers may 402). Peers (stock-peers) likely paid per FMP FAQ. Shares outstanding may be obtainable from profile/market-cap only for list symbols; shares-float is list-only.
- A public demo on arbitrary tickers is not feasible on the free key; it would be limited to ~87 symbols, one symbol per call, 250 calls/day, and (see section 4) display is not permitted without an agreement.

### Gaps
- Official per-endpoint table for: quote-short, aftermarket, stock-peers, market-capitalization (and historical), enterprise-values, key-metrics-ttm, company screener, treasury-rates, search-symbol/name, stock-list, available-exchanges, sector/industry lists, DCF, analyst estimates. Only partial third-party evidence above. The full 87-symbol list was not found.
- Whether batch endpoints (batch-quote, comma lists) are free: evidence says no (402), not from an official page.
- Whether anything changed on endpoint availability in 2025-2026 beyond the legacy v3 shutdown for post-2025-08-31 keys: not confirmed officially.

## 2. Rate limits, quotas, delay, history depth

### Takeaway
Free (Basic): 250 calls/day, 500 MB trailing-30-day bandwidth, end-of-day data, 5 years history, HTTP 429 when exceeded (resets next day). No per-minute cap was published for free in the sources I found.

### Cited Findings
- Free plan allows up to 250 API requests/day; bandwidth cap 500MB over a trailing 30 days (FMP wording "API usage has a trailing 30 days bandwidth limit of: Free plan - 500MB"), per search summary of FMP pages. — [FMP insights: public app/website](https://site.financialmodelingprep.com/insights/platform/can-you-use-fmp-data-in-a-public-app-website-or-client-dashboard) (via search summary)
- Exceeding limit returns 429; counter resets next day; FMP pricing table lists Basic as 250/day, 5-year history, end-of-day. — search summary of [FMP FAQ/pricing](https://site.financialmodelingprep.com/faqs)
- Pricing transcription dated 2026-10-28: Basic "250 Calls / Day", EOD historical, profile and reference data, 150+ endpoints. — [apis.io](https://apis.io/plans/financial-modeling-prep/financial-modeling-prep-plans-pricing/)
- Edgrapi (6 Nov 2026): Basic 5 years, US, EOD, no real-time; bandwidth Basic 500MB, Starter 20GB, Premium 50GB, Ultimate 150GB, Enterprise 1TB+; only Enterprise can pay to raise rate limits; no free trials; requests without a key or with "demo" key returned 401. — [Edgrapi](https://edgrapi.com/blog/financial-modeling-prep-api-pricing)
- Narwhal (3 Nov 2026): free = 250/day, 500MB/30 days, 5 years EOD, no real-time. — [Narwhal](https://narwhalapi.com/compare/financial-modeling-prep-review)
- Per PR #15, price history on the free key had no date limit (AAPL back to 1985), contradicting the "5 years" marketing figure. Narwhal also notes FMP pages claim "30+ years" while Basic/Starter stop at 5. — [PR #15](https://github.com/themaainuser/Tradingview-data-grabber/pull/15); [Narwhal](https://narwhalapi.com/compare/financial-modeling-prep-review)
- Legacy /api/v3 keys-after-2025-08-31 rejection (see section 1) is the one clear 2025 change found. — [claude-trading-skills PR #1](https://github.com/fabbo-repo/claude-trading-skills/pull/1)

### Inferences
- 250 calls/day with one symbol per call and 5 statement rows means roughly 80 companies/day of full statements (Edgrapi estimate) or 250 quotes/day; caching is mandatory.

### Gaps
- Official statement of a per-minute limit for Basic: not found.
- Whether the 250/day or 500MB figures changed in 2025-26: no change evidence found; no official changelog read.

## 3. Pricing tiers above free (as of Nov 2026)

### Takeaway
Starter $29/mo ($19/mo annual), Premium $69/mo ($49 annual), Ultimate $139/mo ($99 annual); Enterprise custom. Cheapest paid plan (Starter) = US coverage, 300 calls/min, 5 years history, annual fundamentals only, 20 GB bandwidth, realtime-capable, but still a "personal use" plan.

### Cited Findings
- Transcribed from FMP pricing page 2026-10-28: Starter $29/mo, 300 calls/min, up to 5 yrs history, US coverage, annual fundamentals and ratios, annual billing $19/mo (save 34%); Premium $69, 750/min, up to 30 yrs, UK and Canada, annual $49; Ultimate $139, 3,000/min, global, transcripts, 13F, bulk, annual $99. — [apis.io](https://apis.io/plans/financial-modeling-prep/financial-modeling-prep-plans-pricing/)
- Edgrapi 6 Nov 2026 matches: annual per-year $228 / $588 / $1,188; Enterprise custom and required for commercial use; real-time "Yes" from Starter; Ultimate 3,000/min flagged with an unexplained asterisk; Premium has ticker limits on some endpoints; dataset grid shows insider trades/SEC filings Limited on Basic, Full from Starter; statements "Limited" through Premium, Full on Ultimate (conflicts with Premium card "Full Fundamentals and Ratios"). — [Edgrapi](https://edgrapi.com/blog/financial-modeling-prep-api-pricing)
- Older/other figures: $22 / $59 / $149 (annual billing, checked 30 Jul 2026). Likely stale or from a different billing view. — [Qveris](https://qveris.ai/guides/financial-modeling-prep-api); conflict flagged in search summaries of older comparison pages
- Narwhal: Starter economic calendar limited to 1 year; Starter fundamentals annual only; 1-minute charts location contradictory across FMP cards. — [Narwhal](https://narwhalapi.com/compare/financial-modeling-prep-review)
- No free trial per FMP FAQ (via Edgrapi). — [Edgrapi](https://edgrapi.com/blog/financial-modeling-prep-api-pricing)

### Inferences
- Starter would remove the 87-symbol restriction for US companies (US coverage) — this is inferred from plan descriptions, NOT confirmed that all gated endpoints (e.g. stock-peers, screener) open on Starter.

### Gaps
- Official page not read directly; exact endpoint matrix per tier not obtained; whether stock-peers and screener are on Starter unconfirmed. Prices may have moved since 28 Oct-6 Nov 2026.

## 4. Terms of service for the free plan (display, redistribution, attribution)

### Takeaway
Free and personal plans do not allow showing FMP data on a public website or app. A separate Data Display and Licensing Agreement (Enterprise/commercial route) is needed, even for a free, non-monetized page. A public web demo showing FMP data is therefore outside the free-plan terms as published.

### Cited Findings
- ToS section 2.2.2 prohibits showcasing FMP Services or Data on websites, blogs, software products or applications without a specific agreement with FMP. — [FMP Terms of Service](https://site.financialmodelingprep.com/developer/docs/terms-of-service) (via search summary; page not readable)
- FMP's guidance: a free public page can still need a display agreement because the audience sees the data regardless of revenue; paying for an individual plan does not change this; attribution/citation is not a substitute for permission. — [FMP insights page](https://site.financialmodelingprep.com/insights/platform/can-you-use-fmp-data-in-a-public-app-website-or-client-dashboard) (via search summary)
- Commercial pricing page: displaying or redistributing FMP data requires a specific Data Display and Licensing Agreement. — [FMP pricing, commercial](https://site.financialmodelingprep.com/pricing-plans?planType=commercial) (via search summary)
- FMP says free plan is for evaluation even for commercial use cases. — same insights page via summary
- Personal plans cover one individual's non-business use; employee/contractor/BI use barred; multi-user site or app needs separate agreement; commercial access via Enterprise contact form, no published price; exchange data may carry extra fees. — [Narwhal](https://narwhalapi.com/compare/financial-modeling-prep-review)
- Enterprise includes display and redistribution rights, custom limits, 99.9% SLA, 1TB+ bandwidth; quote-only. Sales may offer sample data in lieu of a trial. — [Edgrapi](https://edgrapi.com/blog/financial-modeling-prep-api-pricing)
- No attribution requirement text was found; FMP guidance says to rely on ToS/signed agreement.

### Inferences
- A portfolio demo that is private/local (viewed only by the owner) is arguably within personal use; a public URL showing live FMP numbers is not, absent a display agreement. Safer designs: show only values computed from SEC EDGAR data, or put FMP calls behind the owner's own login, or request a display agreement / written permission.

### Gaps
- Exact ToS wording not read directly (403). Whether FMP grants non-commercial portfolio-project exceptions: no evidence found; would require contacting FMP.
