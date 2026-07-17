# ADR 0007 — PostgreSQL + Fail-Fast Persistence
Status: Accepted

## Context
Storage spans relational data (instruments, OHLCV, positions) and document-shaped
snapshots; reproducibility depends on persistence.

## Decision
PostgreSQL with JSONB snapshots + version columns. DB failure = abort run (fail fast) —
the only dependency without graceful degradation.

## Alternatives
- SQLite: simpler ops, weaker concurrent access, no JSONB indexing depth.
- Postgres + Mongo split: two stores for one dataset — needless complexity.

## Consequences
+ One store, relational integrity + JSONB flexibility; append-only snapshot audit trail.
+ A run that can't persist is a run that never happened — no phantom unreproducible signals.
− Requires container/ops management vs embedded DB (accepted).
