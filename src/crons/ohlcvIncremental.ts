import { runOhlcvIncremental } from '@/ohlcv';
import { CRONJOBS, createCron } from './cron';

/**
 * Keeps the research OHLCV store current: every evening after the daily candle
 * is finalized, fetch each history-bearing instrument forward from its last
 * stored date. Fires at 16:30 — after post-market order cleanup (16:00) and
 * well after the 15:30 close, so the day's candle is settled.
 *
 * NOTE: createCron fires on server-local time — 16:30 assumes an IST server
 * (run with TZ=Asia/Kolkata otherwise).
 */
export const registerOhlcvIncrementalCron = () =>
  createCron(CRONJOBS.OHLCV_INCREMENTAL, { hour: 16, minute: 30 }, async () => {
    await runOhlcvIncremental();
  });
