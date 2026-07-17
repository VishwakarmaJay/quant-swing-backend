# Sprint 05 — Backtesting (Phase 4)

**Goal:** Reproducible historical replay with baselines. M5.

## Scope
- [ ] BacktestEngine: as-of-date data slicing (no lookahead), Nifty 100 default universe
- [ ] TradeSimulator: entry at next open, all 5 exit triggers, transaction cost + fixed-bps slippage
- [ ] BenchmarkService: Buy & Hold Nifty 50 / Nifty 100 same-period comparison
- [ ] Backtest report: win rate, profit factor, Sharpe, Sortino, max DD, expectancy, MAE/MFE
- [ ] Weight sensitivity sweep harness (config-driven)
- [ ] Survivorship-bias limitation stamped on every report

## Exit criteria
12-month technicals+fundamentals backtest report generated; sentiment excluded (documented).
