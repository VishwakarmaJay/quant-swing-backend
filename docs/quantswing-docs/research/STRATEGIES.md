# Strategies

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
6. R:R ≥ 2.0 (post SL/target computation)
7. SentimentScore above config floor

### agreementScore
`1 − normalizedStdDev(factorScores)` — measures factor agreement, NOT calibrated
confidence. Recalibrate after 100+ logged outcomes.

## Future (interface drop-ins, evidence-gated)
MLStrategy · MomentumStrategy · MeanReversionStrategy · SectorRotationStrategy.
