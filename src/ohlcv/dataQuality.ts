import type { Candle } from './candleClient';

/**
 * DataQualityService (docs ADR-0005): factors must never see bad data. This is
 * the single choke point that scores a candle series before it feeds the
 * factor layer. Pure and deterministic — same input → same score — so it is
 * unit-testable and safe to golden-test later.
 *
 * The score in [0,1] folds three independent checks; below `minScore` (0.8)
 * the instrument is skipped for the run and the warnings are logged.
 */

export type DataQualityResult = {
  /** Overall quality in [0,1]. */
  score: number;
  /** Human-readable reasons the score was reduced (empty when pristine). */
  warnings: string[];
  /** Per-check detail, useful for logging/attribution. */
  metrics: {
    total: number;
    malformed: number;
    /** present ÷ expected trading days over the covered span. */
    continuity: number;
    /** Calendar days between the last candle and asOf. */
    stalenessDays: number;
  };
};

export type DataQualityOptions = {
  /** Minimum candles needed for the longest indicator (EMA200 → 200). */
  minCandles: number;
  /** Max calendar days the latest candle may lag asOf before it's stale. */
  maxStalenessDays: number;
  /**
   * Fraction of weekdays expected to be trading days (≈ 1 − holiday ratio).
   * Normalizes continuity so a complete, gap-free series scores ~1.0 despite
   * exchange holidays. NSE/BSE run ~250 sessions across ~260 weekdays.
   */
  tradingDayFraction: number;
};

export const DEFAULT_DQ_OPTIONS: DataQualityOptions = {
  minCandles: 200,
  maxStalenessDays: 5,
  tradingDayFraction: 0.94,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const asDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/** Weekdays (Mon–Fri) between two ISO dates, inclusive. */
const weekdaysBetween = (fromIso: string, toIso: string): number => {
  const from = asDate(fromIso).getTime();
  const to = asDate(toIso).getTime();
  if (to < from) return 0;
  let count = 0;
  for (let t = from; t <= to; t += MS_PER_DAY) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
};

const isMalformed = (c: Candle): boolean =>
  !Number.isFinite(c.open) ||
  !Number.isFinite(c.high) ||
  !Number.isFinite(c.low) ||
  !Number.isFinite(c.close) ||
  c.open <= 0 ||
  c.high <= 0 ||
  c.low <= 0 ||
  c.close <= 0 ||
  c.volume < 0 ||
  c.high < c.low ||
  c.high < Math.max(c.open, c.close) ||
  c.low > Math.min(c.open, c.close);

/**
 * Scores a candle series as of `asOf` (ISO date). Assumes candles are for a
 * single instrument; sorts defensively so callers need not pre-sort.
 */
export const assessDataQuality = (
  candles: Candle[],
  asOf: string,
  options: DataQualityOptions = DEFAULT_DQ_OPTIONS,
): DataQualityResult => {
  const warnings: string[] = [];
  const total = candles.length;

  if (total === 0) {
    return {
      score: 0,
      warnings: ['no candles'],
      metrics: { total: 0, malformed: 0, continuity: 0, stalenessDays: Infinity },
    };
  }

  const sorted = [...candles].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const first = sorted[0]!.tradeDate;
  const last = sorted[total - 1]!.tradeDate;

  const malformed = sorted.filter(isMalformed).length;
  const malformedRatio = malformed / total;
  if (malformed > 0) warnings.push(`${malformed} malformed candle(s)`);

  // Continuity: present ÷ expected trading days, normalized for holidays.
  const expected = Math.max(1, weekdaysBetween(first, last) * options.tradingDayFraction);
  const continuity = Math.min(1, total / expected);
  if (continuity < 0.9) warnings.push(`continuity ${continuity.toFixed(2)} (gaps in history)`);

  if (total < options.minCandles)
    warnings.push(`only ${total} candles (< ${options.minCandles} needed)`);

  // Staleness: how far the newest candle lags asOf.
  const stalenessDays = Math.max(0, Math.round((asDate(asOf).getTime() - asDate(last).getTime()) / MS_PER_DAY));
  const stale = stalenessDays > options.maxStalenessDays;
  if (stale) warnings.push(`latest candle ${stalenessDays}d stale (> ${options.maxStalenessDays}d)`);

  // Fold the checks. Malformed and continuity scale the score; staleness and a
  // short history apply flat penalties (a fresh listing isn't "broken", just
  // not yet usable).
  let score = continuity * (1 - malformedRatio);
  if (stale) score *= 0.5;
  if (total < options.minCandles) score *= 0.5;
  score = Number(Math.max(0, Math.min(1, score)).toFixed(4));

  return { score, warnings, metrics: { total, malformed, continuity, stalenessDays } };
};
