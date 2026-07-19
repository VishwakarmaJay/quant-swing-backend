import { describe, expect, test } from 'bun:test';

import { SentimentFactor } from './sentimentFactor';
import { FactorCategory, type StockContext, type SentimentArticleInput } from './types';

const factor = new SentimentFactor();

const ctx = (articles: SentimentArticleInput[] | null | undefined): StockContext => ({
  symbol: 'TEST',
  asOf: '2026-07-19',
  candles: [],
  dataQualityScore: 1,
  sentiment: articles === undefined ? undefined : articles === null ? null : { articles },
});

const art = (over: Partial<SentimentArticleInput> = {}): SentimentArticleInput => ({
  ageDays: 0,
  score: 0,
  neutralProb: 0,
  ...over,
});

describe('SentimentFactor — contract', () => {
  test('name + category', () => {
    expect(factor.name).toBe('sentiment');
    expect(factor.category).toBe(FactorCategory.SENTIMENT);
  });
});

describe('SentimentFactor — neutral fallbacks (missing-data convention)', () => {
  test('absent ctx.sentiment → neutral 50, agreement 0', () => {
    const out = factor.evaluate(ctx(undefined));
    expect(out.score).toBe(50);
    expect(out.agreementContribution).toBe(0);
  });

  test('null ctx.sentiment → neutral 50', () => {
    expect(factor.evaluate(ctx(null)).score).toBe(50);
  });

  test('empty article set → neutral 50', () => {
    expect(factor.evaluate(ctx([])).score).toBe(50);
  });

  test('thin coverage (< minArticles) → neutral 50 (not forced bearish)', () => {
    const out = factor.evaluate(ctx([art({ score: 1 }), art({ score: 1 })])); // 2 < 3
    expect(out.score).toBe(50);
    expect(out.agreementContribution).toBe(0);
    expect(out.metrics.articleCount).toBe(2);
  });
});

describe('SentimentFactor — scoring', () => {
  test('strongly positive coverage → high score, positive agreement', () => {
    const out = factor.evaluate(ctx([art({ score: 0.9 }), art({ score: 0.8 }), art({ score: 1 })]));
    expect(out.score).toBeGreaterThan(80);
    expect(out.agreementContribution).toBeGreaterThan(0);
    expect(out.metrics.sentimentMean).toBeGreaterThan(0);
  });

  test('strongly negative coverage → low score, negative agreement', () => {
    const out = factor.evaluate(ctx([art({ score: -0.9 }), art({ score: -0.8 }), art({ score: -1 })]));
    expect(out.score).toBeLessThan(20);
    expect(out.agreementContribution).toBeLessThan(0);
  });

  test('agreement is (score − 50) / 50', () => {
    const out = factor.evaluate(ctx([art({ score: 1 }), art({ score: 1 }), art({ score: 1 })]));
    expect(out.score).toBe(100);
    expect(out.agreementContribution).toBe(1);
  });

  test('exposes article count + freshest age metrics', () => {
    const out = factor.evaluate(ctx([art({ score: 1, ageDays: 3 }), art({ score: 1, ageDays: 1 }), art({ score: 1, ageDays: 5 })]));
    expect(out.metrics.articleCount).toBe(3);
    expect(out.metrics.freshestAgeDays).toBe(1);
  });

  test('deterministic — same input, byte-identical output', () => {
    const arts = [art({ score: 0.6, ageDays: 2 }), art({ score: -0.2, ageDays: 8 }), art({ score: 0.4, ageDays: 1 })];
    expect(factor.evaluate(ctx(arts))).toEqual(factor.evaluate(ctx([...arts])));
  });
});
