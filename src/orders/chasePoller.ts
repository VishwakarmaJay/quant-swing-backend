import { env } from '@config/env';
import { OrderStatus } from '@generated/prisma/enums';
import logger from '@services/logger';
import { prisma } from '@services/prisma';
import { isTradingAllowed } from '@utils/marketHours';

import { MAX_CHASE_ATTEMPTS, MAX_CHASE_FAILURES } from './processors';
import { enqueueOrder, ORDER_QUEUES } from './queues';

/**
 * Drives the price chase (hedged recursiveOrderModificationQueue, redesigned
 * for RabbitMQ which has no delayed delivery): every tick, chase-eligible
 * OPEN orders whose last chase is older than one interval are enqueued to
 * ORDER_CHASE. All chase state lives on the Order row, so a restart resumes
 * exactly where it left off.
 */

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export const startOrderChasePoller = (): void => {
  timer = setInterval(async () => {
    if (inFlight || !isTradingAllowed()) return;
    inFlight = true;
    try {
      const staleBefore = new Date(Date.now() - env.ORDER_CHASE_POLL_MS);
      const orders = await prisma.order.findMany({
        where: {
          chase: true,
          brokerOrderId: { not: null },
          status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] },
          chaseAttempts: { lt: MAX_CHASE_ATTEMPTS },
          chaseFailures: { lt: MAX_CHASE_FAILURES },
          OR: [
            { lastChaseAt: null, placedAt: { lt: staleBefore } },
            { lastChaseAt: { lt: staleBefore } },
          ],
        },
        select: { id: true },
      });
      for (const { id } of orders) enqueueOrder(ORDER_QUEUES.CHASE, id);
    } catch (err) {
      logger.error(`[Orders]: chase poll tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      inFlight = false;
    }
  }, env.ORDER_CHASE_POLL_MS);
  timer.unref();

  logger.info(`[Orders]: chase poller running every ${env.ORDER_CHASE_POLL_MS}ms`);
};

export const stopOrderChasePoller = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
