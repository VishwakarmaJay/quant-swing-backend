# Trading Rules

> ⚠️ **STALE SPEC — sizing & bands superseded.** The original spec used a **fixed ₹50-risk /
> ₹5,000-capital** model with a 3% SL cap. The as-built system uses **conviction-based sizing on
> ₹100,000 base capital** and a **0.5%–10% SL band**. The stop/target/exit *math* below is still
> accurate. [`../../SYSTEM.md`](../../SYSTEM.md) §6.3–§6.4 is authoritative; see
> [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) §3 for the drift table.

## Capital (config-driven, env vars — as-built values)
| Rule | Spec (original) | **As-built** |
|---|---|---|
| Base capital per trade | ₹5,000 | **₹100,000** (`PORTFOLIO_BASE_CAPITAL`) |
| Risk / sizing model | fixed ₹50 (1%) risk | **conviction-based**: capital = base × (composite/100) |
| Daily kill switch | ₹50 cumulative loss | **₹5,000** cumulative realized loss → zero new signals |
| Max open positions | 2 | 2 (`PORTFOLIO_MAX_OPEN_POSITIONS`) |
| Max per sector | 1 | 1 (`PORTFOLIO_MAX_PER_SECTOR`) |
| Max capital per trade | ₹3,000 (60%) | **no cap** (conviction sizing) |
| Min expected return | > 3× transaction cost | > 3× transaction cost (unchanged) |

## Stop Loss (ATR decides stop — decoupled from sizing)
```
atrPct = ATR14 / close × 100
atrPct < 1.5%  → SL_ATR = entry − 2.0 × ATR
atrPct ≥ 1.5%  → SL_ATR = entry − 1.5 × ATR
SL_SWING = min(low, 15 candles) × 0.997
FINAL SL = max(SL_ATR, SL_SWING)
Reject: SL% < 0.5% or > 10.0%     [AS-BUILT: upper band is 10%, not the spec's 3.0% — operator override]
```

## Size (conviction decides size — as-built)
```
allocatedCapital = baseCapitalPerTrade × (compositeScore / 100)   [AS-BUILT: replaces fixed-₹50-risk sizing]
qty              = floor(allocatedCapital / entry)                 [no ₹3,000 position cap]
atrPct 3–6% → qty × 0.75 ;  atrPct > 6% → REJECT
REJECT "sizing" if qty < 1
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
   *[AS-BUILT: the sentiment leg is inactive (no SentimentFactor); backtest omits it entirely — no historical sentiment.]*

## Soft flags (warn, don't block)
Results ≤ 7 days · pledge > 20% · < 3 articles · VIX > 18 · FII selling 3+ days
