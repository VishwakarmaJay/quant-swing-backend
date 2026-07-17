# QuantSwing

> ℹ️ **These are the original spec / planning docs.** For the *implemented* system
> (Phases 1–4 done) with exact math and current state, read
> [`../SYSTEM.md`](../SYSTEM.md) and [`../START_HERE.md`](../START_HERE.md) — those are
> the authoritative source of what actually exists in the code.

**A deterministic quantitative research and trade decision support platform for Indian equities (NSE/BSE).**

> QuantSwing is intentionally designed as a deterministic research platform. Every recommendation is reproducible from historical data, versioned configuration, and stored feature snapshots, enabling transparent evaluation and continuous improvement.

## What it is
- Nightly scan of a filtered NSE universe (~166 stocks)
- Factor-based scoring: Trend · Momentum · Relative Strength · Volume · Volatility *(as-built)* — Sentiment (FinBERT) and Fundamentals are **planned, not yet built**
- Strategy layer proposes trades; PortfolioManager enforces capital/risk constraints
- Explainable signals delivered via Telegram — **orders are placed manually by the user**

## What it is NOT
- Not an algo trading bot (no automated execution)
- Not a price predictor
- Not a profit guarantee — any statistical edge is a hypothesis validated via backtesting and forward testing

## Stack
Bun · TypeScript · Express · **RabbitMQ** + Redis · PostgreSQL · Angel One Smart API · Telegram
*(as-built; FinBERT sidecar is planned, not yet built — spec pages may still list BullMQ)*

## Quick links
- [Project Description](project/PROJECT_DESCRIPTION.md)
- [Architecture](project/ARCHITECTURE.md)
- [Roadmap](planning/ROADMAP.md)
- [Research Protocol](research/RESEARCH_PROTOCOL.md)
- [Known Limitations](docs/KNOWN_LIMITATIONS.md)

## Status
Architecture frozen (spec v2.0, §1–§32). **Implementation: Phases 1–4 complete** (data, factors,
golden gate, decision layer, backtesting) — see [`../SYSTEM.md`](../SYSTEM.md). Backtest shows the
current technicals-only strategy has **no edge yet**; next work is on entries, not Phase 5.

## Disclaimer
Educational/research software. Not investment advice. Trading equities involves risk of loss. See [ASSUMPTIONS](research/ASSUMPTIONS.md) and [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md).
