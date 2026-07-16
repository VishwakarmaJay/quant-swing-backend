import { io } from '@/socket/connection';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { calculatePositionStatus } from './math';

/**
 * Position reconciler (hedged syncParentVersion, minus the recommendation
 * version bookkeeping): recomputes the display status from completed orders
 * vs setup targets under a per-position row lock, persists it when changed,
 * and emits `position-update` after commit.
 *
 * Called fire-and-forget after every order state change (persistAndEmit hook)
 * and after position PATCHes. Concurrent syncs for one position serialize on
 * the row lock; different positions run in parallel. A failed sync self-heals
 * on the next order event.
 */
export const syncPosition = async (positionId: string): Promise<void> => {
  const changed = await prisma.$transaction(async (tx) => {
    // Pessimistic per-position lock, first thing in the txn (no ordering
    // hazards — this is the only row ever locked here).
    await tx.$queryRaw`SELECT id FROM "position" WHERE id = ${positionId} FOR UPDATE`;

    const position = await tx.position.findUnique({
      where: { id: positionId },
      include: {
        legs: {
          include: {
            tradeSetupLeg: { select: { quantity: true } },
            orders: {
              select: {
                status: true,
                transactionType: true,
                filledQuantity: true,
                averageExecutionPrice: true,
                totalCharges: true,
              },
            },
          },
        },
      },
    });
    if (!position) return false;

    const display = calculatePositionStatus(position);
    const totalCharges = Number(
      position.legs
        .flatMap((leg) => leg.orders)
        .reduce((sum, order) => sum + (order.totalCharges ?? 0), 0)
        .toFixed(2),
    );

    if (display.status === position.readableStatus && totalCharges === position.totalCharges)
      return false;

    await tx.position.update({
      where: { id: positionId },
      data: { readableStatus: display.status, totalCharges },
    });
    return true;
  });

  if (!changed) return;

  // Side effects after commit (hedged rule: never emit inside the txn).
  const full = await prisma.position.findUnique({
    where: { id: positionId },
    include: {
      tradeSetup: true,
      legs: {
        include: {
          tradeSetupLeg: true,
          instrument: true,
          orders: { orderBy: { createdAt: 'desc' } },
        },
      },
    },
  });
  if (full) io?.emit('position-update', full);
};

/** Fire-and-forget wrapper used by the order processors. */
export const syncPositionInBackground = (positionId: string): void => {
  syncPosition(positionId).catch((err) =>
    logger.error(
      `[Positions]: sync failed for ${positionId}: ${err instanceof Error ? err.message : err}`,
    ),
  );
};
