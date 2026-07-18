import { describe, expect, test } from 'bun:test';

import { makeExpandingFolds, pickBest } from './walkForward';

describe('makeExpandingFolds', () => {
  test('produces contiguous test windows covering the OOS stretch, with expanding train', () => {
    const folds = makeExpandingFolds(205, 544, 3);
    expect(folds).toHaveLength(3);
    // train always starts at warmup and expands to each test start
    for (const f of folds) {
      expect(f.trainFrom).toBe(205);
      expect(f.trainTo).toBe(f.testFrom);
      expect(f.testTo).toBeGreaterThan(f.testFrom);
    }
    // test windows are contiguous
    expect(folds[0]!.testTo).toBe(folds[1]!.testFrom);
    expect(folds[1]!.testTo).toBe(folds[2]!.testFrom);
    // last fold runs to the end
    expect(folds[2]!.testTo).toBe(544);
    // train expands
    expect(folds[2]!.trainTo).toBeGreaterThan(folds[0]!.trainTo);
  });

  test('degenerate inputs yield no folds', () => {
    expect(makeExpandingFolds(205, 207, 3)).toEqual([]); // span 2 < nFolds+1 → testSize 0
    expect(makeExpandingFolds(205, 544, 0)).toEqual([]);
  });

  test('embargo (B8.3) ends train before the test window; test windows unchanged', () => {
    const plain = makeExpandingFolds(205, 544, 3);
    const embargoed = makeExpandingFolds(205, 544, 3, 10);
    expect(embargoed).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      // Train ends 10 trading days before the test starts (the leakage gap).
      expect(embargoed[i]!.trainTo).toBe(embargoed[i]!.testFrom - 10);
      // Test windows are byte-identical to the un-embargoed scheme — the OOS
      // concatenation is unaffected.
      expect(embargoed[i]!.testFrom).toBe(plain[i]!.testFrom);
      expect(embargoed[i]!.testTo).toBe(plain[i]!.testTo);
    }
  });

  test('embargo never pushes train below the warmup start', () => {
    const folds = makeExpandingFolds(205, 220, 1, 50); // testFrom 212, embargo > span
    expect(folds[0]!.trainTo).toBe(205); // clamped to trainFrom
  });
});

describe('pickBest', () => {
  test('selects the highest-value label', () => {
    expect(pickBest([{ label: 'a', value: -0.2 }, { label: 'b', value: 0.1 }, { label: 'c', value: -0.5 }])).toBe('b');
  });

  test('first wins ties (deterministic)', () => {
    expect(pickBest([{ label: 'a', value: 1 }, { label: 'b', value: 1 }])).toBe('a');
  });
});
