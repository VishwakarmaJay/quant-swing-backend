# Strategies

> ⚠️ **STALE SPEC — gate #6 superseded; composite is technical-only today.** The R:R gate is
> realized as **minResistanceRr = 1.5**, not the spec's 2.0. Because Sentiment/Fundamental
> factors are not built, their buckets renormalize out and **composite = technical score**;
> gate #7 (sentiment floor) is inactive until a SentimentFactor exists.
> [`../../SYSTEM.md`](../../SYSTEM.md) §6.2–§6.3 is authoritative;
> see [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) §3 for the drift table.

```typescript
interface Strategy {
  evaluate(factors: FeatureBundle, regime: MarketRegime): Signal;
}
```

## WeightedStrategy (v1, sole production strategy)
Regime-adaptive weighted composite + 7 hard gates.

### Weights (config-driven starting values — backtest-tuned)
| Regime | Technical | Sentiment | Fundamental |
|---|---|---|---|
| BULL | 0.50 | 0.30 | 0.20 |
| SIDEWAYS | 0.35 | 0.25 | 0.40 |
| HIGH_VOL | 0.40 | 0.45 | 0.15 |
| BEAR | 0.30 | 0.30 | 0.40 |

### Gates (ALL must pass)
1. CompositeScore ≥ threshold (base 65, regime-adjusted)
2. TechnicalScore ≥ 60
3. MACD bullish
4. Price above EMA20
5. RSI 35–68
6. R:R ≥ **1.5** to nearest resistance *[AS-BUILT: minResistanceRr = 1.5 in signal math, not the spec's 2.0]*
7. SentimentScore above config floor *[AS-BUILT: inactive — only enforced once a SentimentFactor exists]*

### agreementScore
`1 − normalizedStdDev(factorScores)` — measures factor agreement, NOT calibrated
confidence. Recalibrate after 100+ logged outcomes.

## Future (interface drop-ins, evidence-gated)
MLStrategy · MomentumStrategy · MeanReversionStrategy · SectorRotationStrategy.
