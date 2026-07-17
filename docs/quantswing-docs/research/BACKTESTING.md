# Backtesting

## Engine rules
- Strict as-of-date data slicing — **no lookahead**. The #1 backtest bug.
- Entry simulated at next-day open; exits per the 5 production triggers.
- Transaction costs + fixed-bps slippage applied to every trade.
  // DEBT: slippage model v1 = fixed bps; refine from live fill data later.
- Default universe: Nifty 100 (reduces — does not eliminate — survivorship bias).

## Sentiment exclusion
Historical timestamped news unavailable retroactively. News archive builds from Day 1
of live running; sentiment enters backtests only after ~6 months of archive.
Until then: technicals + fundamentals only, stated on every report.

## Walk-forward
Split: train window → tune weights → test on unseen forward window → roll.
In-sample-only results are never reported as findings.

## Outputs per run
Win rate · profit factor · Sharpe · Sortino · max drawdown · CAGR · expectancy ·
avg hold time · exposure · recovery factor · MAE · MFE · vs benchmarks (see BENCHMARKS.md).

## Known limitation (stamped on every report)
Historical index constituent database unavailable → static universe → results optimistic.
Future work: constituent reconstruction from NSE index-change announcements.
