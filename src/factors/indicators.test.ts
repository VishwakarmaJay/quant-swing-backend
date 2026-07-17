import { describe, expect, test } from 'bun:test';

import { atr, ema, emaLatest, macdLatest, rsiLatest, smaLatest } from './indicators';

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

describe('rsiLatest', () => {
  test('pure gains → 100, pure losses → 0', () => {
    expect(rsiLatest([1, 2, 3], 2)).toBe(100);
    expect(rsiLatest([3, 2, 1], 2)).toBe(0);
  });

  test('balanced seed → 50 (hand-computed)', () => {
    // changes +1,-1 → avgGain=avgLoss=0.5 → RS=1 → RSI=50.
    expect(rsiLatest([1, 2, 1], 2)).toBe(50);
  });

  test("applies Wilder's smoothing past the seed (hand-computed 75)", () => {
    // seed avg 0.5/0.5; then +1 → avgGain=0.75, avgLoss=0.25 → RS=3 → RSI=75.
    expect(rsiLatest([1, 2, 1, 2], 2)).toBe(75);
  });

  test('null when history is shorter than period + 1', () => {
    expect(rsiLatest([1, 2], 2)).toBeNull();
  });
});

describe('macdLatest', () => {
  test('null when history is shorter than slow + signal − 1', () => {
    expect(macdLatest([1, 2, 3, 4, 5], 12, 26, 9)).toBeNull();
  });

  test('an accelerating series is bullish: macd > 0 and histogram > 0', () => {
    // Exponential (accelerating) growth keeps MACD rising, so the histogram
    // stays positive; a linear ramp would plateau MACD → histogram ≈ 0.
    const rising = Array.from({ length: 60 }, (_, i) => 100 * Math.pow(1.03, i));
    const macd = macdLatest(rising, 12, 26, 9)!;
    expect(macd.macd).toBeGreaterThan(0);
    expect(macd.histogram).toBeGreaterThan(0);
  });

  test('is deterministic', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5 + i);
    expect(macdLatest(values, 12, 26, 9)).toEqual(macdLatest(values, 12, 26, 9));
  });
});

describe('atr', () => {
  test('seeds from the first `period` true ranges (hand-computed)', () => {
    // TR[1]=max(11-9,|11-9|,|9-9|)=2; TR[2]=max(12-10,|12-10|,|10-10|)=2.
    // period 2 seed = (2+2)/2 = 2 at index 2.
    const highs = [10, 11, 12];
    const lows = [8, 9, 10];
    const closes = [9, 10, 11];
    const series = atr(highs, lows, closes, 2);
    expect(series[2]).toBe(2);
  });

  test("applies Wilder's smoothing past the seed (hand-computed 3.5)", () => {
    // Extra bar: TR[3]=max(15-10,|15-11|,|10-11|)=5; ATR=(2*1+5)/2=3.5.
    const highs = [10, 11, 12, 15];
    const lows = [8, 9, 10, 10];
    const closes = [9, 10, 11, 14];
    const series = atr(highs, lows, closes, 2);
    expect(series[3]).toBe(3.5);
  });

  test('all-NaN when history is shorter than period + 1', () => {
    expect(atr([1, 2], [1, 2], [1, 2], 5).every(Number.isNaN)).toBe(true);
  });
});
