import { env } from '@config/env';
import { PositionStatus } from '@generated/prisma/enums';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { legHeldQuantity } from './math';
import { syncPosition } from './syncPosition';

/**
 * Closed-position cleanup (hedged closedPositionCleanup): MARKED_FOR_EXIT
 * positions whose every leg nets to zero filled quantity flip to CLOSED.
 * Uses filledQuantity (hedged inconsistently used quantity here).
 */

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export const runPositionCleanupTick = async (): Promise<void> => {
  const positions = await prisma.position.findMany({
    where: { status: PositionStatus.MARKED_FOR_EXIT },
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
            },
          },
        },
      },
    },
  });

  for (const position of positions) {
    const allFlat = position.legs.every((leg) => legHeldQuantity(leg) === 0);
    if (!allFlat) continue;
    await prisma.position.update({
      where: { id: position.id },
      data: { status: PositionStatus.CLOSED, exitedAt: new Date() },
    });
    await syncPosition(position.id); // stamps EXITED + emits position-update
    logger.info(`[Positions]: position ${position.id} squared off -> CLOSED`);
  }
};

export const startPositionCleanupPoller = (): void => {
  timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await runPositionCleanupTick();
    } catch (err) {
      logger.error(`[Positions]: cleanup tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      inFlight = false;
    }
  }, env.POSITION_CLEANUP_POLL_MS);
  timer.unref();

  logger.info(`[Positions]: cleanup poller running every ${env.POSITION_CLEANUP_POLL_MS}ms`);
};

export const stopPositionCleanupPoller = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
