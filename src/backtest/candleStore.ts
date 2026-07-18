import dayjs from 'dayjs';

import { BENCHMARK_ID } from '@/factors';
import { loadFundamentalQuarters, type FundamentalQuartersBySymbol } from '@/fundamentals';
import type { Candle } from '@/ohlcv';
import { VIX_ID } from '@/regime';
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
  /**
   * Announcement-dated quarters per canonical symbol (B4), for the per-day
   * fundamental pre-pass. Empty map when the table isn't backfilled — the
   * FundamentalFactor then stays neutral (baseline unchanged).
   */
  fundamentalsBySymbol: FundamentalQuartersBySymbol;
  /**
   * India VIX close per trading date (B8.4). The replay passes the as-of value
   * into regime detection; a date with no VIX candle → null → the detector's
   * Nifty-ATR proxy (identical to pre-feed behaviour).
   */
  vixByDate: Map<string, number>;
};

export const loadCandleStore = async (): Promise<CandleStore> => {
  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: 'EQ' },
    select: { id: true, symbol: true, name: true, sector: true },
    orderBy: { name: 'asc' },
  });

  const ids = [...instruments.map((i) => i.id), BENCHMARK_ID, VIX_ID];
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
  const fundamentalsBySymbol = await loadFundamentalQuarters();
  const vixByDate = new Map((seriesById.get(VIX_ID) ?? []).map((c) => [c.tradeDate, c.close]));
  seriesById.delete(VIX_ID); // not a tradeable series — regime input only
  return {
    instruments,
    seriesById,
    benchmark,
    tradingDates: benchmark.map((c) => c.tradeDate),
    fundamentalsBySymbol,
    vixByDate,
  };
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
