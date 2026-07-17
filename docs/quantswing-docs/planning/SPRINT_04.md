# Sprint 04 — Decision Layer (Phase 3)

**Goal:** First explainable signal on Telegram. M4.

## Scope
- [ ] MarketRegimeService (trend + breadth incl. 52W hi/lo + VIX)
- [ ] WeightedStrategy: regime weight matrix + 7 gates + agreementScore
- [ ] Signal math: ATR/swing-low SL, entry range, R:R/resistance targets
- [ ] PortfolioManager: kill switch, 2-position limit, 1-per-sector, sizing, Rejection records
- [ ] AlertFormatter (explainable format) + TelegramBotService + undelivered queue
- [ ] 5 cron jobs wired
- [ ] Snapshot persistence with all version fields

## Exit criteria
Nightly run end-to-end < 10 min; rejection audit trail visible; integration test green.
