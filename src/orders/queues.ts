import logger from '@services/logger';
import { getChannel } from '@services/rabbit';

import {
  orderCancellation,
  orderChase,
  orderModification,
  orderPlacement,
  orderStatusCheck,
} from './processors';

/**
 * RabbitMQ queues for the order pipeline. Broker-agnostic on purpose: the
 * broker is resolved from the order row inside the processor (hedged's
 * per-broker queues exist for per-broker BullMQ rate limits, which don't
 * apply here).
 */
export enum ORDER_QUEUES {
  PLACEMENT = 'ORDER_PLACEMENT',
  MODIFICATION = 'ORDER_MODIFICATION',
  CANCELLATION = 'ORDER_CANCELLATION',
  STATUS = 'ORDER_STATUS',
  /// Price-chase re-quotes; kept separate so a slow chase never starves fills
  CHASE = 'ORDER_CHASE',
}

export type OrderQueueMessage = { orderId: string };

/** Publish an order id onto one of the order queues. */
export const enqueueOrder = (queue: ORDER_QUEUES, orderId: string): void => {
  getChannel().sendToQueue(queue, Buffer.from(JSON.stringify({ orderId })), { persistent: true });
};

const processors: Record<ORDER_QUEUES, (orderId: string) => Promise<void>> = {
  [ORDER_QUEUES.PLACEMENT]: orderPlacement,
  [ORDER_QUEUES.MODIFICATION]: orderModification,
  [ORDER_QUEUES.CANCELLATION]: orderCancellation,
  [ORDER_QUEUES.STATUS]: orderStatusCheck,
  [ORDER_QUEUES.CHASE]: orderChase,
};

/**
 * Asserts the four durable order queues and registers their consumers on the
 * shared channel (prefetch(1) is per-consumer, so a slow broker call on one
 * queue does not starve crons or the other order queues). Call after
 * connectRabbit().
 *
 * Failed messages are dropped, not requeued: broker errors are handled inside
 * the processors, and the status poller re-enqueues OPEN orders anyway — a
 * requeue loop with prefetch 1 would spin.
 */
export const startOrderQueues = async (): Promise<void> => {
  const channel = getChannel();

  for (const queue of Object.values(ORDER_QUEUES)) {
    await channel.assertQueue(queue, { durable: true });

    await channel.consume(queue, (message) => {
      if (!message) return;

      let orderId: string | undefined;
      try {
        orderId = (JSON.parse(message.content.toString()) as OrderQueueMessage).orderId;
      } catch {
        // Malformed message: nothing to retry, drop it.
        logger.error(`[Orders]: ${queue} received malformed message, dropping`);
        try {
          channel.ack(message);
        } catch {
          /* channel gone — redelivered on next boot */
        }
        return;
      }

      if (!orderId) {
        logger.error(`[Orders]: ${queue} message missing orderId, dropping`);
        try {
          channel.ack(message);
        } catch {
          /* channel gone */
        }
        return;
      }

      processors[queue](orderId)
        .then(() => channel.ack(message))
        .catch((err) => {
          logger.error(
            `[Orders]: ${queue} processor failed for order ${orderId}: ${err instanceof Error ? err.message : err}`,
          );
          try {
            channel.nack(message, false, false);
          } catch (nackErr) {
            logger.error(
              `[Orders]: ${queue} ack/nack failed — RabbitMQ channel is gone: ${nackErr instanceof Error ? nackErr.message : nackErr}`,
            );
          }
        });
    });
  }

  logger.info('[Orders]: order queues consuming');
};
