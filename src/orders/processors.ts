import type { Broker, BrokerToken, Order, Prisma } from '@generated/prisma/client';
import { OrderStatus, OrderType } from '@generated/prisma/enums';
import { getBroker } from '@/brokers';
import type { OrderUpdate, OrderWithInstrument } from '@/brokers';
import { subscribeLtp } from '@/ltpStream/ltpStream';
import { calculateCharges } from '@/positions/charges';
import { syncPositionInBackground } from '@/positions/syncPosition';
import { io } from '@/socket/connection';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { calculateLimitPrice } from './limitPrice';

/**
 * Queue processors for the order pipeline (analog of hedged's queueHelper).
 * Each processor is defensive about stale/redelivered messages: guards make
 * every message idempotent, so a RabbitMQ redelivery never double-fires a
 * broker call.
 */

const fetchOrder = (orderId: string): Promise<OrderWithInstrument | null> =>
  prisma.order.findUnique({ where: { id: orderId }, include: { instrument: true } });

/** Latest non-expired token for the user+broker (a new login rotates tokens). */
export const getValidBrokerToken = (userId: string, broker: Broker): Promise<BrokerToken | null> =>
  prisma.brokerToken.findFirst({
    where: { userId, broker, expiry: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

/** Persist a broker delta and notify clients (single-user: global emit). */
const persistAndEmit = async (orderId: string, update: Prisma.OrderUpdateInput): Promise<Order> => {
  const order = await prisma.order.update({
    where: { id: orderId },
    data: update,
    include: { instrument: true },
  });
  io?.emit('order-update', order);
  // OMS orders reconcile their position after every state change; quick-ticket
  // (positionless) orders skip.
  if (order.positionId) syncPositionInBackground(order.positionId);
  return order;
};

/**
 * Merge F&O charges into a broker delta when it completes the order, so the
 * fill and its costs persist in one write (hedged stamps charges in orderStatus).
 */
const withCharges = (
  order: OrderWithInstrument,
  update: OrderUpdate,
): Prisma.OrderUpdateInput => {
  if (update.status !== OrderStatus.COMPLETED) return update;
  const charges = calculateCharges({
    status: update.status,
    transactionType: order.transactionType,
    filledQuantity: update.filledQuantity ?? order.filledQuantity,
    averageExecutionPrice: update.averageExecutionPrice ?? order.averageExecutionPrice,
  });
  return charges ? { ...update, ...charges } : update;
};

export const orderPlacement = async (orderId: string): Promise<void> => {
  let order = await fetchOrder(orderId);
  if (!order) {
    logger.warn(`[Orders]: placement for unknown order ${orderId}, skipping`);
    return;
  }
  // Idempotency backstop: a redelivered placement message must never re-fire
  // the broker call.
  if (order.brokerOrderId || order.status !== OrderStatus.PENDING) {
    logger.warn(`[Orders]: order ${orderId} already placed (${order.status}), skipping`);
    return;
  }

  const token = await getValidBrokerToken(order.userId, order.broker);
  if (!token) {
    await persistAndEmit(orderId, {
      status: OrderStatus.REJECTED,
      rejectReason: 'No valid broker token — login to the broker first',
    });
    return;
  }

  // Every traded instrument joins the live feed so its LTP flows to the UI
  // and to fill-price resolution (index instruments are already subscribed).
  subscribeLtp([order.instrument]);

  try {
    // Brokers only take limit orders here: resolve MARKET to a crossing limit
    // (slab offset over the live quote) before placing (hedged pattern).
    // calculateLimitPrice throws with no price source — caught below.
    if (order.orderType === OrderType.MARKET) {
      const price = await calculateLimitPrice(order);
      order = { ...order, orderType: OrderType.LIMIT, price };
    }

    const update = await getBroker(order.broker).placeOrder(token, order);
    await persistAndEmit(orderId, {
      ...withCharges(order, update),
      orderType: order.orderType,
      price: update.price ?? order.price,
      placedAt: new Date(),
    });
  } catch (err) {
    // Unlike hedged (where an ops flow can rescue limbo orders), nothing else
    // would ever pick a stuck PENDING order back up — reject it.
    await persistAndEmit(orderId, {
      status: OrderStatus.REJECTED,
      rejectReason: `Broker error during placement: ${err instanceof Error ? err.message : err}`,
    });
  }
};

export const orderModification = async (orderId: string): Promise<void> => {
  const order = await fetchOrder(orderId);
  if (!order || order.status !== OrderStatus.OPEN) {
    logger.warn(`[Orders]: modification for non-OPEN order ${orderId}, skipping`);
    return;
  }

  const token = await getValidBrokerToken(order.userId, order.broker);
  if (!token) {
    logger.error(`[Orders]: no valid broker token for modification of order ${orderId}`);
    return;
  }

  try {
    const update = await getBroker(order.broker).modifyOrder(token, order);
    await persistAndEmit(orderId, withCharges(order, update));
  } catch (err) {
    // Order stays OPEN; the status poller keeps tracking it.
    logger.error(
      `[Orders]: broker error during modification of order ${orderId}: ${err instanceof Error ? err.message : err}`,
    );
  }
};

export const orderCancellation = async (orderId: string): Promise<void> => {
  const order = await fetchOrder(orderId);
  if (!order || order.status !== OrderStatus.OPEN) {
    logger.warn(`[Orders]: cancellation for non-OPEN order ${orderId}, skipping`);
    return;
  }

  const token = await getValidBrokerToken(order.userId, order.broker);
  if (!token) {
    logger.error(`[Orders]: no valid broker token for cancellation of order ${orderId}`);
    return;
  }

  try {
    const update = await getBroker(order.broker).cancelOrder(token, order);
    await persistAndEmit(orderId, update);
  } catch (err) {
    logger.error(
      `[Orders]: broker error during cancellation of order ${orderId}: ${err instanceof Error ? err.message : err}`,
    );
  }
};

export const MAX_CHASE_ATTEMPTS = 25;
export const MAX_CHASE_FAILURES = 3;

/**
 * Price chase (hedged attemptChaseModification): re-quote an unfilled LIMIT
 * order from the live book so it keeps crossing the market. Driven by the
 * chase poller every ~5s. SKIPs (no broker call, no emit) when the recomputed
 * price is unchanged; stops on terminal status, market close, 25 attempts or
 * 3 failures. Interleavings with the status poller converge: Paper's
 * getOrderStatus refetches authoritative state, and a modify landing just
 * after a fill is corrected by the next status check.
 */
export const orderChase = async (orderId: string): Promise<void> => {
  const order = await fetchOrder(orderId);
  if (
    !order ||
    !order.brokerOrderId ||
    (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.PARTIAL) ||
    order.chaseAttempts >= MAX_CHASE_ATTEMPTS ||
    order.chaseFailures >= MAX_CHASE_FAILURES
  ) {
    return; // Stale/exhausted chase message.
  }

  const token = await getValidBrokerToken(order.userId, order.broker);
  if (!token) return;

  try {
    const newPrice = await calculateLimitPrice(order);
    const attempts = order.chaseAttempts + 1;
    const exhausted = attempts >= MAX_CHASE_ATTEMPTS;

    if (order.orderType === OrderType.LIMIT && newPrice === order.price) {
      // SKIP: don't waste a broker call on an unchanged price.
      await prisma.order.update({
        where: { id: order.id },
        data: {
          chaseAttempts: attempts,
          lastChaseAt: new Date(),
          ...(exhausted ? { remarks: `${MAX_CHASE_ATTEMPTS} attempts exhausted` } : {}),
        },
      });
      return;
    }

    const chased = { ...order, price: newPrice, orderType: OrderType.LIMIT };
    const update = await getBroker(order.broker).modifyOrder(token, chased);
    await persistAndEmit(order.id, {
      ...withCharges(chased, update),
      price: newPrice,
      orderType: OrderType.LIMIT,
      chaseAttempts: attempts,
      lastChaseAt: new Date(),
      ...(exhausted && update.status === OrderStatus.OPEN
        ? { remarks: `${MAX_CHASE_ATTEMPTS} attempts exhausted` }
        : {}),
    });
  } catch (err) {
    logger.error(
      `[Orders]: chase failed for order ${orderId}: ${err instanceof Error ? err.message : err}`,
    );
    await prisma.order
      .update({
        where: { id: order.id },
        data: { chaseFailures: order.chaseFailures + 1, lastChaseAt: new Date() },
      })
      .catch(() => {});
  }
};

export const orderStatusCheck = async (orderId: string): Promise<void> => {
  const order = await fetchOrder(orderId);
  if (
    !order ||
    !order.brokerOrderId ||
    (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.PARTIAL)
  ) {
    return; // Stale poll message; nothing to check.
  }

  const token = await getValidBrokerToken(order.userId, order.broker);
  if (!token) {
    logger.error(`[Orders]: no valid broker token for status check of order ${orderId}`);
    return;
  }

  try {
    const update: OrderUpdate = await getBroker(order.broker).getOrderStatus(token, order);
    // Persist + emit only on a real transition — no DB/socket churn from
    // no-op polls every few seconds.
    if (update.status !== order.status) await persistAndEmit(orderId, withCharges(order, update));
  } catch (err) {
    logger.error(
      `[Orders]: broker error during status check of order ${orderId}: ${err instanceof Error ? err.message : err}`,
    );
  }
};
