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
  /** Capital (₹) allocated to a trade at full conviction; scaled by composite. */
  PORTFOLIO_BASE_CAPITAL: z.coerce.number().positive().default(100000),
  /** Max concurrent positions the PortfolioManager will hold. */
  PORTFOLIO_MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(2),
  /** Max concurrent positions per sector. */
  PORTFOLIO_MAX_PER_SECTOR: z.coerce.number().int().positive().default(1),
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
