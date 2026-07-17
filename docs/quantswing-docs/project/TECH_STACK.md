# Tech Stack

> ⚠️ **STALE SPEC on two rows.** As-built the job/queue layer is **RabbitMQ** (durable queues +
> interval pollers), **not BullMQ** — the "Why BullMQ and not RabbitMQ" section below is now
> inverted and kept only for historical context. Indicators are **in-house** (versioned +
> golden-tested), **not the `indicatorts` library**. Everything else on this page is accurate.
> [`../../SYSTEM.md`](../../SYSTEM.md) §2 is authoritative; see
> [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) §3.

| Component | Technology | Why | Cost of choice |
|---|---|---|---|
| Runtime | Bun 1.x, TypeScript (strict) | Fast startup, native TS execution, built-in test runner + bundler | Younger ecosystem than JVM/Node; verify library compat on Bun |
| Backend | Express 5 on Bun | Minimal HTTP layer for internal /health, /metrics, /info; huge middleware ecosystem | Express is unopinionated — DI/structure is on us (composition root) |
| Jobs & scheduling | **[AS-BUILT: RabbitMQ]** durable queues + interval pollers ~~BullMQ (Redis-backed) + in-process watchdog fallback~~ | Repeatable cron jobs with persistence + locks (survive restarts), retries w/ exp backoff, per-queue rate limiting (Angel One 3 req/sec), delayed jobs for alert redelivery | *(spec's BullMQ rationale below is superseded)* |
| Cache | Redis (ioredis) + small in-process LRU for hot paths | 24hr fundamentals cache survives restarts; shared with BullMQ instance | Network hop vs in-heap cache (negligible on localhost) |
| DB | PostgreSQL | Relational fit; JSONB snapshots | Ops overhead vs SQLite |
| ORM / migrations | Prisma ORM + Prisma Migrate (SQL migrations in `prisma/migrations/`) | Typed client generated from one schema file, parameterized by construction, mature migration tooling | Query-engine overhead vs thin builders; JSONB queries drop to `$queryRaw` (still parameterized). Verify this — Prisma-on-Bun compat at build time |
| OHLCV | Angel One SmartAPI (`smartapi-javascript`, official SDK) | Free with account; ~2000-day daily lookback; WebSocket | TOTP auth complexity; 3 req/sec + per-minute cap. Verify this — SDK package name/version on npm at build time |
| Indicators | **[AS-BUILT: in-house implementations]** (EMA/RSI/MACD/ATR) ~~`indicatorts` library~~ | Fully versioned, auditable, and golden-tested — the golden determinism gate requires byte-identical output, so math is owned in-repo (the Phase-2 "evaluate vs in-house" decision landed on in-house) | Must maintain the math ourselves (covered by the golden dataset tests) |
| Sentiment | FinBERT (ProsusAI/finbert), FastAPI sidecar :8001 | Finance-trained, local, deterministic, ₹0 | US-trained → India normalizer needed; Python dependency |
| Fundamentals | Screener.in + NSE XML via FundamentalProvider | Free; NSE official; 24hr cache | Screener unofficial — interface swap mitigates |
| News | ET Markets RSS, Moneycontrol RSS, BSE XML, Google News RSS | Free/official, 15-min refresh | RSS latency vs paid feeds |
| Config & validation | YAML config files + env vars, parsed/validated with Zod at startup | Fail-fast, all violations listed at once | — |
| Money math | decimal.js on money paths crossing persistence | No binary-float drift on NUMERIC columns | — |
| TOTP | otplib | Programmatic TOTP from base32 secret | Verify this — package version at build time |
| Delivery | Telegram Bot via grammY | Instant, free, Markdown; TS-native bot framework | — |
| Logging | pino (JSON, redaction rules for secrets) | Structured logs with run ID; fast | — |
| Metrics | prom-client → `/metrics` | Prometheus-scrapeable | — |
| Testing | bun:test, Testcontainers (Postgres + Redis), msw/nock HTTP stubs | Unit / golden dataset / integration pyramid | Verify this — Testcontainers-on-Bun compat; fall back to Vitest runner if bun:test blocks it |

## Why BullMQ and not RabbitMQ  ⚠️ *(SUPERSEDED — the as-built system uses RabbitMQ; kept for historical context)*

The queueing needs are **internal to a single app on a single node**: cron-style job
scheduling (5 jobs), retry-with-backoff for undelivered Telegram alerts, and rate-limited
fan-out of Angel One requests. BullMQ covers all three natively on the Redis instance we
already run for caching — zero extra processes. RabbitMQ would add an Erlang broker
(~150–200MB) to a 4GB VPS whose budget is dominated by FinBERT, and its strengths
(cross-service routing, fan-out exchanges, multi-consumer delivery guarantees) solve
problems this architecture explicitly scopes out (single-user, single-node, no
service-to-service messaging). Revisit only if v2 splits into multiple services.
See ADR/0008.

Verify this — Angel One JS SDK coordinates and rate limits must be confirmed at Phase 1 build time.
