# ADR 0005 — Data Quality Gate
Status: Accepted

## Context
Missing candles, stale fundamentals, malformed timestamps, and API outages would force
every factor to defend itself, each slightly differently.

## Decision
Dedicated `DataQualityService` stage before feature extraction: continuity, staleness,
malformed-record checks; attaches `dataQualityScore`; below threshold (0.8) the stock is
skipped for the run and logged. Factors never see bad data.

## Alternatives
- Per-factor defensive coding: duplicated, inconsistent, silently divergent behavior.

## Consequences
+ Single choke point for data trust; quality warnings persisted per run.
+ Factors stay pure and simple.
− Legitimate-but-odd stocks (fresh listings) may be skipped until history accrues (acceptable).
