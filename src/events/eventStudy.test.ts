import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';

import { anchorIndex, cellStats, measureEvent } from './eventStudy';

const series = (closes: number[], startDay = 1): Candle[] =>
  closes.map((c, i) => {
    const d = `2026-03-${String(startDay + i).padStart(2, '0')}`;
    return { tradeDate: d, open: c, high: c, low: c, close: c, volume: 100 };
  });

describe('anchorIndex — the no-lookahead contract', () => {
  const candles = series([100, 101, 102, 103]); // 2026-03-01 … 03-04

  test('anchors at the first close STRICTLY AFTER the as-of date', () => {
    // Event disseminated during 03-02 → only tradeable from the 03-03 close.
    expect(anchorIndex(candles, new Date('2026-03-02T14:00:00Z'))).toBe(2);
  });

  test('an event late on a trading day does NOT get that day’s close', () => {
    const sameDay = anchorIndex(candles, new Date('2026-03-02T23:59:59Z'));
    expect(candles[sameDay]!.tradeDate).toBe('2026-03-03');
  });

  test('returns -1 when the event is at/after the end of the series', () => {
    expect(anchorIndex(candles, new Date('2026-03-04T10:00:00Z'))).toBe(-1);
  });
});

describe('measureEvent', () => {
  test('excess return is stock move minus benchmark move over the same window', () => {
    // Stock: 100 → 110 over 1 day (+10%). Benchmark: 200 → 204 (+2%). Excess +8%.
    const candles = series([100, 100, 110, 110, 110]);
    const bench = new Map(candles.map((c, i) => [c.tradeDate, i >= 2 ? 204 : 200]));
    const out = measureEvent(candles, bench, new Date('2026-03-01T10:00:00Z'));
    expect(out).not.toBeNull();
    expect(out!.excessByHorizon[1]).toBeCloseTo(8, 6);
  });

  test('returns null when the event has no tradeable candle after it', () => {
    const candles = series([100, 101]);
    expect(measureEvent(candles, new Map(), new Date('2026-03-05T10:00:00Z'))).toBeNull();
  });

  test('horizons beyond the available series are omitted, not zero-filled', () => {
    const candles = series([100, 101, 102]); // only 1 forward bar past the anchor
    const bench = new Map(candles.map((c) => [c.tradeDate, 100]));
    const out = measureEvent(candles, bench, new Date('2026-03-01T10:00:00Z'));
    expect(out!.excessByHorizon[1]).toBeDefined();
    expect(out!.excessByHorizon[5]).toBeUndefined(); // absent, not 0 — n stays honest
  });
});

describe('cellStats', () => {
  test('reports mean, CI, hit rate and BOTH tails', () => {
    const s = cellStats([-5, -1, 0.5, 2, 20]);
    expect(s.n).toBe(5);
    expect(s.meanExcess).toBeCloseTo(3.3, 6);
    expect(s.hitRatePct).toBeCloseTo(60, 6); // 3 of 5 positive
    expect(s.p90).toBeGreaterThan(s.p10);
    expect(s.ci95[0]).toBeLessThan(s.meanExcess);
    expect(s.ci95[1]).toBeGreaterThan(s.meanExcess);
  });

  test('a wide CI spanning zero is the signal that n does not support the mean', () => {
    const s = cellStats([-20, 25, -18, 22]); // big mean-ish swings, tiny n
    expect(s.ci95[0]).toBeLessThan(0);
    expect(s.ci95[1]).toBeGreaterThan(0);
  });

  test('a flat mean can still hide a fat right tail — the whole point of B12', () => {
    // 17 small losses + 3 big wins: mean is a shrug (+0.45), but the top decile
    // pays +20. Mean-only reporting would discard exactly the thing we're hunting.
    const s = cellStats([...Array(17).fill(-3), 20, 20, 20]);
    expect(s.meanExcess).toBeLessThan(1);
    expect(s.p90).toBeGreaterThan(10);
    expect(s.hitRatePct).toBeCloseTo(15, 6);
  });

  test('empty input is safe', () => {
    expect(cellStats([]).n).toBe(0);
  });
});
