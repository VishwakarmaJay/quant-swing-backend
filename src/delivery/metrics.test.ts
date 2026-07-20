import { describe, expect, test } from 'bun:test';

import { bucketByRank, surgeAsOf, volumeSurgeAsOf, type DeliveryPoint } from './metrics';

const series = (pcts: number[], qtys?: number[]): DeliveryPoint[] =>
  pcts.map((p, i) => ({
    tradeDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
    deliveryPct: p,
    tradedQty: qtys?.[i] ?? 1000,
  }));

describe('surgeAsOf', () => {
  test('is the ratio of today to the trailing baseline', () => {
    // 20 days at 30%, then a day at 60% → surge 2.0.
    const s = series([...Array(20).fill(30), 60]);
    expect(surgeAsOf(s, 20, 20)).toBeCloseTo(2, 6);
  });

  test('1.0 means "normal for this stock" regardless of the absolute level', () => {
    // A structurally high-delivery name at its own baseline is NOT a signal.
    const high = series([...Array(20).fill(70), 70]);
    const low = series([...Array(20).fill(20), 20]);
    expect(surgeAsOf(high, 20, 20)).toBeCloseTo(1, 6);
    expect(surgeAsOf(low, 20, 20)).toBeCloseTo(1, 6);
  });

  test('EXCLUDES the as-of day from its own baseline (no self-reference)', () => {
    const s = series([...Array(20).fill(10), 100]);
    // Baseline is the 20 prior days (10), not 21 days including today.
    expect(surgeAsOf(s, 20, 20)).toBeCloseTo(10, 6);
  });

  test('returns null without a full baseline — never a partial-window guess', () => {
    const s = series([...Array(10).fill(30)]);
    expect(surgeAsOf(s, 5, 20)).toBeNull();
    expect(surgeAsOf(s, 9, 20)).toBeNull();
  });

  test('returns null past the end of the series and on a zero baseline', () => {
    const s = series([...Array(20).fill(30), 40]);
    expect(surgeAsOf(s, 99, 20)).toBeNull();
    expect(surgeAsOf(series([...Array(20).fill(0), 40]), 20, 20)).toBeNull();
  });
});

describe('volumeSurgeAsOf', () => {
  test('separates a real delivery surge from one caused by collapsing volume', () => {
    // Delivery % doubles, but volume also collapsed to a tenth: not accumulation.
    const s = series([...Array(20).fill(30), 60], [...Array(20).fill(10_000), 1_000]);
    expect(surgeAsOf(s, 20, 20)).toBeCloseTo(2, 6);
    expect(volumeSurgeAsOf(s, 20, 20)).toBeCloseTo(0.1, 6);
  });
});

describe('bucketByRank', () => {
  test('splits into equal-count buckets, lowest value in bucket 0', () => {
    const items = [5, 1, 9, 3, 7]; // n=5, 5 buckets → one each
    const b = bucketByRank(items, (x) => x, 5);
    expect(b.get(1)).toBe(0);
    expect(b.get(9)).toBe(4);
  });

  test('deciles over a larger set put the top 10% in the last bucket', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const b = bucketByRank(items, (x) => x, 10);
    expect(b.get(0)).toBe(0);
    expect(b.get(99)).toBe(9);
    expect(b.get(50)).toBe(5);
    const counts = new Map<number, number>();
    for (const v of b.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
    expect([...counts.values()].every((c) => c === 10)).toBe(true);
  });

  test('is deterministic on ties (input order breaks them)', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const b1 = bucketByRank(items, () => 1, 2);
    const b2 = bucketByRank(items, () => 1, 2);
    expect(items.map((i) => b1.get(i))).toEqual(items.map((i) => b2.get(i)));
  });

  test('empty input is safe', () => {
    expect(bucketByRank([], (x: number) => x, 10).size).toBe(0);
  });
});
