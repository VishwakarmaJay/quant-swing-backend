# Factor Catalog

Status: `active` | `testing` | `retired`. Retired factors keep post-mortems.

| Factor | Category | Definition | Status |
|---|---|---|---|
| TrendFactor | TREND | EMA 20/50/200 stack alignment; price vs stack | active (H-0) |
| MomentumFactor | MOMENTUM | MACD state + RSI 35–68 band, combined score | active (H-0) |
| RelativeStrengthFactor | RS | 20d return vs sector index and vs Nifty | active (H-0) |
| VolumeFactor | VOLUME | Today vs 20D avg volume ratio | active (H-0) |
| VolatilityFactor | VOLATILITY | ATR14/close percentile; drives stop distance + size multiplier | active (H-0) |
| SentimentFactor | SENTIMENT | FinBERT aggregate, recency-weighted, dedup, chase-decay | active (H-0) |
| FundamentalFactor | FUNDAMENTAL | PE vs sector, EPS trend, promoter/pledge, results proximity | active (H-0) |
| SectorRotation | RS | Continuous [−1,+1] taper over 11 sector momentum ranks | active (H-0) |
| DeliveryPctFactor | VOLUME | NSE bhavcopy delivery % (institutional proxy) | proposed (v1.5) |

All output scales normalized before strategy weighting. Every factor emits
explanations + metrics + executionTime (see project/ARCHITECTURE.md contracts).
