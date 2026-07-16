import { env } from '@config/env';
import { PositionStatus } from '@generated/prisma/enums';
import { LiveLtp } from '@/ltpStream/liveLtp';
import logger from '@services/logger';
import { prisma } from '@services/prisma';
import { isTradingAllowed } from '@utils/marketHours';

import { legMtm, legRealizedPnl } from './math';

/**
 * P&L poller (folds hedged's positionMtm + positionPnL crons): every tick
 * during market hours, recompute per-leg realized P&L and unrealized MTM for
 * live positions (plus realized-only for recently CLOSED ones) and persist
 * `pnl` / `calcUnrealisedPnl`. LTP source: Redis live quote with
 * Instrument.lastPrice fallback.
 */

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export const runPositionMtmTick = async (): Promise<void> => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const positions = await prisma.position.findMany({
    where: {
      OR: [
        { status: { in: [PositionStatus.OPEN, PositionStatus.MARKED_FOR_EXIT] } },
        { status: PositionStatus.CLOSED, exitedAt: { gte: dayAgo } },
      ],
    },
    include: {
      legs: {
        include: {
          tradeSetupLeg: { select: { quantity: true } },
          instrument: { select: { id: true, lastPrice: true } },
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
  if (!positions.length) return;

  const instrumentIds = [
    ...new Set(positions.flatMap((p) => p.legs.map((l) => l.instrument.id))),
  ];
  const quotes = await LiveLtp.mget(instrumentIds);

  const updates = positions.flatMap((position) => {
    let realized = 0;
    let mtm = 0;
    for (const leg of position.legs) {
      realized += legRealizedPnl(leg);
      const ltp = quotes[leg.instrument.id]?.l ?? leg.instrument.lastPrice;
      mtm += legMtm(leg, ltp);
    }
    realized = Number(realized.toFixed(2));
    mtm = Number(mtm.toFixed(2));
    if (realized === position.pnl && mtm === position.calcUnrealisedPnl) return [];
    return [
      prisma.position.update({
        where: { id: position.id },
        data: { pnl: realized, calcUnrealisedPnl: mtm },
      }),
    ];
  });
  if (updates.length) await prisma.$transaction(updates);
};

export const startPositionMtmPoller = (): void => {
  timer = setInterval(async () => {
    if (inFlight || !isTradingAllowed()) return;
    inFlight = true;
    try {
      await runPositionMtmTick();
    } catch (err) {
      logger.error(`[Positions]: mtm tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      inFlight = false;
    }
  }, env.POSITION_MTM_POLL_MS);
  timer.unref();

  logger.info(`[Positions]: mtm poller running every ${env.POSITION_MTM_POLL_MS}ms`);
};

export const stopPositionMtmPoller = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
