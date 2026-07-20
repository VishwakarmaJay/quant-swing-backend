import dayjs from 'dayjs';

import { fundamentalsAsOf, loadFundamentalQuarters, type FundamentalSnapshotAsOf } from '@/fundamentals';
import { DEFAULT_SENTIMENT_AGGREGATE_CONFIG } from '@/news/sentimentAggregate';
import { assessDataQuality, type Candle } from '@/ohlcv';
import { prisma } from '@services/prisma';
import { NewsOrigin } from '@generated/prisma/enums';

import { lookbackReturnPct } from './indicators';
import { DEFAULT_SECTOR_RS_CONFIG } from './sectorRelativeStrengthFactor';
import type { SentimentArticleInput, StockContext } from './types';
import { canonicalSymbol } from '@/universe/symbols';

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
 * Cross-sectional pre-pass for the FundamentalFactor (mirrors
 * loadSectorPeerReturns): reconstructs every equity's point-in-time
 * fundamentals as of `asOf` from announcement-dated quarters (B4), plus the
 * sector→valid-PE grouping the value component ranks against. Load once per
 * run and pass to `buildStockContext`; an empty fundamentals table simply
 * leaves every snapshot dataless → the factor stays neutral.
 */
export type FundamentalInputs = {
  /** Canonical symbol (no -EQ suffix) → as-of snapshot. */
  bySymbol: Map<string, FundamentalSnapshotAsOf>;
  /** Sector label → as-of PEs of its members with valid (positive-earnings) P/E. */
  pesBySector: Map<string, number[]>;
};

export const loadFundamentalInputs = async (asOf: Date = new Date()): Promise<FundamentalInputs> => {
  const asOfIso = dayjs(asOf).format('YYYY-MM-DD');
  const asOfDate = new Date(`${asOfIso}T00:00:00.000Z`);

  const quarters = await loadFundamentalQuarters();
  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: 'EQ' },
    select: { id: true, symbol: true, sector: true },
  });
  // Latest close ≤ asOf per instrument (distinct picks the first row per id
  // under the tradeDate-desc ordering).
  const lastCloses = await prisma.ohlcv.findMany({
    where: { instrumentId: { in: instruments.map((i) => i.id) }, tradeDate: { lte: asOfDate } },
    orderBy: [{ instrumentId: 'asc' }, { tradeDate: 'desc' }],
    distinct: ['instrumentId'],
    select: { instrumentId: true, close: true },
  });
  const closeById = new Map(lastCloses.map((r) => [r.instrumentId, r.close]));

  const bySymbol = new Map<string, FundamentalSnapshotAsOf>();
  const pesBySector = new Map<string, number[]>();
  for (const inst of instruments) {
    const symbol = canonicalSymbol(inst.symbol);
    const snap = fundamentalsAsOf(quarters.get(symbol) ?? [], closeById.get(inst.id) ?? null, asOfIso);
    bySymbol.set(symbol, snap);
    if (inst.sector && snap.pe !== null) {
      (pesBySector.get(inst.sector) ?? pesBySector.set(inst.sector, []).get(inst.sector)!).push(snap.pe);
    }
  }
  return { bySymbol, pesBySector };
};

/** Symbol → its as-of scored articles (the SentimentFactor's injected input). */
export type SentimentInputs = Map<string, SentimentArticleInput[]>;

/** Sentiment pre-pass tuning (window must cover the factor's aggregate window). */
export type SentimentInputsOptions = {
  /** Only articles with `availableAt` within this many days of `asOf` are loaded. */
  windowDays?: number;
  /**
   * Restrict to these provenance origins. The B7 evaluation runs PER-ORIGIN
   * (live-only vs +BSE_BACKFILL vs +GDELT) to prove any edge on the strongest
   * evidence tier — backfilled rows carry reconstructed `availableAt`, weaker
   * than live capture. Omit → all origins.
   */
  origins?: readonly NewsOrigin[];
};

/**
 * Cross-sectional pre-pass for the SentimentFactor (mirrors the fundamental /
 * sector-peer loaders): reads the FinBERT-scored news archive and groups, per
 * universe symbol, every article whose honest availability time
 * (`availableAt`) is ≤ `asOf` and within the window, as `{ ageDays, score,
 * neutralProb }`. **Point-in-time by construction:** the query keys on
 * `availableAt` (never `publishedAt`/`fetchedAt`), and unscored rows are
 * excluded. Load once per as-of date and pass to `buildStockContext`.
 */
export const loadSentimentInputs = async (
  asOf: Date = new Date(),
  opts: SentimentInputsOptions = {},
): Promise<SentimentInputs> => {
  const windowDays = opts.windowDays ?? DEFAULT_SENTIMENT_AGGREGATE_CONFIG.windowDays;
  const asOfIso = dayjs(asOf).format('YYYY-MM-DD');
  const asOfDate = new Date(`${asOfIso}T00:00:00.000Z`);
  const windowStart = new Date(asOfDate.getTime() - windowDays * 86_400_000);

  const rows = await prisma.newsArticle.findMany({
    where: {
      availableAt: { gte: windowStart, lte: asOfDate },
      sentimentScoredAt: { not: null },
      sentimentScore: { not: null },
      symbols: { isEmpty: false },
      ...(opts.origins?.length ? { origin: { in: [...opts.origins] } } : {}),
    },
    select: { symbols: true, availableAt: true, sentimentScore: true, sentimentNeutral: true },
  });

  const bySymbol: SentimentInputs = new Map();
  for (const r of rows) {
    if (r.sentimentScore === null) continue;
    const ageDays = (asOfDate.getTime() - r.availableAt.getTime()) / 86_400_000;
    const input: SentimentArticleInput = {
      ageDays,
      score: r.sentimentScore,
      neutralProb: r.sentimentNeutral ?? 0,
    };
    for (const symbol of r.symbols) {
      const arr = bySymbol.get(symbol) ?? bySymbol.set(symbol, []).get(symbol)!;
      arr.push(input);
    }
  }
  return bySymbol;
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
  opts?: {
    benchmarkCandles?: readonly Candle[];
    sectorPeerReturns?: SectorPeerReturns;
    fundamentalInputs?: FundamentalInputs;
    sentimentInputs?: SentimentInputs;
  },
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

  const canonical = canonicalSymbol(instrument.symbol);
  const snap = opts?.fundamentalInputs?.bySymbol.get(canonical);
  const fundamentals = snap
    ? {
        ...snap,
        sectorPeerPes: instrument.sector
          ? (opts!.fundamentalInputs!.pesBySector.get(instrument.sector) ?? [])
          : [],
      }
    : null;

  // Symbol mapping keys news on the canonical symbol (no -EQ suffix).
  const articles = opts?.sentimentInputs?.get(canonical);
  const sentiment = articles ? { articles } : null;

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
    fundamentals,
    sentiment,
  };
};
