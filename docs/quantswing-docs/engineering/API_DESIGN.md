# API Design

## External APIs consumed
| API | Auth | Limits | Notes |
|---|---|---|---|
| Angel One SmartAPI | JWT via clientId+password+TOTP; ~8hr token, refresh at 7hr | 3 req/sec + per-minute cap (historical) | Symbol via symboltoken from instrument master JSON |
| Screener.in | registered API key | conservative — 24hr cache | behind FundamentalProvider |
| NSE/BSE XML | none | be polite; official feeds | filings, shareholding, results dates |
| RSS (ET/MC/Google) | none | 15-min pull | timeouts skip source |
| Telegram Bot API | bot token | generous | retry 3× then undelivered queue |

## Internal HTTP — FinBERT sidecar (:8001)
```
POST /score
  { "texts": ["...", "..."] }                     // batch — PERF: 1 call per article batch, not per article
→ 200 { "scores": [ {"positive":0.82,"negative":0.11,"neutral":0.07}, ... ] }
→ non-200 / timeout 5s → 2 retries → degraded neutral fallback
GET /health → 200 {"model":"finbert","loaded":true}
```

## Internal app endpoints (Express)
`/health` (custom checks: angel-token, finbert, db, redis, last-run) ·
`/metrics` (prom-client, Prometheus format) · `/info` (engine_version = git sha).

// SECURITY: Express server bound to localhost / behind firewall on VPS; no public exposure.

## Design rules
- All providers behind interfaces (OhlcvProvider etc.) — REST details never leak past data-ingestion.
- Every outbound call: explicit timeout (AbortSignal), retry policy per spec §28, prom-client-timed.
