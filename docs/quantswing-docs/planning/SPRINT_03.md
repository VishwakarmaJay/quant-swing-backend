# Sprint 03 — Sentiment + Fundamentals (Phase 2b + 2.5)

**Goal:** All 7 factors live; golden dataset locked.

## Scope
- [ ] FinBERT FastAPI sidecar (Dockerfile, /score endpoint, batch input)
- [ ] FinBertClient (5s timeout, 2 retries, degraded-neutral fallback)
- [ ] IndianFinanceNormalizer + hard overrides table
- [ ] NewsRssScraper (4 sources) + ArticleDeduplicator (normalize + Jaccard 0.7)
- [ ] SentimentAggregator (recency weighting, chase-penalty decay)
- [ ] ScreenerClient + NSE XML → FundamentalFactor (24hr cache)
- [ ] Golden dataset: 15 stocks × fixed dates, committed fixtures
- [ ] Determinism suite in CI (byte-identical FactorResult)

## Exit criteria
M3. FinBERT-down scenario tested (pipeline completes, degraded flag set).
