# Sprint 01 — Foundation (Phase 1)

**Goal:** Authenticated, validated, persisted market data for one stock end-to-end.

## Scope
- [ ] Bun + TypeScript scaffold (strict tsconfig, ESLint + Prettier), module dirs, .gitignore (.env from commit 1)
- [ ] config/default.yaml + env binding + fail-fast Zod config validator (weights sum, thresholds, capital sanity)
- [ ] Redis + BullMQ wiring: connection, base queue/worker setup, repeatable-job registration skeleton
- [ ] In-process watchdog skeleton: schedule verification + inline dispatch path (Redis-down fallback)
- [ ] AngelOneClient: generateSession w/ programmatic TOTP (otplib), token refresh at 7hr, retry 3× exp backoff
- [ ] InstrumentMasterService: startup download, in-memory map, version hash recorded
- [ ] Prisma schema + init migration: instruments, ohlcv, signals, rejections, undelivered_alerts
- [ ] DataQualityService: continuity + staleness checks, dataQualityScore
- [ ] Proof: RELIANCE 300-day history fetched, validated, persisted

## Exit criteria
M1 complete. Auth verified against live Angel One. CI typechecks + unit tests green.

## Risks
Angel One JS SDK version drift (verify on npm first) · Bun compat of Prisma/Testcontainers · TOTP secret setup on account.
