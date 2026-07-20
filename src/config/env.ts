import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().min(1).max(65535),

  RABBITMQ_URL: z.string().min(1).default('amqp://localhost'),

  /** How often live (OPEN/PARTIAL) orders are polled for status updates. */
  ORDER_STATUS_POLL_MS: z.coerce.number().int().positive().default(5000),
  /** How often chase-eligible OPEN orders are re-quoted from the live book. */
  ORDER_CHASE_POLL_MS: z.coerce.number().int().positive().default(5000),
  /** How often position P&L/MTM is recomputed during market hours. */
  POSITION_MTM_POLL_MS: z.coerce.number().int().positive().default(180000),
  /** How often squared-off MARKED_FOR_EXIT positions are flipped to CLOSED. */
  POSITION_CLEANUP_POLL_MS: z.coerce.number().int().positive().default(1800000),

  // ---- PortfolioManager (sizing + limits; set at runtime) ----
  /** Per-trade slot budget (₹). The book is this × PORTFOLIO_MAX_OPEN_POSITIONS. */
  PORTFOLIO_BASE_CAPITAL: z.coerce.number().positive().default(100000),
  /** Max concurrent positions the PortfolioManager will hold. */
  PORTFOLIO_MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(2),
  /** Max concurrent positions per sector. */
  PORTFOLIO_MAX_PER_SECTOR: z.coerce.number().int().positive().default(1),
  /**
   * Sizing model. `risk` since 2026-07-20 (B9 + B11: best returns and ~half the
   * drawdown in every simulated cell); `conviction` is the legacy composite-scaled
   * model, kept switchable for comparison but measured inferior.
   */
  PORTFOLIO_SIZING_MODE: z.enum(['risk', 'conviction']).default('risk'),
  /** `risk` mode: % of the whole book put at risk per trade (entry→stop). */
  PORTFOLIO_RISK_PCT: z.coerce.number().positive().default(1),
  /**
   * Reject OMS placements outside 09:15–15:30 IST. Off by default: the Paper
   * broker exists to test after hours (hedged's marketTime guard was
   * effectively disabled too).
   */
  ENFORCE_MARKET_HOURS: z.enum(['true', 'false']).default('false'),

  // Auth
  JWT_SECRET: z.string().min(1),

  // Angel One SmartAPI (optional — the LTP stream is disabled when unset)
  ANGELONE_API_KEY: z.string().min(1).optional(),
  ANGELONE_CLIENT_CODE: z.string().min(1).optional(),
  ANGELONE_MPIN: z.string().min(1).optional(),
  ANGELONE_TOTP_SECRET: z.string().min(1).optional(),

  // Telegram delivery (optional — alerts are logged, not sent, when unset)
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),

  // ---- News ingestion (ROADMAP B3; the sentiment archive clock) ----
  /** How often the news ingestion cron fetches all feeds (default 15 min). */
  NEWS_INGEST_INTERVAL_MS: z.coerce.number().int().positive().default(900000),
  /** Recency window (days) over which near-duplicate headlines are deduped. */
  NEWS_DEDUPE_WINDOW_DAYS: z.coerce.number().int().positive().default(3),
  /** Per-feed HTTP fetch timeout (ms). A slow/dead feed is skipped, not fatal. */
  NEWS_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  // ---- GDELT historical news backfill (ROADMAP B3.5) ----
  /** Days per GDELT DOC API query window when slicing a backfill date range. */
  GDELT_BATCH_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * Reconstructed availability latency (minutes): a historical article's
   * `availableAt` = publishedAt + this margin. Conservative stand-in for the
   * publish→poll delay the live collector would have had (see GDELT_BACKFILL.md).
   */
  GDELT_LATENCY_MINUTES: z.coerce.number().int().nonnegative().default(30),
  /** Polite delay (ms) between consecutive GDELT DOC API requests. */
  GDELT_RATE_LIMIT_MS: z.coerce.number().int().nonnegative().default(500),

  // ---- BSE announcements historical backfill (ROADMAP B3.6) ----
  /**
   * Reconstructed availability latency (minutes) for backfilled announcements:
   * `availableAt` = exchange dissemination time (DissemDT) + this margin —
   * the delay the live 15-min poll would have had.
   */
  BSE_BACKFILL_LATENCY_MINUTES: z.coerce.number().int().nonnegative().default(30),
  /**
   * Polite delay (ms) between BSE API requests. BSE's WAF blocks IPs on
   * sustained fast scraping (observed live with Screener on the fundamentals
   * side); 3s keeps a full pass under the radar.
   */
  BSE_BACKFILL_RATE_LIMIT_MS: z.coerce.number().int().nonnegative().default(3000),

  // ---- FinBERT sentiment sidecar (ROADMAP B6 / ADR-0006) ----
  /** Base URL of the Python scoring sidecar (localhost-only by design). */
  SENTIMENT_SIDECAR_URL: z.string().min(1).default('http://127.0.0.1:8001'),
  /** Per-request timeout (ms) for sidecar calls (ADR-0006: 5s). */
  SENTIMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  /** Headlines per sidecar /score request (shrink on CPU-constrained boxes). */
  SENTIMENT_BATCH_SIZE: z.coerce.number().int().positive().default(64),

  // ---- Fundamentals (ROADMAP B4; point-in-time data + weekly snapshot clock) ----
  /** How often the fundamentals snapshot cron runs (default 7 days). */
  FUNDAMENTALS_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().default(604800000),
  /**
   * Polite delay between per-company fetches (ms). Screener connection-blocks
   * an IP after ~200 requests at 1.1s pacing (observed 2026-07-18) — 3s+ keeps
   * a full-universe pass under their radar; the backfill is idempotent, so an
   * interrupted run just re-runs with the failed symbols.
   */
  FUNDAMENTALS_FETCH_DELAY_MS: z.coerce.number().int().nonnegative().default(3000),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional(),

  /** git sha stamped onto signals for reproducibility (set in CI/deploy). */
  ENGINE_VERSION: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
