# Modules

```
quantswing/
├── data-ingestion/     AngelOneClient, InstrumentMasterService,
│                       NewsRssScraper, BseFilingsScraper, ScreenerClient
├── quality/            DataQualityService
├── universe/           StockUniverseLoader, UniverseFilter
├── factors/            Factor interface + TrendFactor, MomentumFactor,
│                       RelativeStrengthFactor, VolumeFactor, VolatilityFactor,
│                       SentimentFactor, FundamentalFactor
├── strategy/           Strategy interface, WeightedStrategy
├── portfolio/          PortfolioManager, PositionSizer, KillSwitchService, PositionTracker
├── regime/             MarketRegimeService (trend + breadth + VIX)
├── analysis/           FinBertClient, SentimentAggregator, ArticleDeduplicator,
│                       IndianFinanceNormalizer
├── scheduler/          PreMarketJob, IntradayCheckJob, PostMarketAnalysisJob
│                       (BullMQ repeatable jobs, IST cron patterns)
├── measurement/        PerformanceLogger, RiskMetricsDashboard, FactorPerformanceAnalyzer,
│                       BenchmarkService
├── backtest/           BacktestEngine, TradeSimulator
├── delivery/           TelegramBotService, AlertFormatter
└── finbert-service/    (separate Python project) FastAPI + HuggingFace, port 8001
```

## Dependency direction
delivery/measurement → portfolio → strategy → factors → quality → data-ingestion.
Nothing depends upward. Factors never import strategy or portfolio.

## Provider interfaces (data-ingestion)
OhlcvProvider · FundamentalProvider · NewsProvider · SentimentProvider —
all external data behind interfaces from Day 1; provider breaks → swap implementation only.
