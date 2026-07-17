import { describe, expect, test } from 'bun:test';

import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';
import { aliasCoverage, mapArticleSymbols } from './symbolMapper';

describe('mapArticleSymbols — positive matches', () => {
  test('matches a company by its name', () => {
    expect(mapArticleSymbols('Infosys Q1 profit rises 8%').symbols).toEqual(['INFY']);
  });

  test('matches multiple companies in one headline, in universe order', () => {
    const s = mapArticleSymbols('HDFC Bank and ICICI Bank lead Nifty higher').symbols;
    expect(s).toEqual(['HDFCBANK', 'ICICIBANK']);
  });

  test('word-boundary/possessive tolerance', () => {
    expect(mapArticleSymbols("Airtel's ARPU climbs").symbols).toEqual(['BHARTIARTL']);
  });

  test('disambiguates within a business group', () => {
    expect(mapArticleSymbols('Tata Steel raises output guidance').symbols).toEqual(['TATASTEEL']);
    expect(mapArticleSymbols('Tata Power commissions solar plant').symbols).toEqual(['TATAPOWER']);
  });
});

describe('mapArticleSymbols — precision guards (conservative)', () => {
  test('bare group words do not tag any member', () => {
    expect(mapArticleSymbols('Adani stocks rally on news').symbols).toEqual([]);
    expect(mapArticleSymbols('Tata group in focus today').symbols).toEqual([]);
    expect(mapArticleSymbols('Bajaj twins gain').symbols).toEqual([]);
  });

  test('bare tickers that collide with English words are not matched', () => {
    // OIL / SAIL / TITAN / TRENT tickers must not fire on the common word.
    expect(mapArticleSymbols('Cooking oil prices ease this month').symbols).toEqual([]);
    expect(mapArticleSymbols('The trend in markets is up').symbols).toEqual([]);
  });

  test('no substring false positives', () => {
    // "cipla" must not match inside an unrelated longer token.
    expect(mapArticleSymbols('principal amount discussed').symbols).toEqual([]);
  });
});

describe('aliasCoverage', () => {
  test('every universe symbol has at least one alias, and no alias keys are typos', () => {
    const { uncovered, unknownAliasKeys } = aliasCoverage();
    expect(uncovered).toEqual([]);
    expect(unknownAliasKeys).toEqual([]);
  });

  test('universe is the expected size (~166)', () => {
    expect(EQUITY_UNIVERSE.length).toBeGreaterThanOrEqual(150);
  });
});
