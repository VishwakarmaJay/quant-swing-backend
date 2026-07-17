import dayjs from 'dayjs';

import { assessDataQuality, type Candle } from '@/ohlcv';
import { prisma } from '@services/prisma';

import { lookbackReturnPct } from './indicators';
import { DEFAULT_SECTOR_RS_CONFIG } from './sectorRelativeStrengthFactor';
import type { StockContext } from './types';

/** The market benchmark used for relative strength. */
export const BENCHMARK_ID = 'NSE:Nifty 50';
export const BENCHMARK_SYMBOL = 'NIFTY';

/** Loads an instrument's daily candles up to `asOf` (ascending, no lookahead). */
const loadCandles = async (instrumentId: string, asOfDate: Date): Promise<Candle[]> => {
  const rows = await prisma.ohlcv.findMany({
    where: { instrumentId, tradeDate: { lte: asOfDate } },
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  });
  return rows.map((r) => ({
    tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
};

/** Pre-loaded benchmark candles a caller can pass to avoid re-loading per stock. */
export const loadBenchmarkCandles = (asOf: Date = new Date()): Promise<Candle[]> =>
  loadCandles(BENCHMARK_ID, new Date(`${dayjs(asOf).format('YYYY-MM-DD')}T00:00:00.000Z`));

/** Sector label → lookback returns (%) of the equities in that sector as of asOf. */
export type SectorPeerReturns = Map<string, number[]>;

/**
 * Cross-sectional pre-pass for SectorRelativeStrength: over the whole equity
 * universe, computes each stock's lookback return and groups them by sector.
 * Load once per run and pass to `buildStockContext` (like the benchmark), so a
 * single stock's context carries its sector peer group without the factor
 * fetching anything. Returns are gathered with the SAME helper the factor uses.
 */
export const loadSectorPeerReturns = async (
  asOf: Date = new Date(),
  lookback: number = DEFAULT_SECTOR_RS_CONFIG.lookback,
): Promise<SectorPeerReturns> => {
  const asOfDate = new Date(`${dayjs(asOf).format('YYYY-MM-DD')}T00:00:00.000Z`);
  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: 'EQ' },
    select: { id: true, sector: true },
  });

  const rows = await prisma.ohlcv.findMany({
    where: { instrumentId: { in: instruments.map((i) => i.id) }, tradeDate: { lte: asOfDate } },
    orderBy: { tradeDate: 'asc' },
    select: { instrumentId: true, close: true },
  });

  const closesById = new Map<string, number[]>();
  for (const r of rows) {
    const arr = closesById.get(r.instrumentId) ?? [];
    arr.push(r.close);
    closesById.set(r.instrumentId, arr);
  }

  const bySector: SectorPeerReturns = new Map();
  for (const inst of instruments) {
    if (!inst.sector) continue;
    const ret = lookbackReturnPct(closesById.get(inst.id) ?? [], lookback);
    if (ret === null) continue;
    (bySector.get(inst.sector) ?? bySector.set(inst.sector, []).get(inst.sector)!).push(ret);
  }
  return bySector;
};

/**
 * Builds the StockContext a factor evaluates: the instrument's candles + data
 * quality, its sector, and the market benchmark (Nifty). Pass
 * `opts.benchmarkCandles` to reuse a single benchmark load across a universe
 * scan; otherwise it is loaded here (skipped when the instrument *is* the
 * benchmark). I/O bridge between ingestion and the pure factor layer.
 */
export const buildStockContext = async (
  instrumentId: string,
  asOf: Date = new Date(),
  opts?: { benchmarkCandles?: readonly Candle[]; sectorPeerReturns?: SectorPeerReturns },
): Promise<StockContext | null> => {
  const instrument = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    select: { symbol: true, sector: true },
  });
  if (!instrument) return null;

  const asOfIso = dayjs(asOf).format('YYYY-MM-DD');
  const asOfDate = new Date(`${asOfIso}T00:00:00.000Z`);

  const candles = await loadCandles(instrumentId, asOfDate);
  const quality = assessDataQuality(candles, asOfIso);

  const benchmarkCandles =
    opts?.benchmarkCandles ??
    (instrumentId === BENCHMARK_ID ? candles : await loadCandles(BENCHMARK_ID, asOfDate));

  const sectorPeers =
    opts?.sectorPeerReturns && instrument.sector
      ? {
          peerReturnsPct: opts.sectorPeerReturns.get(instrument.sector) ?? [],
          lookback: DEFAULT_SECTOR_RS_CONFIG.lookback,
        }
      : null;

  return {
    symbol: instrument.symbol,
    asOf: asOfIso,
    candles,
    dataQualityScore: quality.score,
    sector: instrument.sector,
    benchmark: benchmarkCandles.length
      ? { symbol: BENCHMARK_SYMBOL, candles: benchmarkCandles }
      : null,
    sectorPeers,
  };
};
