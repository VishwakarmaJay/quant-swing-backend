import dayjs from 'dayjs';

import { assessDataQuality, type Candle } from '@/ohlcv';
import { prisma } from '@services/prisma';

import type { StockContext } from './types';

/**
 * Builds the StockContext a factor evaluates: loads an instrument's daily
 * candles from the ohlcv store up to (and including) `asOf` — never newer, so
 * there is no lookahead — and attaches the data-quality score. This is the I/O
 * bridge between the ingestion layer and the pure factor layer.
 */
export const buildStockContext = async (
  instrumentId: string,
  asOf: Date = new Date(),
): Promise<StockContext | null> => {
  const instrument = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    select: { symbol: true },
  });
  if (!instrument) return null;

  const asOfIso = dayjs(asOf).format('YYYY-MM-DD');
  const asOfDate = new Date(`${asOfIso}T00:00:00.000Z`);

  const rows = await prisma.ohlcv.findMany({
    where: { instrumentId, tradeDate: { lte: asOfDate } },
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  });

  const candles: Candle[] = rows.map((r) => ({
    tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));

  const quality = assessDataQuality(candles, asOfIso);

  return {
    symbol: instrument.symbol,
    asOf: asOfIso,
    candles,
    dataQualityScore: quality.score,
  };
};
