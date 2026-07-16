import type { Order, Position, PositionLeg, TradeSetupLeg } from '@generated/prisma/client';
import { OrderStatus, PositionStatus, ReadableStatus, TransactionType } from '@generated/prisma/enums';

/**
 * Position/leg math — single source of truth, mirrored by the frontend's
 * positionMath.ts. All quantities are derived from orders (hedged invariant:
 * legs store no quantity). Everything keys on `filledQuantity`; hedged's
 * cleanup cron inconsistently used `quantity` — standardized here.
 */

export type LegOrder = Pick<
  Order,
  'status' | 'transactionType' | 'filledQuantity' | 'averageExecutionPrice'
>;

export type LegForMath = Pick<PositionLeg, 'action'> & {
  tradeSetupLeg: Pick<TradeSetupLeg, 'quantity'>;
  orders: LegOrder[];
};

export type PositionForMath = Pick<Position, 'status' | 'userMultiplier'> & {
  legs: LegForMath[];
};

const FILLED = [OrderStatus.COMPLETED, OrderStatus.PARTIAL] as const;

const isEntryOrder = (leg: Pick<PositionLeg, 'action'>, order: LegOrder) =>
  order.transactionType === leg.action;

/** Net held quantity: signed sum of COMPLETED fills (entry +, exit −). */
export const legHeldQuantity = (leg: LegForMath): number =>
  leg.orders.reduce((sum, order) => {
    if (order.status !== OrderStatus.COMPLETED) return sum;
    return sum + (isEntryOrder(leg, order) ? order.filledQuantity : -order.filledQuantity);
  }, 0);

/** Target quantity the leg reconciles toward (0 once the position is exiting). */
export const legTargetQuantity = (
  leg: LegForMath,
  position: Pick<Position, 'status' | 'userMultiplier'>,
): number =>
  position.status === PositionStatus.MARKED_FOR_EXIT || position.status === PositionStatus.CLOSED
    ? 0
    : leg.tradeSetupLeg.quantity * position.userMultiplier;

const weightedAvg = (leg: LegForMath, entry: boolean): { avg: number; qty: number } => {
  let qty = 0;
  let notional = 0;
  for (const order of leg.orders) {
    if (!(FILLED as readonly OrderStatus[]).includes(order.status)) continue;
    if (isEntryOrder(leg, order) !== entry) continue;
    if (!order.filledQuantity || order.averageExecutionPrice == null) continue;
    qty += order.filledQuantity;
    notional += order.averageExecutionPrice * order.filledQuantity;
  }
  return { avg: qty > 0 ? notional / qty : 0, qty };
};

export const legAvgEntry = (leg: LegForMath) => weightedAvg(leg, true);
export const legAvgExit = (leg: LegForMath) => weightedAvg(leg, false);

/** Realized P&L: (avgExit − avgEntry) × exitQty, negated for SELL legs. */
export const legRealizedPnl = (leg: LegForMath): number => {
  const entry = legAvgEntry(leg);
  const exit = legAvgExit(leg);
  if (exit.qty === 0) return 0;
  const pnl = (exit.avg - entry.avg) * exit.qty;
  return leg.action === TransactionType.SELL ? -pnl : pnl;
};

/** Unrealized MTM on remaining quantity: (ltp − avgEntry) × remaining, SELL negated. */
export const legMtm = (leg: LegForMath, ltp: number): number => {
  const entry = legAvgEntry(leg);
  const exit = legAvgExit(leg);
  const remaining = entry.qty - exit.qty;
  if (remaining <= 0 || ltp <= 0) return 0;
  const mtm = (ltp - entry.avg) * remaining;
  return leg.action === TransactionType.SELL ? -mtm : mtm;
};

export type PositionDisplayStatus = {
  status: ReadableStatus;
  severity: 'success' | 'warning' | 'danger';
};

/**
 * Display status (hedged calculatePositionStatus):
 *  - MARKED_FOR_EXIT with any leg not flat        → NOT_IN_SYNC (danger)
 *  - (CLOSED | MARKED_FOR_EXIT) with legs flat    → EXITED
 *  - any leg off-target with an open order        → IN_PROGRESS (warning)
 *  - any leg off-target                           → NOT_IN_SYNC (danger)
 *  - else                                         → SYNCED (success)
 */
export const calculatePositionStatus = (position: PositionForMath): PositionDisplayStatus => {
  const held = position.legs.map(legHeldQuantity);
  const allFlat = held.every((q) => q === 0);
  const anyInvalid = position.legs.some(
    (leg, i) => held[i] !== legTargetQuantity(leg, position),
  );
  const anyOrderOpen = position.legs.some((leg) =>
    leg.orders.some(
      (o) =>
        o.status === OrderStatus.OPEN ||
        o.status === OrderStatus.PARTIAL ||
        o.status === OrderStatus.PENDING,
    ),
  );

  if (position.status === PositionStatus.MARKED_FOR_EXIT && !allFlat) {
    return { status: ReadableStatus.NOT_IN_SYNC, severity: 'danger' };
  }
  if (
    (position.status === PositionStatus.CLOSED ||
      position.status === PositionStatus.MARKED_FOR_EXIT) &&
    allFlat
  ) {
    return { status: ReadableStatus.EXITED, severity: 'danger' };
  }
  if (anyInvalid && anyOrderOpen) return { status: ReadableStatus.IN_PROGRESS, severity: 'warning' };
  if (anyInvalid) return { status: ReadableStatus.NOT_IN_SYNC, severity: 'danger' };
  return { status: ReadableStatus.SYNCED, severity: 'success' };
};
