import dayjs from 'dayjs';

import type { Instrument } from '@generated/prisma/client';
import { hasAngelOneCredentials } from '@services/angelOne';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { fetchCandles, type Candle } from './candleClient';
import { assessDataQuality, isValidCandle, type DataQualityResult } from './dataQuality';

/**
 * OHLCV backfill: fetch daily history for an instrument, score it through the
 * DataQualityService, and persist the candles. Storage is NOT gated on
 * quality — history is stored as-is and the score is recorded/logged; the
 * *factor run* is what skips a low-quality instrument (docs ADR-0005). Persist
 * is an upsert per (instrument, date), so re-running is idempotent and
 * append-only (existing rows refresh in place, nothing is deleted).
 */

const UPSERT_SLICE_SIZE = 200;
/** Angel accepts "YYYY-MM-DD HH:mm" in IST; times bound a daily range. */
const FROM_TIME = '09:15';
const TO_TIME = '15:30';

export type BackfillResult = {
  instrumentId: string;
  symbol: string;
  fetched: number;
  persisted: number;
  quality: DataQualityResult;
};

const persistCandles = async (instrumentId: string, candles: Candle[]): Promise<number> => {
  for (let i = 0; i < candles.length; i += UPSERT_SLICE_SIZE) {
    const slice = candles.slice(i, i + UPSERT_SLICE_SIZE);
    await prisma.$transaction(
      slice.map((c) => {
        const tradeDate = new Date(`${c.tradeDate}T00:00:00Z`);
        const data = {
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
        return prisma.ohlcv.upsert({
          where: { instrumentId_tradeDate: { instrumentId, tradeDate } },
          update: data,
          create: { instrumentId, tradeDate, ...data },
        });
      }),
    );
  }
  return candles.length;
};

/**
 * Backfills up to `days` of daily history for one instrument as of `asOf`
 * (default: now). Returns fetch/persist counts and the quality report.
 */
export const backfillInstrument = async (
  instrument: Instrument,
  days: number,
  asOf: Date = new Date(),
): Promise<BackfillResult> => {
  const to = dayjs(asOf);
  const from = to.subtract(days, 'day');

  const candles = await fetchCandles({
    exchange: instrument.exchSeg,
    symbolToken: instrument.token,
    interval: 'ONE_DAY',
    fromDate: `${from.format('YYYY-MM-DD')} ${FROM_TIME}`,
    toDate: `${to.format('YYYY-MM-DD')} ${TO_TIME}`,
  });

  const quality = assessDataQuality(candles, to.format('YYYY-MM-DD'));
  const persisted = await persistCandles(instrument.id, candles);

  logger.info(
    `[OHLCV]: ${instrument.symbol} (${instrument.exchSeg}) fetched ${candles.length}, ` +
      `persisted ${persisted}, quality ${quality.score}` +
      (quality.warnings.length ? ` — ${quality.warnings.join('; ')}` : ''),
  );

  return {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    fetched: candles.length,
    persisted,
    quality,
  };
};

/** Backfills several instruments in sequence, paced for the ~3 req/sec limit. */
export const backfillInstruments = async (
  instruments: Instrument[],
  days: number,
  asOf: Date = new Date(),
): Promise<BackfillResult[]> => {
  const results: BackfillResult[] = [];
  for (const instrument of instruments) {
    results.push(await backfillInstrument(instrument, days, asOf));
    // ~3 req/sec ceiling on the historical API — pace between instruments.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return results;
};

/** Pace between historical requests to respect the ~3 req/sec limit. */
const PACING_MS = 350;

export type IncrementalResult = {
  instrumentId: string;
  symbol: string;
  /** Candles upserted this run (includes the re-fetched last day). */
  upserted: number;
  /** Malformed candles dropped before persistence. */
  skippedMalformed: number;
  /** Newest stored trade date after the run (ISO date), or null if none. */
  latestDate: string | null;
};

/**
 * Brings one instrument current: fetches from its last stored candle up to
 * `asOf` and upserts. Re-fetching the last stored day is intentional — a
 * candle first captured mid-session is corrected to its finalized values.
 * With no history yet, seeds `fallbackDays` of it. Malformed rows are dropped
 * at the boundary so the ohlcv store stays clean.
 */
export const incrementalUpdate = async (
  instrument: Instrument,
  asOf: Date = new Date(),
  fallbackDays = 300,
): Promise<IncrementalResult> => {
  const last = await prisma.ohlcv.findFirst({
    where: { instrumentId: instrument.id },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });

  const to = dayjs(asOf);
  const from = last ? dayjs(last.tradeDate) : to.subtract(fallbackDays, 'day');

  const candles = await fetchCandles({
    exchange: instrument.exchSeg,
    symbolToken: instrument.token,
    interval: 'ONE_DAY',
    fromDate: `${from.format('YYYY-MM-DD')} ${FROM_TIME}`,
    toDate: `${to.format('YYYY-MM-DD')} ${TO_TIME}`,
  });

  const valid = candles.filter(isValidCandle);
  const upserted = await persistCandles(instrument.id, valid);
  const latestDate =
    valid.reduce<string | null>((max, c) => (max && max >= c.tradeDate ? max : c.tradeDate), null) ??
    (last ? dayjs(last.tradeDate).format('YYYY-MM-DD') : null);

  const skippedMalformed = candles.length - valid.length;
  logger.info(
    `[OHLCV]: ${instrument.symbol} incremental — ${upserted} candle(s) upserted from ` +
      `${from.format('YYYY-MM-DD')}` +
      (skippedMalformed ? `, ${skippedMalformed} malformed skipped` : ''),
  );

  return { instrumentId: instrument.id, symbol: instrument.symbol, upserted, skippedMalformed, latestDate };
};

/**
 * Nightly incremental job: refreshes every instrument that already has candle
 * history, keeping the research OHLCV store current. Instruments without any
 * history are ignored — seed them with `backfill:ohlcv` first. Each failure is
 * isolated so one bad instrument never aborts the run.
 */
export const runOhlcvIncremental = async (asOf: Date = new Date()): Promise<IncrementalResult[]> => {
  if (!hasAngelOneCredentials()) {
    logger.warn('[OHLCV]: incremental skipped — Angel One credentials not set');
    return [];
  }

  const withHistory = await prisma.ohlcv.findMany({
    distinct: ['instrumentId'],
    select: { instrumentId: true },
  });
  if (!withHistory.length) {
    logger.warn('[OHLCV]: incremental — no candle history yet; run "bun run backfill:ohlcv" first');
    return [];
  }

  const instruments = await prisma.instrument.findMany({
    where: { id: { in: withHistory.map((r) => r.instrumentId) } },
    orderBy: { name: 'asc' },
  });

  const results: IncrementalResult[] = [];
  for (const instrument of instruments) {
    try {
      results.push(await incrementalUpdate(instrument, asOf));
    } catch (err) {
      logger.error(
        `[OHLCV]: incremental failed for ${instrument.symbol}: ${err instanceof Error ? err.message : err}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, PACING_MS));
  }

  logger.info(`[OHLCV]: incremental complete — ${results.length}/${instruments.length} instrument(s) updated`);
  return results;
};
