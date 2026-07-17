# Market Regimes

> ⚠️ **STALE SPEC — the as-built regime logic is simpler.** No 52-week hi/lo breadth, no
> `VIX < 15` requirement for BULL, no per-regime **size multipliers**, and no "defensive
> sectors only" behavior. Regime is computed as of `asOf` at the **17:00 nightly run** (not
> 08:45/16:00), VIX is proxied by Nifty ATR% when no feed is wired, and per-regime tuning is a
> **threshold adjustment only** (HIGH_VOL +5, BEAR +10). [`../../SYSTEM.md`](../../SYSTEM.md)
> §6.1 is authoritative; see [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) §3.

## Inputs (as-built)
- Nifty 50 vs its 200 EMA
- Breadth: % of universe with close > EMA50
- India VIX *(optional — Nifty ATR% proxy when absent)*
- Day change (1-day Nifty return) for the crash check
- ~~Breadth 2: 52-week highs vs lows~~ *[not implemented]*

## Regimes → behavior *(as-built; priority order: CRASH → HIGH_VOL → trend+breadth)*
| Regime | Detection (as-built) | Behavior |
|---|---|---|
| CRASH | return1d ≤ −3% **OR** VIX ≥ 30 | **No BUY signals. Exit checks only.** |
| HIGH_VOL | VIX ≥ 20 **OR** (no VIX AND niftyAtrPct ≥ 2%) | Threshold +5 |
| BULL | Nifty > EMA200 **AND** breadth ≥ 55% | Base threshold |
| BEAR | Nifty < EMA200 **AND** breadth ≤ 40% | Threshold +10 |
| SIDEWAYS | otherwise | Base threshold |

*[AS-BUILT: threshold adjustments only — there are no `size × 0.75 / × 0.5` regime multipliers,
no `VIX < 15` gate on BULL, and no defensive-sector restriction. Bear breadth cutoff is 40%,
not the spec's 35%.]*

## Regime-adaptive strategy weights
See research/STRATEGIES.md. All thresholds in configuration. *(Note: the weight matrix exists,
but with only the technical bucket present today it renormalizes to composite = technical score.)*
