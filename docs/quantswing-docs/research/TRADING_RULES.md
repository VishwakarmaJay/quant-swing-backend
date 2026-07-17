# Trading Rules

## Capital (config-driven, current values)
| Rule | Value |
|---|---|
| Capital | ₹5,000 |
| Max risk per trade | ₹50 (1%) |
| Daily kill switch | ₹50 cumulative loss → zero new signals |
| Max open positions | 2 |
| Max per sector | 1 |
| Max capital per trade | ₹3,000 (60%) |
| Min expected return | > 3× transaction cost |

## Stop Loss (ATR decides stop — decoupled from sizing)
```
atrPct = ATR14 / close × 100
atrPct < 1.5%  → SL_ATR = entry − 2.0 × ATR
atrPct ≥ 1.5%  → SL_ATR = entry − 1.5 × ATR
SL_SWING = min(low, 15 candles) × 0.997
FINAL SL = max(SL_ATR, SL_SWING)
Reject: SL% < 0.5% or > 3.0%
```

## Size (volatility decides size)
```
qty = floor(₹50 / (entry − SL)); cap at ₹3,000 position value
atrPct 3–6% → size × 0.75 ;  atrPct > 6% → REJECT
```

## Entry
```
entryLow = signal × 0.995 · entryHigh = signal × 1.005
Opens above entryHigh → SKIP
```

## Targets
```
target1 = entry + 2.0×risk ; target2 = entry + 3.0×risk
Nearest resistance (60-candle pivot) reconciled; R:R < 1.5 to resistance → REJECT
```

## Exits (5 triggers)
1. SL hit → full exit next open
2. Target1 → exit 50%, SL → breakeven
3. Target2 → exit remainder
4. Time stop: 7 calendar days
5. Thesis broken: 2 closes < EMA20 · MACD flip · sentiment < −0.5 → review alert

## Soft flags (warn, don't block)
Results ≤ 7 days · pledge > 20% · < 3 articles · VIX > 18 · FII selling 3+ days
