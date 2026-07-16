import type { Order, PositionLeg } from '@generated/prisma/client';
import { TransactionType } from '@generated/prisma/enums';

/**
 * Risk-aware placement ordering (hedged sortOrders, collapsed for the
 * options-only universe): margin-reducing legs go to the broker first.
 * An order is an *exit* when its action opposes the leg's action.
 *
 *   1. exit of a SELL leg  (buy back shorts first, while still hedged)
 *   2. entry of a BUY leg  (buy hedges before selling premium)
 *   3. exit of a BUY leg
 *   4. entry of a SELL leg
 *
 * Reproduces hedged's exit table (OPTION-SELL 3 < OPTION-BUY 6), entry table
 * (OPTION-BUY 3 < OPTION-SELL 6) and modification table (SELL-EXIT 6 <
 * BUY-ENTRY 7 < BUY-EXIT 10 < SELL-ENTRY 11) exactly.
 */
export const sortOrders = <T extends Pick<Order, 'transactionType'> & { positionLeg: Pick<PositionLeg, 'action'> }>(
  orders: T[],
): T[] => {
  const rank = (order: T): number => {
    const isExit = order.transactionType !== order.positionLeg.action;
    const legIsBuy = order.positionLeg.action === TransactionType.BUY;
    if (isExit && !legIsBuy) return 1;
    if (!isExit && legIsBuy) return 2;
    if (isExit && legIsBuy) return 3;
    return 4;
  };
  return orders.toSorted((a, b) => rank(a) - rank(b));
};
