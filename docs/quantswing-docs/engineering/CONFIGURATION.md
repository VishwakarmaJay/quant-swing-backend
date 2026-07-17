# Configuration

Everything numeric is configuration. Nothing hardcoded.

## Sources (precedence)
env vars > config/{profile}.yaml > config/default.yaml defaults.
Loaded once at startup and validated with Zod; the app works from the parsed,
typed config object only — never raw process.env in business logic.

## Layout (config/default.yaml)
```yaml
quantswing:
  capital:
    total: 5000
    max-risk-per-trade: 50
    daily-kill-switch: 50
    max-open-positions: 2
    max-per-sector: 1
    max-capital-per-trade: 3000
    min-return-vs-cost: 3.0
  strategy:
    base-threshold: 65
    technical-floor: 60
    sentiment-floor: 40
    rr-minimum: 2.0
    weights:
      bull:     { technical: 0.50, sentiment: 0.30, fundamental: 0.20 }
      sideways: { technical: 0.35, sentiment: 0.25, fundamental: 0.40 }
      high-vol: { technical: 0.40, sentiment: 0.45, fundamental: 0.15 }
      bear:     { technical: 0.30, sentiment: 0.30, fundamental: 0.40 }
  risk:
    sl-min-pct: 0.5
    sl-max-pct: 3.0
    atr-buckets: [{max: 1.5, mult: 2.0}, {max: 999, mult: 1.5}]
    size-reduction: {from-atr-pct: 3.0, to-atr-pct: 6.0, multiplier: 0.75}
    atr-reject-pct: 6.0
  sentiment:
    chase-k: 5.0
    chase-floor: 0.25
    recency-halflife-hours: 48
    dedup-jaccard: 0.7
  universe:
    size: 150
    min-volume: 500000
    price-min: 50
    price-max: 2000
  quality:
    min-score: 0.8
    fundamentals-stale-days: 120
```

## Secrets (.env only, git-ignored)
ANGEL_API_KEY · ANGEL_CLIENT_ID · ANGEL_PASSWORD · ANGEL_TOTP_SECRET (base32) ·
TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID · DB creds · REDIS_URL · FINBERT_URL.

## Fail-fast startup validation
Zod schema + cross-field rules. App refuses to start on: regime weights not summing to 1.0 · invalid cron ·
threshold ordering broken · risk > capital · SL band inverted · R:R < 1.0 ·
non-monotonic ATR buckets · missing env vars (all violations listed at once, never first-only).
