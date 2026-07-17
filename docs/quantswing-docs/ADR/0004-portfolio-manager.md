# ADR 0004 — PortfolioManager Split from Strategy
Status: Accepted

## Context
Risk engine originally mixed signal-quality gates with portfolio constraints
(kill switch, sizing, sector caps, position limits).

## Decision
Strategy answers "is this a good trade?"; PortfolioManager answers "can we take it now?"
Portfolio constraints (kill switch, sizing, 1-per-sector, 2-position cap, exposure)
move to PortfolioManager, which emits ApprovedSignal | Rejection(reason, detail).

## Alternatives
- Single risk engine: workable with one strategy, ambiguous with many (whose candidate
  gets the last slot?).

## Consequences
+ Auditable rejections ("already holding TCS, IT cap=1"); multi-strategy ready.
+ Sizing/caps testable independently of scoring.
− Extra hop in the pipeline (negligible).
