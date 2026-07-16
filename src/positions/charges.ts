import { OrderStatus, TransactionType } from '@generated/prisma/enums';
import type { OrderWithInstrument } from '@/brokers';

export type OrderCharges = {
  stt: number;
  stampDuty: number;
  exchangeCharges: number;
  sebiCharges: number;
  brokerage: number;
  gst: number;
  totalCharges: number;
};

/**
 * Indian F&O charge model on a filled order (hedged calculateCharges,
 * options-only — the quant-swing universe is index options on NFO/BFO).
 *
 * turnover = averageExecutionPrice × filledQuantity
 * STT 0.15% on SELL; stamp duty 0.003809524% on BUY; exchange 0.03503%;
 * SEBI 0.000100952%; flat ₹20 brokerage; GST 18% on (exchange + brokerage).
 */
export const calculateCharges = (
  order: Pick<
    OrderWithInstrument,
    'status' | 'transactionType' | 'filledQuantity' | 'averageExecutionPrice'
  >,
): OrderCharges | null => {
  if (
    order.status !== OrderStatus.COMPLETED ||
    !order.filledQuantity ||
    !order.averageExecutionPrice
  )
    return null;

  const turnover = order.averageExecutionPrice * order.filledQuantity;

  const stt = order.transactionType === TransactionType.SELL ? (turnover / 100) * 0.15 : 0;
  const stampDuty =
    order.transactionType === TransactionType.BUY ? (turnover / 100) * 0.003809524 : 0;
  const exchangeCharges = (turnover / 100) * 0.03503;
  const sebiCharges = (turnover / 100) * 0.000100952;
  const brokerage = 20;
  const gst = ((exchangeCharges + brokerage) * 18) / 100;
  const totalCharges = stt + stampDuty + exchangeCharges + sebiCharges + brokerage + gst;

  const r = (n: number) => Number(n.toFixed(2));
  return {
    stt: r(stt),
    stampDuty: r(stampDuty),
    exchangeCharges: r(exchangeCharges),
    sebiCharges: r(sebiCharges),
    brokerage: r(brokerage),
    gst: r(gst),
    totalCharges: r(totalCharges),
  };
};
