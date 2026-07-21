import dayjs from 'dayjs';

import { BENCHMARK_ID } from '@/factors';
import { loadFundamentalQuarters, type FundamentalQuartersBySymbol } from '@/fundamentals';
import type { DatedScoredArticle } from '@/news/sentimentAggregate';
import type { Candle } from '@/ohlcv';
import { VIX_ID } from '@/regime';
import { prisma } from '@services/prisma';

/** Canonical symbol → its scored articles, ascending by availableAt (B7). */
export type NewsBySymbol = Map<string, DatedScoredArticle[]>;

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
  /**
   * FinBERT-scored articles per canonical symbol (B7), for the per-day sentiment
   * pre-pass. Empty when the archive isn't scored/present → the SentimentFactor
   * stays neutral (baseline unchanged). Loaded all-origins; per-origin
   * evaluation filters at build time.
   */
  newsBySymbol: NewsBySymbol;
};

/**
 * The B7 per-origin evaluation tiers, ordered strongest→weakest availability
 * evidence: live capture (`fetchedAt`) > BSE backfill (exchange `DissemDT` +
 * margin) > GDELT (crawl-time reconstruction). `all` = no filter. Every
 * sentiment measurement runs per-tier so conclusions can rest on the most
 * trustworthy `availableAt` (SENTIMENT_FACTOR.md §4).
 */
export const SENTIMENT_ORIGIN_TIERS: Record<string, readonly string[] | undefined> = {
  live: ['LIVE_RSS', 'LIVE_BSE'],
  'live+bse': ['LIVE_RSS', 'LIVE_BSE', 'BSE_BACKFILL'],
  all: undefined,
};

/**
 * Loads the FinBERT-scored news archive into per-symbol arrays (ascending by
 * availability). Optional `origins` filter for the B7 per-origin evaluation
 * (live-only vs +BSE_BACKFILL vs +GDELT); omit for all origins.
 */
export const loadNewsBySymbol = async (origins?: readonly string[]): Promise<NewsBySymbol> => {
  const rows = await prisma.newsArticle.findMany({
    where: {
      sentimentScoredAt: { not: null },
      sentimentScore: { not: null },
      symbols: { isEmpty: false },
      ...(origins?.length ? { origin: { in: origins as never[] } } : {}),
    },
    orderBy: { availableAt: 'asc' },
    select: { symbols: true, availableAt: true, sentimentScore: true, sentimentNeutral: true },
  });
  const bySymbol: NewsBySymbol = new Map();
  for (const r of rows) {
    if (r.sentimentScore === null) continue;
    const article: DatedScoredArticle = {
      availableAtMs: r.availableAt.getTime(),
      score: r.sentimentScore,
      neutralProb: r.sentimentNeutral ?? 0,
    };
    for (const symbol of r.symbols) {
      (bySymbol.get(symbol) ?? bySymbol.set(symbol, []).get(symbol)!).push(article);
    }
  }
  return bySymbol;
};

export const loadCandleStore = async (opts?: {
  sentimentOrigins?: readonly string[];
  /**
   * Which universe to load. Default `EQ` = the large-cap production universe.
   * `EQ_MID` = the Option-B Nifty Midcap 150 spike universe (docs/MIDCAP_SPIKE.md),
   * ingested separately so the default never sees it. Benchmark stays NIFTY either
   * way (RS factor + regime are market-wide).
   */
  universeType?: 'EQ' | 'EQ_MID';
}): Promise<CandleStore> => {
  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: opts?.universeType ?? 'EQ' },
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
  const newsBySymbol = await loadNewsBySymbol(opts?.sentimentOrigins);
  const vixByDate = new Map((seriesById.get(VIX_ID) ?? []).map((c) => [c.tradeDate, c.close]));
  seriesById.delete(VIX_ID); // not a tradeable series — regime input only
  return {
    instruments,
    seriesById,
    benchmark,
    tradingDates: benchmark.map((c) => c.tradeDate),
    fundamentalsBySymbol,
    vixByDate,
    newsBySymbol,
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
