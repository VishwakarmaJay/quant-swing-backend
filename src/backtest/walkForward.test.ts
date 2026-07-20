import { describe, expect, test } from 'bun:test';

import { makeAnchoredFolds, makeExpandingFolds, pickBest } from './walkForward';

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

  test('anchored folds (B9): test era starts at the anchor, train still expands from warmup', () => {
    const folds = makeAnchoredFolds(205, 700, 1000, 4, 10);
    expect(folds).toHaveLength(4);
    // First test window starts exactly at the anchor; windows are contiguous to the end.
    expect(folds[0]!.testFrom).toBe(700);
    for (let i = 1; i < 4; i++) expect(folds[i]!.testFrom).toBe(folds[i - 1]!.testTo);
    expect(folds[3]!.testTo).toBe(1000);
    for (const f of folds) {
      expect(f.trainFrom).toBe(205); // all history usable for selection
      expect(f.trainTo).toBe(f.testFrom - 10); // embargo respected
    }
  });

  test('anchored folds: degenerate inputs yield no folds', () => {
    expect(makeAnchoredFolds(205, 998, 1000, 4)).toEqual([]); // span 2 → testSize 0
    expect(makeAnchoredFolds(205, 1000, 700, 3)).toEqual([]); // anchor beyond total
    expect(makeAnchoredFolds(205, 210, 1000, 3, 10)).toEqual([]); // anchor inside warmup+embargo
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
