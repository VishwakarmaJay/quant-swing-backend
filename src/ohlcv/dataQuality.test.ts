import { describe, expect, test } from 'bun:test';

import type { Candle } from './candleClient';
import { assessDataQuality, DEFAULT_DQ_OPTIONS } from './dataQuality';

/**
 * DataQualityService is pure and deterministic — the first unit test in the
 * project, establishing the pattern the docs mandate (golden/determinism come
 * later). Fixtures are built on consecutive weekdays so a clean series has
 * full continuity.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `count` valid candles on consecutive weekdays, the newest on `endIso`. */
const makeCandles = (count: number, endIso: string): Candle[] => {
  const candles: Candle[] = [];
  let t = new Date(`${endIso}T00:00:00Z`).getTime();
  while (candles.length < count) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) {
      candles.push({ tradeDate: iso(new Date(t)), open: 100, high: 105, low: 98, close: 102, volume: 0 });
    }
    t -= MS_PER_DAY;
  }
  return candles.reverse();
};

describe('assessDataQuality', () => {
  test('empty series scores 0', () => {
    const result = assessDataQuality([], '2026-07-16');
    expect(result.score).toBe(0);
    expect(result.warnings).toContain('no candles');
  });

  test('clean, current, full-length series scores ~1', () => {
    const candles = makeCandles(250, '2026-07-16');
    const result = assessDataQuality(candles, '2026-07-16');
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.metrics.malformed).toBe(0);
    expect(result.metrics.continuity).toBeCloseTo(1, 1);
    expect(result.warnings).toHaveLength(0);
  });

  test('flags a malformed candle (high < low)', () => {
    const candles = makeCandles(250, '2026-07-16');
    candles[10] = { ...candles[10]!, high: 90, low: 110 };
    const result = assessDataQuality(candles, '2026-07-16');
    expect(result.metrics.malformed).toBe(1);
    expect(result.warnings.join()).toContain('malformed');
  });

  test('penalizes a stale series below the gate', () => {
    // Newest candle ~30 days before asOf.
    const candles = makeCandles(250, '2026-06-16');
    const result = assessDataQuality(candles, '2026-07-16');
    expect(result.metrics.stalenessDays).toBeGreaterThan(DEFAULT_DQ_OPTIONS.maxStalenessDays);
    expect(result.score).toBeLessThan(0.8);
    expect(result.warnings.join()).toContain('stale');
  });

  test('penalizes too-short history', () => {
    const candles = makeCandles(50, '2026-07-16');
    const result = assessDataQuality(candles, '2026-07-16');
    expect(result.score).toBeLessThan(0.8);
    expect(result.warnings.join()).toContain('50 candles');
  });
});
