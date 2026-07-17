import { env } from '@config/env';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

/**
 * Telegram delivery: send with 3× backoff, and on final failure persist the
 * message to the undelivered queue so nothing is silently lost (docs §28 /
 * recoverability). Contractually no-throw. When credentials are unset, the
 * alert is logged instead of sent — the pipeline never fails on delivery.
 */

const SEND_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;

export const hasTelegramCredentials = (): boolean =>
  Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One send with retries. Returns true on success; never throws. */
const sendWithRetry = async (message: string): Promise<boolean> => {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.ok) return true;
      const body = await res.text().catch(() => '');
      logger.warn(`[Delivery]: Telegram send failed (${res.status}) attempt ${attempt}: ${body}`);
    } catch (err) {
      logger.warn(`[Delivery]: Telegram send error attempt ${attempt}: ${err instanceof Error ? err.message : err}`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
  }
  return false;
};

/**
 * Delivers an alert. Returns true when sent. When unconfigured, logs the alert
 * (dev/degraded) and returns false. On send failure, enqueues for resend.
 */
export const deliverAlert = async (message: string, runId?: string): Promise<boolean> => {
  if (!hasTelegramCredentials()) {
    logger.warn('[Delivery]: Telegram not configured — alert logged, not sent');
    logger.info(`[Delivery]: alert preview —\n${message}`);
    return false;
  }

  const sent = await sendWithRetry(message);
  if (!sent) {
    await prisma.undeliveredAlert
      .create({ data: { payload: message, runId, attempts: MAX_ATTEMPTS } })
      .catch((err) => logger.error(`[Delivery]: failed to queue undelivered alert: ${err.message}`));
    logger.warn('[Delivery]: alert queued as undelivered for resend');
  }
  return sent;
};

/** Retries queued undelivered alerts (oldest first). Returns the number sent. */
export const resendUndelivered = async (limit = 20): Promise<number> => {
  if (!hasTelegramCredentials()) return 0;

  const pending = await prisma.undeliveredAlert.findMany({
    where: { deliveredAt: null },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let sent = 0;
  for (const alert of pending) {
    const ok = await sendWithRetry(alert.payload);
    await prisma.undeliveredAlert.update({
      where: { id: alert.id },
      data: { attempts: alert.attempts + 1, ...(ok ? { deliveredAt: new Date() } : {}) },
    });
    if (ok) sent++;
  }
  if (sent) logger.info(`[Delivery]: resent ${sent}/${pending.length} undelivered alert(s)`);
  return sent;
};
