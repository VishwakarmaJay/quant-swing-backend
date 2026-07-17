# ADR 0008 — Bun + TypeScript + Express, Redis, BullMQ (supersedes Java/Spring platform choice)
Status: Accepted — **partially amended in implementation (see note)**

> ⚠️ **AMENDED IN IMPLEMENTATION (2 of the decisions below were reversed as-built):**
> - **Jobs/scheduling: RabbitMQ, not BullMQ.** The as-built system uses RabbitMQ durable queues
>   + interval pollers. The "RabbitMQ instead of BullMQ" alternative below was *rejected here but
>   adopted in code* — treat the BullMQ rationale as historical.
> - **Indicators: in-house, not `indicatorts`.** The Phase-2 "verify vs in-house" check landed on
>   owning the math in-repo, so it can be golden-tested for byte-identical determinism.
>
> Everything else (Bun/TS, Express, Redis cache, Prisma/Postgres, pino/otplib/prom-client,
> bun:test) is as-built. [`../../SYSTEM.md`](../../SYSTEM.md) §2 is authoritative. This ADR is kept
> unedited below as the record of the original decision.

## Context
The platform was originally specified on Spring Boot 3 / Java 21 with TA4J, Caffeine,
Spring @Scheduled, Micrometer/Actuator, Flyway, and JUnit/WireMock/Testcontainers.
Decision made to consolidate on a TypeScript stack before Phase 1 implementation begins
(no code exists yet — this is a spec change, not a rewrite). The domain architecture
(pipeline, contracts, factor/strategy/portfolio split, ADRs 0001–0007) is unchanged.

## Decision
- **Runtime/language:** Bun + TypeScript (strict). HTTP layer: Express 5 (internal
  /health, /metrics, /info only — localhost-bound).
- **Jobs, scheduling, retries, throttling:** BullMQ on Redis. Repeatable jobs replace
  Spring @Scheduled (with persistence + locks for free); queue `limiter` enforces the
  Angel One 3 req/sec cap; delayed jobs drive Telegram undelivered-alert redelivery.
  **Redis is a soft dependency:** an in-process watchdog timer (no Redis dependency)
  verifies each scheduled window fired and dispatches the run inline when Redis is
  unavailable (in-process token bucket for pacing; Postgres `undelivered_alerts` is
  the redelivery source of truth). Postgres remains the only fail-fast dependency.
- **Cache:** Redis replaces Caffeine (24hr fundamentals cache survives restarts);
  small in-process LRU for per-run hot paths. Cache reads fall through to source on error.
- **DB:** PostgreSQL retained (ADR 0007 stands). Prisma ORM + Prisma Migrate
  (plain-SQL migrations) replace JPA + Flyway; JSONB queries beyond the client API
  use parameterized `$queryRaw`.
- **Supporting swaps:** TA4J → `indicatorts` (verify at Phase 2) · Micrometer/Actuator
  → prom-client + Express endpoints · logback → pino · googleauth → otplib ·
  JUnit/WireMock → bun:test + msw/nock (Testcontainers retained).

## Alternatives
- **Stay on Java/Spring:** mature, but second language alongside the Python sidecar and
  heavier memory (~512MB JVM vs ~256MB Bun) on a 4GB box dominated by FinBERT.
- **Node.js instead of Bun:** safest ecosystem compat; Bun chosen for native TS
  execution, speed, built-in test runner. // DEBT: if a critical lib breaks on Bun,
  the codebase is Node-compatible by construction — fallback is a runtime switch.
- **RabbitMQ instead of BullMQ:** proper broker with routing/fan-out — solves
  cross-service messaging we don't have. Single app, single node; queues are internal
  (cron, retry, rate limit). RabbitMQ adds an Erlang broker process (~150–200MB) and
  ops surface for zero v1 benefit. Reconsider only if v2 splits into services.
- **node-cron / in-process scheduling:** no persistence — a restart during a run loses
  scheduled retries; BullMQ jobs survive restarts and give exp-backoff retries per spec §28.
- **Kafka:** absurd at this scale.

## Consequences
+ One language (TypeScript) across app code and tooling; types shared end-to-end.
+ ~256MB freed on the VPS; Redis (~64MB) covers cache + jobs + rate limiting in one process.
+ Job persistence upgrades recoverability vs @Scheduled (which had none).
+ Redis outage costs only job persistence/locks and queue metrics — never a run,
  never an alert (watchdog inline dispatch + Postgres-backed redelivery; runs stamp
  `dispatch_mode` so queue vs inline is auditable). See OBSERVABILITY.md.
− Two dispatch paths (queue + inline fallback) must stay behaviorally identical —
  same handler invoked; enforced by a Redis-down integration scenario in CI.
− Bun/library compat must be verified at build time (Prisma, Testcontainers, SDKs) —
  flagged `Verify this` in TECH_STACK.md.
− Determinism guarantees now rest on golden dataset tests over TS number math
  (IEEE 754 double — same as Java's double; decimal.js on money paths).
