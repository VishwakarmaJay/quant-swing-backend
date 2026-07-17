# Project Description

## Positioning
A deterministic quantitative research and trade decision support platform for Indian equities.
Not a trading bot. Not a price predictor.

## Objective (v1)
Improve decision consistency, enforce risk management, eliminate emotional bias, and build
an auditable research pipeline. Any statistical edge is treated as a hypothesis that must be
validated through backtesting and forward testing.

## Problem → Solution
| Problem | Solution |
|---|---|
| 2,000+ NSE stocks, untrackable manually | Nightly automated scan of filtered universe (~150) |
| Emotional decisions | Deterministic factors + strategy + portfolio gates |
| News overload | FinBERT sentiment, deduplicated, aggregated per stock |
| No sizing discipline | Fixed ₹50 risk per trade, auto-computed quantity |
| No exit plan | 5 explicit exit triggers, intraday thesis checks 3×/day |

## Core design decision — No LLM
Rule-based factors + local FinBERT. Reasons: LLM cost (~₹9–12k/month) exceeds capital;
determinism enables backtesting; zero hallucination risk; full auditability.

## Trading profile
Swing/positional, 2–7 day holds, long-only, capital ₹5,000, max 2 positions,
1 per sector, manual order placement.

## Success criteria
1. Ships as polished open-source research platform (engineering goal)
2. Beats Buy & Hold Nifty 50 risk-adjusted, net of costs, in paper trading (empirical gate)
