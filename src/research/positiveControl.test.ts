import { describe, expect, test } from 'bun:test';

import { momentum12_1, reversal5d } from './positiveControl';

describe('momentum12_1', () => {
  test('null until 253 bars of history exist', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i);
    expect(momentum12_1(closes, 251)).toBeNull();
    expect(momentum12_1(closes, 252)).not.toBeNull();
  });

  test('is the return from t-252 to t-21 (skips the most recent month)', () => {
    const closes = new Array(300).fill(0).map((_, i) => 100);
    closes[300 - 1 - 21] = 132; // close[t-21]
    closes[300 - 1 - 252] = 120; // close[t-252]
    expect(momentum12_1(closes, 299)).toBeCloseTo(132 / 120 - 1, 9);
  });

  test('guards a non-positive denominator', () => {
    const closes = new Array(300).fill(100);
    closes[299 - 252] = 0;
    expect(momentum12_1(closes, 299)).toBeNull();
  });
});

describe('reversal5d', () => {
  test('null until 6 bars exist; else prior 5-day return', () => {
    const closes = [100, 101, 102, 103, 104, 110];
    expect(reversal5d(closes, 4)).toBeNull();
    expect(reversal5d(closes, 5)).toBeCloseTo(110 / 100 - 1, 9);
  });
});
