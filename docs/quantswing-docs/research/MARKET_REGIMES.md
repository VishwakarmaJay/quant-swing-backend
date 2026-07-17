# Market Regimes

Detected 08:45 and 16:00 IST by MarketRegimeService. Stored in every signal snapshot.

## Inputs
- Nifty 50 vs its 200 EMA
- Breadth 1: % of universe above EMA50
- Breadth 2: new 52-week highs vs new 52-week lows (leading deterioration signal)
- India VIX
- Day change / circuit status

## Regimes → behavior
| Regime | Detection | Behavior |
|---|---|---|
| BULL | Nifty > EMA200 AND breadth > 55% AND VIX < 15 | Base threshold, full size |
| SIDEWAYS | Nifty ±1% of EMA200 or VIX 15–20 | Threshold +5, size × 0.75 |
| BEAR | Nifty < EMA200, breadth < 35%, VIX > 20 | Defensive sectors only, threshold +10, size × 0.5 |
| CRASH | Δ < −3% or VIX > 30 or circuit | **No BUY signals. Exit checks only.** |

## Regime-adaptive strategy weights
See research/STRATEGIES.md. All thresholds/multipliers in configuration.
