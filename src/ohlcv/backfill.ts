import dayjs from 'dayjs';

import type { Instrument } from '@generated/prisma/client';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { fetchCandles, type Candle } from './candleClient';
import { assessDataQuality, type DataQualityResult } from './dataQuality';

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
