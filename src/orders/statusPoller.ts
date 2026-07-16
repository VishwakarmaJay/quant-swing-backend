import { env } from '@config/env';
import { OrderStatus } from '@generated/prisma/enums';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { enqueueOrder, ORDER_QUEUES } from './queues';

/**
 * Polls live (OPEN/PARTIAL) orders every ORDER_STATUS_POLL_MS and enqueues a
 * status check for each. This is what drives Paper orders from OPEN to
 * COMPLETED over time (hedged uses a 30s BullMQ repeatable cron; quant-swing's
 * createCron is daily-only, so a plain interval fits better).
 *
 * Duplicate/overlapping STATUS messages are harmless: the processor's
 * OPEN-guard plus the broker's authoritative refetch make checks idempotent.
 */

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export const startOrderStatusPoller = (): void => {
  timer = setInterval(async () => {
    if (inFlight) return; // don't stack ticks if a poll runs long
    inFlight = true;
    try {
      const orders = await prisma.order.findMany({
        where: {
          status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] },
          brokerOrderId: { not: null },
        },
        select: { id: true },
      });
      for (const { id } of orders) enqueueOrder(ORDER_QUEUES.STATUS, id);
    } catch (err) {
      // DB or Rabbit down: skip this tick, the next one retries.
      logger.error(
        `[Orders]: status poll tick failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      inFlight = false;
    }
  }, env.ORDER_STATUS_POLL_MS);
  timer.unref();

  logger.info(`[Orders]: status poller running every ${env.ORDER_STATUS_POLL_MS}ms`);
};

export const stopOrderStatusPoller = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
