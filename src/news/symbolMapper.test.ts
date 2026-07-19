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

  test('ALIAS_EXCLUSIONS: bare "sbi" does not fire on SBI-group subsidiaries', () => {
    // The exact failure cases from the first live precision sample (2026-07-18).
    expect(mapArticleSymbols('SBI Life Insurance 26th Annual General Meeting').symbols).toEqual(['SBILIFE']);
    expect(mapArticleSymbols('SBI Funds Management IPO allotment today').symbols).toEqual([]);
    expect(mapArticleSymbols('SBI Capital Markets among book runners for NLC IPO').symbols).toEqual([]);
    expect(mapArticleSymbols('SBI Cards Q1 net profit rises').symbols).toEqual(['SBICARD']);
    // …while genuine State Bank of India mentions still match.
    expect(mapArticleSymbols('SBI raises lending rates by 25 bps').symbols).toEqual(['SBIN']);
    expect(mapArticleSymbols("SBI's Q1 profit beats estimates").symbols).toEqual(['SBIN']);
    expect(mapArticleSymbols('State Bank of India board approves fundraise').symbols).toEqual(['SBIN']);
  });

  test('homonym guards (S2): foreign homonyms blocked, real companies still map', () => {
    // The exact false positives from the GDELT audit (2026-07-19) — blocked.
    expect(mapArticleSymbols('A55 Britannia Bridge closed due to Storm Éowyn').symbols).toEqual([]);
    expect(mapArticleSymbols('New Netflix shows filmed in Britannia Beach').symbols).toEqual([]);
    expect(mapArticleSymbols('Britannia Stand Co-opted - Ipswich Town News').symbols).toEqual([]);
    // (A quoted "'Lupin'" title is caught by S3's domain filter; the exclusion
    // handles the un-quoted homonym-word-follows case.)
    expect(mapArticleSymbols('Lupin series review: Omar Sy returns as the thief').symbols).toEqual([]);
    expect(mapArticleSymbols('Colgate Rochester Crozer Divinity School relocates').symbols).toEqual([]);
    expect(mapArticleSymbols('Letitia James indicted on federal bank fraud charges').symbols).toEqual([]);
    // …while the real Indian companies still map (the disambiguating word only
    // ever follows the homonym, never the company).
    expect(mapArticleSymbols('Britannia Q1 FY26 net profit rises').symbols).toEqual(['BRITANNIA']);
    expect(mapArticleSymbols('Accumulate Britannia Industries; target Rs 5229').symbols).toEqual(['BRITANNIA']);
    expect(mapArticleSymbols('Lupin receives USFDA nod for Nagpur facility').symbols).toEqual(['LUPIN']);
    expect(mapArticleSymbols('Colgate-Palmolive India Q2 profit falls 17%').symbols).toEqual(['COLPAL']);
    expect(mapArticleSymbols('Federal Bank net profit up 13.7% on higher NII').symbols).toEqual(['FEDERALBNK']);
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
