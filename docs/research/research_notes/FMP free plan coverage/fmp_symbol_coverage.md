# FMP free plan (Basic) symbol coverage, as of 2026-11-21

Evidence labels: [DOC] = FMP official page (seen only via search-result summaries; direct fetches of site.financialmodelingprep.com returned HTTP 403), [3P] = third-party page, [PROBE] = our own live calls on 2026-11-21 (68 calls, free key, stable API).

## What symbols does the free plan serve, and why?

### Takeaway
Free coverage is best explained as a fixed, arbitrary allow-list of about 87 symbols that is enforced per endpoint (not market cap, exchange, sector, index membership or alphabet). FMP publishes the count but not the list, and no free endpoint enumerates it. Confidence: moderate-high that it is a fixed list (the probe pattern is non-monotonic on every natural axis); low on the exact membership.

### Cited Findings
- FMP's personal-use pricing table shows Basic with per-endpoint symbol limits phrased "Symbol: AAPL, TSLA, AMZN (+84 more)", i.e. 87 symbols, e.g. on Cash Flow Statement (limit 5 results) [DOC, per search summary] — [FMP pricing-md](https://site.financialmodelingprep.com/api/pricing-md)
- The Company Symbols List and Financial Statement Symbols List are "Not available" on Basic; Starter is limited to US exchanges, Premium to US/UK/Canada, only Ultimate has full global coverage [DOC, per search summary] — [FMP pricing-md](https://site.financialmodelingprep.com/api/pricing-md)
- Basic: 250 calls/day, 150+ endpoints, EOD historical plus profile/reference data [3P] — [apis.io plan summary](https://apis.io/plans/financialmodelingprep/financialmodelingprep-plans-pricing/). A 500 MB 30-day bandwidth limit also appears on the FMP pricing page [DOC, per search summary, not verified].
- FMP's FAQ says some endpoints (earnings calendar, stock peers, "and many others") are paid-only [DOC, per search summary] — [FMP FAQ](https://site.financialmodelingprep.com/it/faqs). Our probe contradicts this for stock-peers on allow-listed symbols (user-observed 200).
- FMP has an insights article titled "Why an FMP Endpoint May Work for One Symbol but Not Another"; I could not read it (403) — [link](https://site.financialmodelingprep.com/insights/platform/why-an-fmp-endpoint-may-work-for-one-symbol-but-not-another)
- Probe, `/stable/quote?symbol=X`, 45 tickers [PROBE]: 29 returned 200, 16 returned 402 (table below). Together with the 8 known-good (AAPL MSFT GOOGL AMZN META NVDA INTC CSCO) that is 37 accepted tickers, consistent with a list of 87.
- 402 body text starts "Premium Query Parameter: 'Special Endpoint : This value set for 'symbol' is not ..." (first 80 chars) [PROBE]
- Hypothesis tests [PROBE]: market cap fails (rejected AVGO, ORCL, HD, IBM, CRM, QCOM are larger than accepted F, GM, ROKU, ETSY, SNAP, SHOP); exchange fails (ADRs TSM, BABA, SONY, SHOP accepted but NVO rejected; NYSE and NASDAQ names on both sides); sector fails (tech split: AMD/ADBE ok, AVGO/TXN/MU/ORCL/CRM/IBM rejected; industrials BA/GE ok, CAT rejected); alphabetical fails. Share class BRK-B rejected (BRK-B might simply not be on the list or fail on formatting; not tested with BRK.B).
- I found no Reddit/StackOverflow/GitHub/forum post explaining which symbols are on the list; searches returned only FMP's own pages and an unrelated provider's 402 guide.

### Inferences
- The 87-symbol list looks hand-picked (mix of mega caps, popular retail names such as F, GM, ROKU, SNAP, PLUG-excluded). A "popular tickers" list is the likeliest origin, but that is unverified.
- DELL/HPQ/QCOM being premium while MSFT/INTC/CSCO are not has no principled explanation beyond list membership.

### Gaps
- Official list of the 87 symbols: not found. An enumerating free endpoint does not exist (see below).
- Date when the "87 symbols" rule started: not found.

## Does the restriction apply equally across endpoints?

### Takeaway
No. The `/profile` endpoint served the three quote-rejected symbols (HPQ, DELL, QCOM), whereas market-cap, shares-float, key-metrics-ttm, ratios-ttm, EOD price and income-statement all returned 402 for them. So profile is the only tested endpoint with open symbol coverage.

### Cited Findings
- `/profile` for HPQ, DELL, QCOM: 200, 1 row each [PROBE]. `/market-capitalization`, `/shares-float`, `/key-metrics-ttm`, `/ratios-ttm`, `/historical-price-eod/light`, `/income-statement?limit=1`: 402 for all three [PROBE].
- Pricing table shows other endpoints (cash flow, 10-K JSON, financial scores) limited to the same fixed set on Basic [DOC, per search summary] — [FMP pricing-md](https://site.financialmodelingprep.com/api/pricing-md)

### Inferences
- Profile probably contains price and marketCap fields (not inspected in this probe), so shares outstanding could be derived as marketCap / price for any ticker; this derived figure would be an approximation and has not been verified. For allow-listed tickers, shares-float is the direct source. For rejected tickers, the reliable free source of shares outstanding is SEC EDGAR (dei:EntityCommonStockSharesOutstanding via services/edgar), which matches the repo's provenance rules.

### Gaps
- Profile field contents were not checked; stock-peers, balance-sheet, cash-flow were not probed on rejected symbols (call budget).

## Does batch-quote bypass or reveal the restriction?

### Takeaway
No. `/batch-quote?symbols=HPQ,DELL,MSFT` returned 402 with a "Restricted Endpoint" message, i.e. the endpoint itself is not on the free plan, so it neither bypasses nor reveals anything.

### Cited Findings
- batch-quote: 402 "Restricted Endpoint: This endpoint is not available under your current subscript..." [PROBE]
- Enumerators [PROBE]: `/available-exchanges` 402 (Restricted Endpoint); `/stock-list` 402 (Restricted Endpoint); `/available-traded/list` 404 with body `[]` (path likely wrong or unavailable). Note the message differs: "Restricted Endpoint" (whole endpoint) vs "Premium Query Parameter" (this symbol value).

### Inferences
- Two distinct 402 types let code distinguish "endpoint not on plan" from "symbol not on plan". Unknown tickers also return the symbol-type 402 on quote (user-observed), so a 402 cannot separate "bad ticker" from "not allowed"; use profile (200 + empty array for unknown) to tell them apart.

### Gaps
- Multi-symbol quote with comma list on `/quote` was not tested.

## Probe results (2026-11-21, `/stable/quote?symbol=`)

| Symbol | Status | Symbol | Status |
|---|---|---|---|
| TSLA | 200 | NKE | 200 |
| BRK-B | 402 | DIS | 200 |
| JPM | 200 | CAT | 402 |
| V | 200 | BA | 200 |
| WMT | 200 | GE | 200 |
| HPQ | 402 | F | 200 |
| DELL | 402 | GM | 200 |
| QCOM | 402 | T | 200 |
| KO | 200 | VZ | 200 |
| PEP | 200 | IBM | 402 |
| XOM | 200 | ORCL | 402 |
| CVX | 200 | CRM | 402 |
| PFE | 200 | ADBE | 200 |
| JNJ | 200 | AMD | 200 |
| UNH | 200 | AVGO | 402 |
| HD | 402 | TXN | 402 |
| MU | 402 | ROKU | 200 |
| ETSY | 200 | PLUG | 402 |
| GPRO | 402 | SNAP | 200 |
| TSM | 200 | BABA | 200 |
| NVO | 402 | SHOP | 200 |
| SONY | 200 | | |

Previously known (user, not re-probed): 200 for AAPL MSFT GOOGL AMZN META NVDA INTC CSCO; 402 for ZZZZZZ NOSUCHTICKER XYZQ.

Other endpoints for HPQ / DELL / QCOM (identical for all three):

| Endpoint | Status |
|---|---|
| /profile | 200 (1 row) |
| /market-capitalization | 402 |
| /shares-float | 402 |
| /key-metrics-ttm | 402 |
| /ratios-ttm | 402 |
| /historical-price-eod/light | 402 |
| /income-statement?limit=1 | 402 |
| /batch-quote?symbols=HPQ,DELL,MSFT | 402 (Restricted Endpoint) |
| /available-exchanges | 402 (Restricted Endpoint) |
| /stock-list | 402 (Restricted Endpoint) |
| /available-traded/list | 404 (`[]`) |

Practical implications for DealPilot: do not rely on FMP free for arbitrary tickers; treat 402 "Premium Query Parameter" as "symbol not entitled" and fall back to EDGAR; FMP's allow-list could be discovered only by trial calls (costly vs the 250/day quota).
