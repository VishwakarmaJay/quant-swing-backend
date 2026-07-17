# Sprint 02 — Price Factors (Phase 2a)

**Goal:** Five technical-dimension factors, deterministic, unit-tested.

## Scope
- [ ] StockContext + FeatureBundle immutable (frozen) value objects
- [ ] Indicator library wrapper (indicatorts — verify vs in-house at sprint start)
- [ ] TrendFactor (EMA 20/50/200 stack)
- [ ] MomentumFactor (MACD + RSI combined)
- [ ] RelativeStrengthFactor (20d vs sector index vs Nifty)
- [ ] VolumeFactor (vs 20D avg)
- [ ] VolatilityFactor (ATR percentile; feeds stop + size rules)
- [ ] Sector index OHLCV ingestion (11 indices)
- [ ] Full-universe ingestion job (M2)

## Exit criteria
All 5 factors emit FactorResult with explanations + executionTime; unit tests cover
boundary conditions (flat series, gaps, exactly-200-candle history).
