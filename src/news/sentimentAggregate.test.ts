import { describe, expect, test } from 'bun:test';

import {
  aggregateSentiment,
  sentimentInputsAsOf,
  DEFAULT_SENTIMENT_AGGREGATE_CONFIG,
  type DatedScoredArticle,
  type SentimentArticleInput,
} from './sentimentAggregate';

const art = (over: Partial<SentimentArticleInput> = {}): SentimentArticleInput => ({
  ageDays: 0,
  score: 0,
  neutralProb: 0,
  ...over,
});

describe('aggregateSentiment — score mapping', () => {
  test('all-positive fresh articles → high score (≈100 at score 1)', () => {
    const a = aggregateSentiment([art({ score: 1 }), art({ score: 1 }), art({ score: 1 })]);
    expect(a.score).toBe(100);
    expect(a.mean).toBe(1);
    expect(a.count).toBe(3);
  });

  test('all-negative → low score (≈0 at score −1)', () => {
    const a = aggregateSentiment([art({ score: -1 }), art({ score: -1 }), art({ score: -1 })]);
    expect(a.score).toBe(0);
    expect(a.mean).toBe(-1);
  });

  test('balanced pos/neg → ≈50 neutral', () => {
    const a = aggregateSentiment([art({ score: 1 }), art({ score: -1 }), art({ score: 0.5 }), art({ score: -0.5 })]);
    expect(a.score).toBeCloseTo(50, 5);
  });

  test('order-independent (determinism)', () => {
    const arts = [art({ score: 0.8, ageDays: 1 }), art({ score: -0.3, ageDays: 5 }), art({ score: 0.2, ageDays: 10 })];
    const forward = aggregateSentiment(arts);
    const reversed = aggregateSentiment([...arts].reverse());
    expect(forward).toEqual(reversed);
  });
});

describe('aggregateSentiment — recency / chase-decay', () => {
  test('a fresh positive outweighs an equally-strong old negative', () => {
    // age 0 (+1) vs age = 3×halfLife (−1): fresh dominates → score > 50.
    const hl = DEFAULT_SENTIMENT_AGGREGATE_CONFIG.halfLifeDays;
    const a = aggregateSentiment([art({ score: 1, ageDays: 0 }), art({ score: -1, ageDays: 3 * hl }), art({ score: 1, ageDays: 0 })]);
    expect(a.score!).toBeGreaterThan(50);
  });

  test('half-life halves an article weight', () => {
    // one fresh +1, one −1 at exactly one half-life: weights 1 vs 0.5 →
    // mean = (1·1 + 0.5·(−1)) / (1 + 0.5) = 0.5/1.5 = 0.3333.
    const hl = DEFAULT_SENTIMENT_AGGREGATE_CONFIG.halfLifeDays;
    const a = aggregateSentiment(
      [art({ score: 1, ageDays: 0 }), art({ score: -1, ageDays: hl }), art({ score: 1, ageDays: 0 })],
      { ...DEFAULT_SENTIMENT_AGGREGATE_CONFIG, minArticles: 3 },
    );
    // three articles: +1@0, +1@0, −1@hl → (1+1−0.5)/(1+1+0.5) = 1.5/2.5 = 0.6
    expect(a.mean).toBeCloseTo(0.6, 4);
  });

  test('articles beyond the window are excluded', () => {
    const w = DEFAULT_SENTIMENT_AGGREGATE_CONFIG.windowDays;
    const a = aggregateSentiment([
      art({ score: 1, ageDays: 1 }),
      art({ score: 1, ageDays: 2 }),
      art({ score: 1, ageDays: 3 }),
      art({ score: -1, ageDays: w + 5 }), // out of window — ignored
    ]);
    expect(a.count).toBe(3);
    expect(a.score).toBe(100);
  });
});

describe('aggregateSentiment — confidence weighting', () => {
  test('a decisive article outweighs a near-neutral one of opposite sign', () => {
    // +0.9 with low neutral vs −0.9 with high neutral → net positive.
    const a = aggregateSentiment([
      art({ score: 0.9, neutralProb: 0.05 }),
      art({ score: -0.9, neutralProb: 0.9 }),
      art({ score: 0.9, neutralProb: 0.05 }),
    ]);
    expect(a.score!).toBeGreaterThan(50);
  });

  test('fully-neutral articles contribute count but no weight → null (no info)', () => {
    const a = aggregateSentiment([
      art({ score: 0, neutralProb: 1 }),
      art({ score: 0, neutralProb: 1 }),
      art({ score: 0, neutralProb: 1 }),
    ]);
    expect(a.score).toBeNull();
    expect(a.count).toBe(3);
    expect(a.weight).toBe(0);
  });
});

describe('aggregateSentiment — thin-coverage / edge cases', () => {
  test('below minArticles → null (neutral, not forced 50)', () => {
    const a = aggregateSentiment([art({ score: 1 }), art({ score: 1 })]); // 2 < default 3
    expect(a.score).toBeNull();
    expect(a.count).toBe(2);
  });

  test('empty input → null, zero counts', () => {
    const a = aggregateSentiment([]);
    expect(a.score).toBeNull();
    expect(a.count).toBe(0);
    expect(a.weight).toBe(0);
    expect(a.freshestAgeDays).toBeNull();
  });

  test('NaN / negative ageDays are skipped defensively', () => {
    const a = aggregateSentiment([
      art({ score: 1, ageDays: Number.NaN }),
      art({ score: 1, ageDays: -1 }),
      art({ score: 1, ageDays: 0 }),
    ]);
    expect(a.count).toBe(1); // only the valid one
    expect(a.score).toBeNull(); // 1 < minArticles
  });

  test('scores are clamped to [−1, 1]', () => {
    const a = aggregateSentiment([art({ score: 5 }), art({ score: 5 }), art({ score: 5 })]);
    expect(a.mean).toBe(1);
    expect(a.score).toBe(100);
  });

  test('freshestAgeDays is the minimum contributing age', () => {
    const a = aggregateSentiment([art({ score: 1, ageDays: 4 }), art({ score: 1, ageDays: 2 }), art({ score: 1, ageDays: 9 })]);
    expect(a.freshestAgeDays).toBe(2);
  });
});

describe('sentimentInputsAsOf — point-in-time (NO LOOKAHEAD)', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
  const rec = (iso: string, score = 0.5, neutralProb = 0): DatedScoredArticle => ({
    availableAtMs: new Date(`${iso}Z`).getTime(),
    score,
    neutralProb,
  });
  const asOf = day('2026-07-19');

  test('an article available AFTER asOf is excluded (the lookahead guard)', () => {
    const got = sentimentInputsAsOf(
      [rec('2026-07-18T10:00:00'), rec('2026-07-19T10:00:00') /* same day, after midnight cutoff */, rec('2026-07-20T09:00:00')],
      asOf,
      30,
    );
    expect(got).toHaveLength(1); // only the 07-18 one is ≤ asOf-midnight
  });

  test('window lower bound is exclusive; ageDays is exact', () => {
    const got = sentimentInputsAsOf(
      [rec('2026-07-12T00:00:00') /* exactly 7d old */, rec('2026-06-19T00:00:00') /* 30d — on/over the edge */],
      asOf,
      30,
    );
    expect(got.map((g) => g.ageDays)).toEqual([7]); // the 30-days-prior boundary row is excluded (<=)
  });

  test('empty when nothing is in range', () => {
    expect(sentimentInputsAsOf([rec('2026-07-25T00:00:00')], asOf, 30)).toEqual([]);
  });

  test('feeds aggregateSentiment end-to-end (fresh positive → high score)', () => {
    const inputs = sentimentInputsAsOf(
      [rec('2026-07-18T12:00:00', 1), rec('2026-07-17T12:00:00', 0.9), rec('2026-07-16T12:00:00', 1)],
      asOf,
      30,
    );
    const agg = aggregateSentiment(inputs);
    expect(agg.score!).toBeGreaterThan(90);
  });
});
