import logger from '@services/logger';
import { getChannel } from '@services/rabbit';

export enum CRONJOBS {
  INSTRUMENT_SYNC = 'INSTRUMENT_SYNC',
  FAIL_POST_MARKET_PENDING_ORDERS = 'FAIL_POST_MARKET_PENDING_ORDERS',
  OHLCV_INCREMENTAL = 'OHLCV_INCREMENTAL',
  SIGNAL_RUN = 'SIGNAL_RUN',
  NEWS_INGEST = 'NEWS_INGEST',
  FUNDAMENTALS_SNAPSHOT = 'FUNDAMENTALS_SNAPSHOT',
}

/** Time of day (server-local) at which a daily cron fires. */
export type CronPattern = {
  hour: number;
  minute: number;
};

const timers: NodeJS.Timeout[] = [];

/**
 * Determines whether a cron should auto-schedule and auto-run.
 *
 * Production (CRONS_ENABLED unset): every cron runs. Otherwise CRONS_ENABLED is
 * a comma-separated allowlist of CRONJOBS names (hedged pattern).
 */
export function isCronEnabled(name: CRONJOBS): boolean {
  const raw = process.env.CRONS_ENABLED;
  if (raw === undefined || raw.trim() === '') return true;
  return raw
    .split(',')
    .map((s) => s.trim())
    .includes(name);
}

/** Milliseconds until the next occurrence of hour:minute (server-local time). */
const msUntilNext = ({ hour, minute }: CronPattern): number => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
};

/** Publishes a fire message to the cron's queue; logs (never throws) if Rabbit is down. */
const publishFire = (name: CRONJOBS, queueName: string): void => {
  try {
    // Resolve the channel at fire time — the boot-time one may be dead by now.
    getChannel().sendToQueue(queueName, Buffer.from(JSON.stringify({ name, firedAt: new Date() })), {
      persistent: true,
    });
  } catch (err) {
    logger.error(
      `[Cron]: ${name} publish failed — RabbitMQ unavailable, run skipped: ${err instanceof Error ? err.message : err}`,
    );
  }
};

/**
 * Asserts the cron's durable queue and attaches the consumer that runs `jobFn`.
 * Splitting schedule from execution keeps runs durable — a message published
 * while the consumer is busy waits in the queue instead of being lost.
 */
const attachConsumer = async (name: CRONJOBS, queueName: string, jobFn: () => Promise<void>): Promise<void> => {
  const channel = getChannel();
  await channel.assertQueue(queueName, { durable: true });
  await channel.consume(queueName, (message) => {
    if (!message) return;
    jobFn()
      .then(() => channel.ack(message))
      .catch((err) => {
        logger.error(`[Cron]: ${name} failed: ${err instanceof Error ? err.message : err}`);
        try {
          // Drop the message: a cron should wait for its next scheduled run,
          // not retry-loop on a persistent failure.
          channel.nack(message, false, false);
        } catch (nackErr) {
          logger.error(
            `[Cron]: ${name} ack/nack failed — RabbitMQ channel is gone: ${nackErr instanceof Error ? nackErr.message : nackErr}`,
          );
        }
      });
  });
};

/**
 * Creates a daily cron backed by RabbitMQ: a scheduler publishes to `CRON_<name>`
 * at the given time each day, and a consumer runs the job function.
 */
export async function createCron(
  name: CRONJOBS,
  pattern: CronPattern,
  jobFn: () => Promise<void>,
): Promise<void> {
  const queueName = `CRON_${name}`;
  await attachConsumer(name, queueName, jobFn);

  if (!isCronEnabled(name)) {
    logger.info(`[Cron]: ${name} disabled via CRONS_ENABLED`);
    return;
  }

  const scheduleNext = () => {
    const delay = msUntilNext(pattern);
    const timer = setTimeout(() => {
      publishFire(name, queueName);
      scheduleNext();
    }, delay);
    timer.unref();
    timers.push(timer);
    logger.info(`[Cron]: ${name} next run in ${Math.round(delay / 60000)} minutes`);
  };

  scheduleNext();
}

/**
 * Creates an interval cron backed by RabbitMQ: same durable queue + consumer as
 * the daily crons, but the scheduler fires every `intervalMs` (e.g. the 15-min
 * news poll, ROADMAP B3) rather than at a fixed time of day. Fires once
 * immediately on boot so the archive starts collecting without waiting a full
 * interval.
 */
export async function createIntervalCron(
  name: CRONJOBS,
  intervalMs: number,
  jobFn: () => Promise<void>,
): Promise<void> {
  const queueName = `CRON_${name}`;
  await attachConsumer(name, queueName, jobFn);

  if (!isCronEnabled(name)) {
    logger.info(`[Cron]: ${name} disabled via CRONS_ENABLED`);
    return;
  }

  publishFire(name, queueName); // kick off immediately
  const timer = setInterval(() => publishFire(name, queueName), intervalMs);
  timer.unref();
  timers.push(timer);
  logger.info(`[Cron]: ${name} scheduled every ${Math.round(intervalMs / 60000)} minutes`);
}

/** Cancels every scheduled timer (called during graceful shutdown). */
export const stopCrons = (): void => {
  for (const timer of timers.splice(0)) clearTimeout(timer);
};
