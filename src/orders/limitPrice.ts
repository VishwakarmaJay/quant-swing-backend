import { TransactionType } from '@generated/prisma/enums';
import type { OrderWithInstrument } from '@/brokers';
import { LiveLtp } from '@/ltpStream/liveLtp';
import logger from '@services/logger';

const DEFAULT_TICK_SIZE = 0.05;

/**
 * Price-improvement offset by anchor-price slab (hedged getLimitPriceOffset).
 * Larger offsets cross the spread with room to spare, improving fill rates:
 *   < 100 → 0.25, 100–200 → 0.50, 200–400 → 1, ≥ 400 → 2
 */
const getLimitPriceOffset = (anchorPrice: number, tickSize: number): number => {
  let offset: number;
  if (anchorPrice < 100) offset = 0.25;
  else if (anchorPrice < 200) offset = 0.5;
  else if (anchorPrice < 400) offset = 1;
  else offset = 2;
  // Keep the offset on the instrument's tick grid so the resulting LIMIT
  // price stays broker-valid.
  return Math.max(tickSize, Math.round(offset / tickSize) * tickSize);
};

/**
 * Tick-aligned limit price for MARKET→LIMIT conversion (hedged calculateLimitPrice).
 *
 * BUY  → top ask + slab offset
 * SELL → top bid − slab offset (floored at one tick)
 *
 * Sources, in order: (1) Redis live quote (needs bid & ask > 0),
 * (2) Instrument.lastPrice, (3) order.price. Throws when no usable source —
 * a 0-price LIMIT order must never reach the broker.
 */
export const calculateLimitPrice = async (order: OrderWithInstrument): Promise<number> => {
  const isBuy = order.transactionType === TransactionType.BUY;

  const rawTick = order.instrument.tickSize;
  const tickSize = rawTick > 0 && Number.isFinite(rawTick) ? rawTick : DEFAULT_TICK_SIZE;
  const tickDecimals = (tickSize.toString().split('.')[1] ?? '').length;
  const round = (n: number) => Math.round(n * 10 ** tickDecimals) / 10 ** tickDecimals;

  const quote = await LiveLtp.get(order.instrumentId);
  if (quote !== null && quote.b > 0 && quote.a > 0) {
    const anchor = isBuy ? quote.a : quote.b;
    const offset = getLimitPriceOffset(anchor, tickSize);
    const limitPrice = isBuy ? round(anchor + offset) : round(Math.max(anchor - offset, tickSize));
    logger.debug(
      `[LimitPrice]: LIVE ${order.instrumentId} ${isBuy ? 'BUY' : 'SELL'} anchor=${anchor} -> ${limitPrice}`,
    );
    return limitPrice;
  }

  // Redis miss/unusable. Fall back to stale-but-trusted anchors.
  let fallbackLtp = 0;
  if (order.instrument.lastPrice > 0 && Number.isFinite(order.instrument.lastPrice)) {
    fallbackLtp = order.instrument.lastPrice;
  } else if (order.price > 0 && Number.isFinite(order.price)) {
    fallbackLtp = order.price;
  }

  if (fallbackLtp <= 0) {
    throw new Error(
      `calculateLimitPrice: no usable price source (orderId=${order.id} instrumentId=${order.instrumentId})`,
    );
  }

  const offset = getLimitPriceOffset(fallbackLtp, tickSize);
  const limitPrice = isBuy
    ? round(fallbackLtp + offset)
    : round(Math.max(fallbackLtp - offset, tickSize));
  logger.debug(
    `[LimitPrice]: FALLBACK ${order.instrumentId} ${isBuy ? 'BUY' : 'SELL'} anchor=${fallbackLtp} -> ${limitPrice}`,
  );
  return limitPrice;
};
