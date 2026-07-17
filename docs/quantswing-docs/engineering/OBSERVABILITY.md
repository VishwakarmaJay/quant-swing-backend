# Observability

## Structured logging
JSON via pino. Every pipeline run gets a run ID; all log lines and persisted records
carry it (pino child logger per run). // SECURITY: pino redact paths — tokens/secrets never logged.

## Metrics (prom-client → /metrics)
```
quantswing_factors_evaluated_total        counter
quantswing_factor_duration_seconds        histogram, label: factor   // PERF: finds slow factors
quantswing_news_ingested_total            counter
quantswing_news_deduplicated_total        counter
quantswing_candidates_rejected_total      counter, label: reason
quantswing_portfolio_rejects_total        counter, label: reason
quantswing_backtest_runtime_seconds       histogram
quantswing_dataquality_skipped_total      counter, label: symbol
quantswing_angel_api_calls_total          counter + error rate
```

## Health checks (custom /health checks)
Angel token validity · FinBERT reachable · DB · Redis (BullMQ backbone) ·
last-successful-nightly-run (stale > 24hr on a weekday = DOWN).

## Alerting
Nightly run failure → Telegram alert with run ID. Health DOWN → Telegram.

## Failure handling (summary — full table in spec §28)
Angel: 3× exp backoff · FinBERT: 2×, degraded-neutral fallback · RSS: skip source ·
Telegram: 3× then undelivered queue (row persisted in Postgres = source of truth;
BullMQ delayed job is only the retry timer) · PostgreSQL: fail fast (the ONLY
fail-fast dependency) · Redis: soft dependency, degraded mode below.
Principle: failures isolated per source; degradation recorded in snapshot.

## Redis degraded mode (Redis ≠ fail-fast)
BullMQ is the primary dispatcher; a plain in-process watchdog timer (setInterval —
zero Redis dependency) knows the same cron schedule and, at each scheduled window,
verifies the run actually started. If Redis is down or dispatch didn't happen:
- Watchdog invokes the SAME job handler inline (`dispatch_mode: INLINE_FALLBACK`
  stamped on the run record — queue vs inline is auditable).
- Rate limiting falls back to an in-process token bucket (single process, so
  equivalent pacing to the BullMQ limiter).
- Undelivered-alert redelivery sweeps the Postgres `undelivered_alerts` table
  directly on the watchdog interval.
- Telegram alert fires flagging degraded mode (Telegram needs no Redis).
Lost during an outage: job persistence/locks and queue metrics — never a run,
never an alert. // TEST: integration scenario — Redis container stopped → nightly
run still completes inline, degraded-mode alert sent.
