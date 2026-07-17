import { describe, expect, test } from 'bun:test';

import { ema, emaLatest, smaLatest } from './indicators';

describe('ema', () => {
  test('is SMA-seeded, NaN before the period fills', () => {
    // period 3 over [1,2,3,4,5]: seed = SMA(1,2,3)=2; k=0.5;
    // ema[3]=(4-2)*.5+2=3; ema[4]=(5-3)*.5+3=4.
    const series = ema([1, 2, 3, 4, 5], 3);
    expect(series[0]).toBeNaN();
    expect(series[1]).toBeNaN();
    expect(series[2]).toBe(2);
    expect(series[3]).toBe(3);
    expect(series[4]).toBe(4);
  });

  test('returns all-NaN when history is shorter than the period', () => {
    expect(ema([1, 2], 5).every(Number.isNaN)).toBe(true);
  });

  test('is deterministic — identical inputs give identical output', () => {
    const values = [10, 11, 9, 12, 13, 12, 14, 15];
    expect(ema(values, 4)).toEqual(ema(values, 4));
  });
});

describe('emaLatest / smaLatest', () => {
  test('emaLatest returns the last value or null when too short', () => {
    expect(emaLatest([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(emaLatest([1, 2], 3)).toBeNull();
  });

  test('smaLatest averages the trailing window', () => {
    expect(smaLatest([2, 4, 6, 8], 2)).toBe(7);
    expect(smaLatest([1], 2)).toBeNull();
  });
});
