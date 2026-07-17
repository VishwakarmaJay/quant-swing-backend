import dayjs from 'dayjs';

import { BENCHMARK_ID } from '@/factors';
import { emaLatest } from '@/factors/indicators';
import type { Candle } from '@/ohlcv';
import { prisma } from '@services/prisma';

import { detectRegime } from './detectRegime';
import { DEFAULT_REGIME_CONFIG, type RegimeConfig, type RegimeResult } from './types';

/**
 * MarketRegimeService — the I/O bridge that assembles the regime detector's
 * inputs: loads Nifty candles, computes market breadth (% of the equity
 * universe trading above its fast EMA) as of `asOf`, and classifies the regime.
 * VIX is injected when available; otherwise the detector uses a Nifty-ATR proxy.
 */
export const detectMarketRegime = async (
  asOf: Date = new Date(),
  opts?: { vix?: number | null; config?: RegimeConfig },
): Promise<RegimeResult> => {
  const config = opts?.config ?? DEFAULT_REGIME_CONFIG;
  const asOfIso = dayjs(asOf).format('YYYY-MM-DD');
  const asOfDate = new Date(`${asOfIso}T00:00:00.000Z`);

  // Nifty benchmark candles.
  const niftyRows = await prisma.ohlcv.findMany({
    where: { instrumentId: BENCHMARK_ID, tradeDate: { lte: asOfDate } },
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  });
  const niftyCandles: Candle[] = niftyRows.map((r) => ({
    tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));

  // Breadth: fraction of the equity universe trading above its fast EMA.
  const equityIds = (
    await prisma.instrument.findMany({ where: { instrumentType: 'EQ' }, select: { id: true } })
  ).map((i) => i.id);

  const rows = await prisma.ohlcv.findMany({
    where: { instrumentId: { in: equityIds }, tradeDate: { lte: asOfDate } },
    orderBy: { tradeDate: 'asc' },
    select: { instrumentId: true, close: true },
  });

  const closesById = new Map<string, number[]>();
  for (const r of rows) {
    const arr = closesById.get(r.instrumentId) ?? [];
    arr.push(r.close);
    closesById.set(r.instrumentId, arr);
  }

  let counted = 0;
  let above = 0;
  for (const closes of closesById.values()) {
    const ema = emaLatest(closes, config.fastEmaPeriod);
    const last = closes.at(-1);
    if (ema === null || last === undefined) continue;
    counted++;
    if (last > ema) above++;
  }
  const breadthPct = counted > 0 ? (above / counted) * 100 : 0;

  return detectRegime(
    { asOf: asOfIso, niftyCandles, breadthPct, vix: opts?.vix ?? null },
    config,
  );
};
