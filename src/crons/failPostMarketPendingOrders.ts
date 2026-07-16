import { OrderStatus } from '@generated/prisma/enums';
import { syncPosition } from '@/positions';
import { io } from '@/socket/connection';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { CRONJOBS, createCron } from './cron';

/**
 * Post-market cleanup (hedged failPostMarketPendingOrders): after the session
 * ends, every order still working is cancelled and its position reconciled,
 * so nothing carries stale intent into the next day.
 *
 * NOTE: createCron fires on server-local time — the 16:00 schedule assumes an
 * IST server (run with TZ=Asia/Kolkata otherwise).
 */
export const runFailPostMarketPendingOrders = async (): Promise<void> => {
  const live = await prisma.order.findMany({
    where: { status: { in: [OrderStatus.PENDING, OrderStatus.OPEN, OrderStatus.PARTIAL] } },
    select: { id: true, positionId: true },
  });
  if (!live.length) return;

  await prisma.order.updateMany({
    where: { id: { in: live.map((o) => o.id) } },
    data: {
      status: OrderStatus.CANCELLED,
      rejectReason: 'Cancelled: market closed',
      cancelledAt: new Date(),
    },
  });

  const cancelled = await prisma.order.findMany({
    where: { id: { in: live.map((o) => o.id) } },
    include: { instrument: true },
  });
  for (const order of cancelled) io?.emit('order-update', order);

  const positionIds = [...new Set(live.map((o) => o.positionId).filter((id) => id != null))];
  for (const positionId of positionIds) await syncPosition(positionId);

  logger.info(
    `[Crons]: post-market cleanup cancelled ${live.length} orders across ${positionIds.length} positions`,
  );
};

/** Cancels all working orders at 16:00 (post market close). */
export const registerFailPostMarketPendingOrdersCron = () =>
  createCron(
    CRONJOBS.FAIL_POST_MARKET_PENDING_ORDERS,
    { hour: 16, minute: 0 },
    runFailPostMarketPendingOrders,
  );
