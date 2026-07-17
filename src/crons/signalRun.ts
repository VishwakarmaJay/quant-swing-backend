import { deliverAlert, formatSignalAlert, resendUndelivered } from '@/delivery';
import { persistRun, runPipeline } from '@/pipeline';
import logger from '@services/logger';

import { CRONJOBS, createCron } from './cron';

/**
 * The nightly decision run: full pipeline → persist the versioned snapshot →
 * resend any backlog → deliver today's alert. Fires at 17:00, after the 16:30
 * OHLCV incremental update so the candles are current.
 *
 * NOTE: createCron fires on server-local time — 17:00 assumes an IST server.
 */
export const runNightlySignals = async (): Promise<void> => {
  const result = await runPipeline();
  await persistRun(result);
  await resendUndelivered();
  await deliverAlert(formatSignalAlert(result), result.runId);
  logger.info(
    `[Signals]: nightly run ${result.runId} (${result.regime}) — ` +
      `${result.approved.length} approved, ${result.rejections.length} rejected`,
  );
};

export const registerSignalRunCron = () =>
  createCron(CRONJOBS.SIGNAL_RUN, { hour: 17, minute: 0 }, runNightlySignals);
