# Database

PostgreSQL. Schema defined in `prisma/schema.prisma`; migrations via Prisma Migrate
(plain-SQL files in `prisma/migrations/`, applied with `prisma migrate deploy` at startup).
Least-privilege app user. JSONB snapshot queries use `$queryRaw` (parameterized) where
the Prisma client API falls short.

## Schema v1 (core tables)
```sql
instruments (
  symbol_token   VARCHAR PRIMARY KEY,
  trading_symbol VARCHAR NOT NULL,
  exchange       VARCHAR NOT NULL,
  sector         VARCHAR,
  master_version VARCHAR NOT NULL          -- instrument master file date/hash
);

ohlcv (
  symbol_token VARCHAR REFERENCES instruments,
  trade_date   DATE NOT NULL,
  open NUMERIC(12,2), high NUMERIC(12,2), low NUMERIC(12,2),
  close NUMERIC(12,2), volume BIGINT,
  PRIMARY KEY (symbol_token, trade_date)
);
-- PERF: PK covers the dominant query (symbol + date range); partition by year if >5yr history

articles (
  id BIGSERIAL PRIMARY KEY,
  source VARCHAR, title TEXT, normalized_title TEXT,
  published_at TIMESTAMPTZ, sentiment NUMERIC(4,3),
  degraded BOOLEAN DEFAULT FALSE,
  UNIQUE (normalized_title, published_at)   -- dedup backstop
);

article_stock_map (article_id BIGINT, symbol_token VARCHAR, map_level SMALLINT);

signals (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  symbol_token VARCHAR NOT NULL,
  action VARCHAR, entry_low NUMERIC, entry_high NUMERIC,
  target1 NUMERIC, target2 NUMERIC, stop_loss NUMERIC, qty INT,
  composite_score NUMERIC, agreement_score NUMERIC,
  snapshot_json JSONB NOT NULL,
  snapshot_schema_version VARCHAR NOT NULL,
  weights_version VARCHAR NOT NULL,
  engine_version VARCHAR NOT NULL,          -- git sha
  market_regime VARCHAR NOT NULL,
  instrument_master_version VARCHAR NOT NULL,
  constituent_snapshot_date DATE NOT NULL,
  factor_config_checksum VARCHAR NOT NULL
);

rejections (
  id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ,
  symbol_token VARCHAR, reason VARCHAR, detail TEXT, run_id VARCHAR
);

positions (
  id BIGSERIAL PRIMARY KEY, signal_id BIGINT REFERENCES signals,
  mode VARCHAR CHECK (mode IN ('PAPER','LIVE')),
  entry_price NUMERIC, entry_at TIMESTAMPTZ,
  exit_price NUMERIC, exit_at TIMESTAMPTZ, exit_trigger VARCHAR,
  pnl NUMERIC
);

undelivered_alerts (
  id BIGSERIAL PRIMARY KEY, payload JSONB, created_at TIMESTAMPTZ,
  attempts INT DEFAULT 0, delivered_at TIMESTAMPTZ
);

data_quality_log (
  run_id VARCHAR, symbol_token VARCHAR, score NUMERIC,
  warnings JSONB, created_at TIMESTAMPTZ
);
```

## Rules
- Snapshots are append-only; never mutated.
- schema evolution → new snapshot_schema_version + new SQL migration; old rows untouched.
- No secrets stored, ever.
