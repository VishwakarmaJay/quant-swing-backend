# Implementation Order

Strict sequence — each step verified before the next (minimal-mode build):

## Phase 1
1. Bun + TypeScript (strict) scaffold + Express skeleton + module dirs
2. config/default.yaml externalization + .env handling + Zod startup config validator skeleton
3. Redis + BullMQ setup: connection, queues, repeatable-job registration + in-process
   watchdog (schedule verification, inline dispatch fallback)
4. AngelOneClient: auth + TOTP (otplib) + token refresh   ← verify against LIVE credentials
5. InstrumentMasterService: download, cache, symbol→token map
6. PostgreSQL schema v1 (Prisma schema + init migration): instruments, ohlcv, signals(snapshot JSONB + versions)
7. DataQualityService: continuity + staleness validation
8. End-to-end proof: fetch + validate + persist 300-day history for 1 stock

## Phase 2
9. StockContext + FeatureBundle frozen value objects
10. TrendFactor → MomentumFactor → RelativeStrengthFactor → VolumeFactor → VolatilityFactor (each with unit tests)
11. FinBERT sidecar (FastAPI) + FinBertClient + normalizer + dedup → SentimentFactor
12. ScreenerClient + NSE XML → FundamentalFactor

## Phase 2.5
13. Golden dataset fixture + determinism test suite (CI-enforced)

## Phase 3
14. MarketRegimeService → WeightedStrategy (gates) → PortfolioManager → AlertFormatter → TelegramBotService → BullMQ repeatable jobs (cron schedules)

## Phase 4
15. BacktestEngine (as-of-date slicing) + TradeSimulator + BenchmarkService

## Phase 5–6
16. Paper trading + RiskMetricsDashboard + FactorPerformanceAnalyzer → evaluate → prune
