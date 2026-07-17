# Non-Functional Requirements

> ⚠️ **Stale on the job layer:** the rate-limit/queue mechanism is **RabbitMQ** as-built (not
> BullMQ); FinBERT batching refers to a factor **not yet built**. [`../../SYSTEM.md`](../../SYSTEM.md)
> §2 is authoritative.

| NFR | Target | Mechanism |
|---|---|---|
| Determinism | Same input → byte-identical FactorResult | Immutable FeatureBundle, golden dataset tests |
| Reproducibility | Any historical signal reconstructable | Versioned snapshots (schema/weights/engine/data) |
| Nightly run duration | < 10 min for 150 stocks | BullMQ rate-limited queue, Redis cache, FinBERT batching |
| Availability | Nightly run completes Mon–Fri | Failure isolation, health checks, stale-run alert |
| Recoverability | No silently lost signal | Telegram undelivered queue + retry |
| Fail-fast config | Invalid config never reaches trading hours | Startup validator, all violations listed at once |
| Memory | ≤ 4GB VPS total | FinBERT ~1.5GB + Bun app ~256MB + Postgres ~256MB + Redis ~64MB |
| Security | No secrets in code/logs/DB | Env-only, git-ignored .env, log scrubbing |
| Auditability | Every reject has a reason | Rejection records persisted |
| Testability | CI green = pipeline works | Unit + golden dataset + Testcontainers integration |
