import dayjs from 'dayjs';

import { BENCHMARK_ID } from '@/factors';
import type { Candle } from '@/ohlcv';
import { prisma } from '@services/prisma';

/**
 * Loads every candle for the equity universe + the Nifty benchmark into memory
 * once, so the backtest replay slices in-memory instead of hitting the DB tens
 * of thousands of times.
 */
export type UniverseInstrument = { id: string; symbol: string; name: string; sector: string | null };

export type CandleStore = {
  instruments: UniverseInstrument[];
  seriesById: Map<string, Candle[]>;
  benchmark: Candle[];
  /** Trading dates (ISO), ascending — driven by the benchmark calendar. */
  tradingDates: string[];
};

export const loadCandleStore = async (): Promise<CandleStore> => {
  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: 'EQ' },
    select: { id: true, symbol: true, name: true, sector: true },
    orderBy: { name: 'asc' },
  });

  const ids = [...instruments.map((i) => i.id), BENCHMARK_ID];
  const rows = await prisma.ohlcv.findMany({
    where: { instrumentId: { in: ids } },
    orderBy: { tradeDate: 'asc' },
    select: { instrumentId: true, tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  });

  const seriesById = new Map<string, Candle[]>();
  for (const r of rows) {
    const arr = seriesById.get(r.instrumentId) ?? [];
    arr.push({
      tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    });
    seriesById.set(r.instrumentId, arr);
  }

  const benchmark = seriesById.get(BENCHMARK_ID) ?? [];
  return { instruments, seriesById, benchmark, tradingDates: benchmark.map((c) => c.tradeDate) };
};

/** Nifty Buy & Hold return (%) over [fromDate, toDate]. */
export const benchmarkReturn = (
  store: CandleStore,
  fromDate: string,
  toDate: string,
): { startClose: number; endClose: number; returnPct: number } | null => {
  const start = store.benchmark.find((c) => c.tradeDate >= fromDate);
  const end = [...store.benchmark].reverse().find((c) => c.tradeDate <= toDate);
  if (!start || !end || start.close <= 0) return null;
  return {
    startClose: start.close,
    endClose: end.close,
    returnPct: Number((((end.close - start.close) / start.close) * 100).toFixed(2)),
  };
};
