# Project Description

## Positioning
A deterministic quantitative research and trade decision support platform for Indian equities.
Not a trading bot. Not a price predictor.

## Objective (v1)
Improve decision consistency, enforce risk management, eliminate emotional bias, and build
an auditable research pipeline. Any statistical edge is treated as a hypothesis that must be
validated through backtesting and forward testing.

## Problem → Solution
> ⚠️ **STALE SPEC on a few rows** — see the `[AS-BUILT]` notes. [`../../SYSTEM.md`](../../SYSTEM.md)
> is authoritative; [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) §3 has the drift table.

| Problem | Solution |
|---|---|
| 2,000+ NSE stocks, untrackable manually | Nightly automated scan of universe (**166 equities**) |
| Emotional decisions | Deterministic factors + strategy + portfolio gates |
| News overload | FinBERT sentiment, deduplicated, aggregated per stock *[AS-BUILT: not built yet]* |
| No sizing discipline | **Conviction-based** sizing (capital × composite/100), auto-computed quantity *[AS-BUILT: spec's fixed ₹50-risk model replaced]* |
| No exit plan | 5 explicit exit triggers *[AS-BUILT: the intraday 3×/day thesis checks are not implemented]* |

## Core design decision — No LLM
Rule-based factors + local FinBERT. Reasons: LLM cost (~₹9–12k/month) exceeds capital;
determinism enables backtesting; zero hallucination risk; full auditability.

## Trading profile
Swing/positional, 2–7 day holds, long-only, max 2 positions, 1 per sector, manual order
placement. *[AS-BUILT: base capital is **₹100,000** per trade (`PORTFOLIO_BASE_CAPITAL`), not the
spec's ₹5,000.]*

## Success criteria
1. Ships as polished open-source research platform (engineering goal)
2. Beats Buy & Hold Nifty 50 risk-adjusted, net of costs, in paper trading (empirical gate)
