import { describe, expect, test } from 'bun:test';

import { blockBootstrapCI, mean } from './statistics';

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('blockBootstrapCI', () => {
  test('is deterministic for a fixed seed', () => {
    const s = Array.from({ length: 200 }, (_, i) => Math.sin(i));
    const a = blockBootstrapCI(s, mean, { reps: 1000, seed: 1 });
    const b = blockBootstrapCI(s, mean, { reps: 1000, seed: 1 });
    expect(a).toEqual(b);
  });

  test('point estimate equals the statistic on the original series', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(blockBootstrapCI(s, mean, { reps: 500 }).point).toBeCloseTo(5.5, 6);
  });

  test('CI brackets the point estimate', () => {
    const rand = mulberry32(3);
    const s = Array.from({ length: 300 }, () => rand() * 2 - 1); // mean ≈ 0
    const ci = blockBootstrapCI(s, mean, { reps: 2000, block: 20, seed: 5 });
    expect(ci.ciLow).toBeLessThanOrEqual(ci.point);
    expect(ci.ciHigh).toBeGreaterThanOrEqual(ci.point);
  });

  test('a clearly-positive series yields a CI strictly above zero', () => {
    const rand = mulberry32(9);
    const s = Array.from({ length: 400 }, () => 5 + (rand() - 0.5)); // tight around +5
    const ci = blockBootstrapCI(s, mean, { reps: 3000, block: 20, seed: 11 });
    expect(ci.ciLow).toBeGreaterThan(0);
  });

  test('a wide zero-mean series yields a CI spanning zero (neither edge nor no-edge)', () => {
    const rand = mulberry32(13);
    const s = Array.from({ length: 120 }, () => (rand() - 0.5) * 4); // noisy, mean≈0
    const ci = blockBootstrapCI(s, mean, { reps: 3000, block: 20, seed: 17 });
    expect(ci.ciLow).toBeLessThan(0);
    expect(ci.ciHigh).toBeGreaterThan(0);
  });

  test('degenerate input (n<2) → zero-width CI at the point', () => {
    expect(blockBootstrapCI([42], mean)).toMatchObject({ point: 42, ciLow: 42, ciHigh: 42 });
  });
});
