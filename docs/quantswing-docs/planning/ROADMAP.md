# Roadmap

## v1 (current) — Deterministic research platform
| Phase | Deliverable |
|---|---|
| 1 | Data ingestion: Angel One auth + TOTP, instrument master, persistence, DataQualityService |
| 2 | Factor implementations with deterministic unit tests |
| 2.5 | Golden Dataset Tests — fixed 10–20 stock dataset, byte-identical factor output asserted |
| 3 | Strategy + PortfolioManager + explainability + Telegram + cron jobs |
| 4 | Backtest framework (historical replay, no-lookahead) |
| 5 | Paper trading — metrics + factor attribution from week 1. **Gate: min 2 weeks; must beat Buy & Hold Nifty 50 risk-adjusted net of costs** |
| 6 | Empirical evaluation, factor pruning, then (only then) ML weighting |

## v1.5 candidates
- Delivery % factor from NSE bhavcopy (institutional-accumulation proxy)

## v2 backlog (evidence-gated)
ML weight learning (logistic regression → GBM) · factor orthogonalization ·
event-aware NLP · NER relationship graphs · earnings surprise · volume profile ·
historical constituent DB · short-signal alerts (informational only)

## Explicitly out of scope (v1)
Automated execution · shorts · intraday · ML models · options/F&O · multi-user.
