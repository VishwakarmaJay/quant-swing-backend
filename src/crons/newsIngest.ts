import { env } from '@config/env';

import { ingestNews } from '@/news';

import { CRONJOBS, createIntervalCron } from './cron';

/**
 * News archive ingestion (ROADMAP B3): every 15 minutes (NEWS_INGEST_INTERVAL_MS),
 * poll all feeds and append new, deduped, symbol-tagged articles. This is the
 * sentiment-backtest clock — the archive start date is the earliest `fetchedAt`,
 * so it runs continuously regardless of market hours. Fires once on boot.
 */
export const registerNewsIngestCron = () =>
  createIntervalCron(CRONJOBS.NEWS_INGEST, env.NEWS_INGEST_INTERVAL_MS, async () => {
    await ingestNews();
  });
