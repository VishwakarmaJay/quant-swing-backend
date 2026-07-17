import { describe, expect, test } from 'bun:test';

import { isDuplicateTitle, jaccard, normalizeTitle, titleTokens } from './dedupe';

describe('normalizeTitle', () => {
  test('lowercases, strips punctuation, collapses whitespace, keeps &', () => {
    expect(normalizeTitle('  Reliance Industries: Q1  Profit up 8%! ')).toBe('reliance industries q1 profit up 8');
    expect(normalizeTitle('Tata & Sons')).toBe('tata & sons');
  });
});

describe('titleTokens', () => {
  test('drops stopwords and single-char tokens', () => {
    // 'the', 'of', 'is', 'up' are all stopwords; 'a' is single-char.
    expect([...titleTokens('The profit a of Infosys is up')]).toEqual(['profit', 'infosys']);
  });
});

describe('jaccard', () => {
  test('identical sets → 1, disjoint → 0', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });
  test('both empty → 0 (no false positive)', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
  test('partial overlap', () => {
    // {a,b,c} vs {b,c,d}: inter 2, union 4 → 0.5
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(0.5);
  });
});

describe('isDuplicateTitle', () => {
  const corpus = ['Infosys Q1 profit rises 8 percent', 'NTPC commissions new unit'];

  test('exact normalized match is a duplicate', () => {
    expect(isDuplicateTitle('infosys q1 profit rises 8 percent', corpus)).toBe(true);
  });

  test('near-duplicate (syndicated rewrite) over threshold is a duplicate', () => {
    expect(isDuplicateTitle('Infosys Q1 profit rises 8 percent YoY', corpus)).toBe(true);
  });

  test('unrelated headline is not a duplicate', () => {
    expect(isDuplicateTitle('Reliance announces buyback', corpus)).toBe(false);
  });

  test('threshold is honoured', () => {
    // Small overlap should not dup at a high threshold.
    expect(isDuplicateTitle('Infosys signs cloud deal', corpus, 0.9)).toBe(false);
  });
});
