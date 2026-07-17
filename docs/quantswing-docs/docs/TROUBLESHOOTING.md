# Troubleshooting

> ⚠️ **As-built note:** the queue/rate-limiter is **RabbitMQ** (not the BullMQ limiter referenced
> below); FinBERT/Sentiment are **not yet built**. [`../../SYSTEM.md`](../../SYSTEM.md) §2 is authoritative.

## Auth
**Angel One auth fails at startup**
- TOTP secret must be the base32 KEY, not a 6-digit code
- System clock skew breaks TOTP → `timedatectl` / NTP sync
- Check API key active on smartapi.angelone.in dashboard

**Token expired mid-run**
- ensureTokenValid refreshes at 7hr; if recurring, check container timezone = Asia/Kolkata

## Data
**Stock skipped every night**
- Query data_quality_log for its warnings (missing candles / stale fundamentals)
- Corporate action (split/bonus) can break continuity → re-pull history for symbol

**Instrument master download fails**
- URL/size changes occasionally — check Angel announcements; cached copy keeps app running

## FinBERT
**Sentiment always neutral + degraded=true**
- Sidecar down or model not loaded: `curl :8001/health`
- Cold start ~30s — app should warm it at boot

## Delivery
**No Telegram messages**
- Check undelivered_alerts table (queue working = delivery problem, empty = pipeline problem)
- Bot token valid? Chat ID matches allow-list?

## Runs
**Nightly run > 10 min**
- /metrics → quantswing_factor_duration_seconds by factor label — find the slow factor
- Angel per-minute cap hit → BullMQ limiter pacing logs

**Scheduled jobs not firing**
- Redis up? `redis-cli ping` — if down, the in-process watchdog should have run the
  job inline and sent a degraded-mode alert; check run records for dispatch_mode=INLINE_FALLBACK
- Neither queue nor watchdog fired → repeatable jobs/watchdog registered? Check startup log
- Container timezone must be Asia/Kolkata — cron patterns assume IST

**No signals for days**
- Check regime (CRASH/BEAR raise thresholds or block) and rejections table before
  suspecting a bug — silence is often the system working.
