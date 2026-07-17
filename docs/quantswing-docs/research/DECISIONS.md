# Decisions Log

Running log; architectural decisions get full ADRs in /ADR.

| Date | Decision | Rationale | ADR |
|---|---|---|---|
| 2026-06 | No LLM in pipeline; FinBERT only | Cost, determinism, auditability | 0002 |
| 2026-06 | Factor interface architecture | Plug-and-play features, ML-ready logging | 0001 |
| 2026-06 | Strategy pattern over composite-as-primitive | Multiple strategies without pipeline change | 0003 |
| 2026-06 | PortfolioManager split from Strategy | Trade quality ≠ portfolio permission | 0004 |
| 2026-06 | DataQualityService pre-stage | Factors never defend against bad data individually | 0005 |
| 2026-06 | FinBERT as Python sidecar | Isolation; replaceable without touching the app | 0006 |
| 2026-06 | PostgreSQL; fail-fast on DB errors | Reproducibility depends on persistence | 0007 |
| 2026-07 | Stack: Bun + TypeScript + Express, Redis, BullMQ, Prisma (from Spring/Java) | One language, lighter footprint, persistent jobs + rate limiting on Redis | 0008 |
| 2026-07 | Redis is a soft dependency; Postgres stays the only fail-fast one | Watchdog inline dispatch + Postgres-backed alert redelivery — outage never loses a run or alert | 0008 |
| 2026-06 | Stop/size decoupled (ATR→stop, vol→size) | One variable per concern; clean attribution | — |
| 2026-06 | agreementScore naming (not "confidence") | Honest: uncalibrated | — |
| 2026-06 | Long-only v1 | F&O margin + risk profile unfit for ₹5K | — |
| 2026-06 | Architecture frozen at spec v2.0 §32 | Remaining unknowns are empirical | — |
