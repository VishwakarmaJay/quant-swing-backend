# Modules

> ⚠️ **STALE SPEC — intended module map, not the as-built tree.** Modules marked *[not built]*
> below don't exist yet (Sentiment/Fundamental factors, the `analysis/` FinBERT stack, the
> intraday/pre-market scheduler jobs). The as-built scheduler is **RabbitMQ**-backed with 3 crons
> (08:00 sync, 16:30 OHLCV, 17:00 signal run). See [`../../SYSTEM.md`](../../SYSTEM.md) §1/§10 and
> [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) §3.

```
quantswing/
├── data-ingestion/     AngelOneClient, InstrumentMasterService
│                       [not built: NewsRssScraper, BseFilingsScraper, ScreenerClient]
├── quality/            DataQualityService
├── universe/           StockUniverseLoader, UniverseFilter
├── factors/            Factor interface + TrendFactor, MomentumFactor,
│                       RelativeStrengthFactor, VolumeFactor, VolatilityFactor
│                       [not built: SentimentFactor, FundamentalFactor]
├── strategy/           Strategy interface, WeightedStrategy
├── portfolio/          PortfolioManager, PositionSizer, KillSwitchService, PositionTracker
├── regime/             MarketRegimeService (trend + breadth + VIX)
├── analysis/           [NOT BUILT] FinBertClient, SentimentAggregator, ArticleDeduplicator,
│                       IndianFinanceNormalizer
├── scheduler/          [AS-BUILT: RabbitMQ crons — instrument sync, OHLCV update, nightly signal run]
│                       [not built: PreMarketJob, IntradayCheckJob]
├── measurement/        PerformanceLogger, RiskMetricsDashboard, FactorPerformanceAnalyzer,
│                       BenchmarkService
├── backtest/           BacktestEngine, TradeSimulator
├── delivery/           TelegramBotService, AlertFormatter
└── finbert-service/    [NOT BUILT] (separate Python project) FastAPI + HuggingFace, port 8001
```

## Dependency direction
delivery/measurement → portfolio → strategy → factors → quality → data-ingestion.
Nothing depends upward. Factors never import strategy or portfolio.

## Provider interfaces (data-ingestion)
OhlcvProvider · FundamentalProvider · NewsProvider · SentimentProvider —
all external data behind interfaces from Day 1; provider breaks → swap implementation only.
