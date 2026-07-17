# Performance Guide

## Budgets
| Path | Budget | Mechanism |
|---|---|---|
| Nightly deep run (150 stocks) | < 10 min | see below |
| OHLCV incremental fetch | ~50s | BullMQ queue limiter 3 req/sec (+ per-minute cap guard) |
| FinBERT 1,500 articles | < 3 min | batch POST (not per-article); CPU ok |
| Factor evaluation, full universe | < 30s | in-memory TS indicator math; executionTimeMs metric per factor |
| Intraday check | < 30s | open positions only (≤2) |

## Rules
- // PERF: instrument master loaded once at startup into a Map — never per request
- // PERF: fundamentals 24hr Redis cache — quarterly data, zero daily fetches
- // PERF: never refetch OHLCV history — incremental single-candle append only
- // PERF: Jaccard dedup on ~1,500 titles is trivial; MinHash only if volume 10×
- Async I/O (bounded Promise concurrency) for provider fan-out; the BullMQ limiter is the ceiling, not concurrency count

## Watch items
- FinBERT cold start (~30s model load) → warm at app start via its /health
- JSONB snapshot growth → partial index on created_at; archive > 2yr if needed
- // SCALE LIMIT: universe 500+ stocks pushes OHLCV fetch past 3 min — needs request batching or paid feed
