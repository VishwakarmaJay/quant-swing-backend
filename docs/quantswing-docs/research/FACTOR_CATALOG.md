# Factor Catalog

> ⚠️ **STALE SPEC — partially superseded.** This is the original frozen spec; the `Status`
> column below reflects the *intended* catalog, not what exists. **As-built, only 4 technical
> factors + Volatility are implemented** — Sentiment, Fundamental, and SectorRotation are **not
> built**, so their strategy weight-buckets renormalize out (composite = technical score today).
> [`../../SYSTEM.md`](../../SYSTEM.md) §4 is authoritative for the factors that actually exist.
> See [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) §3 for the full drift table.

Status: `active` | `testing` | `retired` | `not built`. Retired factors keep post-mortems.

| Factor | Category | Definition | Status (as-built) |
|---|---|---|---|
| TrendFactor | TREND | EMA 20/50/200 stack alignment; price vs stack | ✅ active |
| MomentumFactor | MOMENTUM | MACD state + RSI, combined score (the RSI 35–68 band is a *strategy gate*, not in this factor) | ✅ active |
| RelativeStrengthFactor | RS | Return vs Nifty over 60d **[AS-BUILT: vs-Nifty only; the "vs sector index" half is not built]** | ✅ active (vs-Nifty only) |
| VolumeFactor | VOLUME | Recent (5D) vs 20D avg volume ratio, amplifies price direction | ✅ active |
| VolatilityFactor | VOLATILITY | ATR14/close; feeds stop distance + the portfolio ATR-band size reduction (not a continuous "size multiplier") | ✅ active |
| SentimentFactor | SENTIMENT | FinBERT aggregate, recency-weighted, dedup, chase-decay | ⛔ **not built** (planned) |
| FundamentalFactor | FUNDAMENTAL | PE vs sector, EPS trend, promoter/pledge, results proximity | ⛔ **not built** (planned) |
| SectorRotation | RS | Continuous [−1,+1] taper over 11 sector momentum ranks | ⛔ **not built** (planned) |
| DeliveryPctFactor | VOLUME | NSE bhavcopy delivery % (institutional proxy) | proposed (v1.5) |

All output scales normalized before strategy weighting. Every factor emits
explanations + metrics + executionTime (see project/ARCHITECTURE.md contracts).
