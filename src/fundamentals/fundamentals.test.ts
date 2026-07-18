import { describe, expect, test } from 'bun:test';

import {
  fallbackAvailableAt,
  matchAnnouncementToQuarter,
  peAsOf,
  ttmEpsKnownBy,
  type AvailableQuarter,
} from './asOf';
import { monthLabelToPeriodEnd, parseScreenerPage } from './screenerParser';

const FIXTURE = await Bun.file(`${import.meta.dir}/__fixtures__/screener-reliance.html`).text();

describe('parseScreenerPage (real trimmed fixture)', () => {
  const page = parseScreenerPage(FIXTURE, 'consolidated');

  test('extracts the BSE scrip code from the bseindia deep link', () => {
    expect(page.bseScripCode).toBe('500325');
  });

  test('parses 12 quarters with EPS, aligned right against headers', () => {
    expect(page.quarters.length).toBe(12);
    const first = page.quarters[0]!;
    const last = page.quarters[page.quarters.length - 1]!;
    expect(first.periodEnd).toBe('2023-06-30');
    expect(last.periodEnd).toBe('2026-03-31');
    // Live-verified values at fixture time (Screener, RELIANCE consolidated).
    expect(last.epsBasic).toBe(15.48);
    expect(last.netProfit).toBe(23196);
    expect(last.sales).toBe(309468);
    for (const q of page.quarters) expect(Number.isFinite(q.epsBasic)).toBe(true);
  });

  test('parses headline ratios (Stock P/E, Market Cap present)', () => {
    expect(page.ratios['Stock P/E']).toBeGreaterThan(0);
    expect(page.ratios['Market Cap']).toBeGreaterThan(100000); // ₹ cr, RIL-sized
  });

  test('garbage input yields empty page, never throws', () => {
    const empty = parseScreenerPage('<html>nothing here</html>', 'standalone');
    expect(empty.quarters).toEqual([]);
    expect(empty.bseScripCode).toBeNull();
  });
});

describe('monthLabelToPeriodEnd', () => {
  test('maps month labels to last calendar day', () => {
    expect(monthLabelToPeriodEnd('Jun 2026')).toBe('2026-06-30');
    expect(monthLabelToPeriodEnd('Mar 2024')).toBe('2024-03-31');
    expect(monthLabelToPeriodEnd('Feb 2024')).toBe('2024-02-29'); // leap year
    expect(monthLabelToPeriodEnd('garbage')).toBeNull();
  });
});

describe('fallbackAvailableAt (SEBI deadlines)', () => {
  test('quarterly = +45d; annual (March) = +60d', () => {
    expect(fallbackAvailableAt('2026-06-30')).toBe('2026-08-14');
    expect(fallbackAvailableAt('2026-03-31')).toBe('2026-05-30');
  });
});

describe('matchAnnouncementToQuarter', () => {
  const anns = [
    { dissemAt: '2026-04-24T14:00:00', headline: 'Outcome Of The Board Meeting' },
    { dissemAt: '2026-07-17T18:00:00', headline: 'Q1 Results' },
    { dissemAt: '2026-01-16T18:00:00', headline: 'Q3 Results' },
  ];

  test('picks the earliest announcement within the window after periodEnd', () => {
    expect(matchAnnouncementToQuarter('2026-03-31', anns)?.dissemAt).toBe('2026-04-24T14:00:00');
    expect(matchAnnouncementToQuarter('2026-06-30', anns)?.dissemAt).toBe('2026-07-17T18:00:00');
  });

  test('an announcement before/at periodEnd never matches (no lookahead inversion)', () => {
    // The Jan-16 (Q3) announcement is before Mar-31 → cannot be the Mar quarter's.
    expect(matchAnnouncementToQuarter('2026-03-31', [anns[2]!])).toBeNull();
  });

  test('nothing in the window → null (caller falls back to the SEBI deadline)', () => {
    expect(matchAnnouncementToQuarter('2025-06-30', anns)).toBeNull();
  });
});

describe('ttmEpsKnownBy / peAsOf', () => {
  const q = (periodEnd: string, eps: number, availableAt: string): AvailableQuarter => ({
    periodEnd,
    epsBasic: eps,
    availableAt,
  });
  const quarters = [
    q('2025-03-31', 9, '2025-04-25'),
    q('2025-06-30', 10, '2025-07-20'),
    q('2025-09-30', 11, '2025-10-18'),
    q('2025-12-31', 12, '2026-01-16'),
    q('2026-03-31', 13, '2026-04-24'),
    q('2026-06-30', 14, '2026-07-17'),
  ];

  test('sums the 4 most recent quarters KNOWN by the date', () => {
    // On 2026-05-01: Jun-25..Mar-26 are the latest known → 10+11+12+13.
    expect(ttmEpsKnownBy(quarters, '2026-05-01')).toBe(46);
    // On 2026-07-18: Jun-26 replaces Jun-25 → 11+12+13+14.
    expect(ttmEpsKnownBy(quarters, '2026-07-18')).toBe(50);
  });

  test('the announcement date gates knowledge, not the period end', () => {
    // On 2026-04-20 the Mar-26 quarter exists (period ended 3 weeks ago) but is
    // NOT yet announced (Apr-24) → TTM must still use Mar-25..Dec-25.
    expect(ttmEpsKnownBy(quarters, '2026-04-20')).toBe(9 + 10 + 11 + 12);
  });

  test('fewer than 4 known quarters → null', () => {
    expect(ttmEpsKnownBy(quarters, '2025-11-01')).toBeNull();
  });

  test('peAsOf: price / TTM; null for non-positive earnings', () => {
    expect(peAsOf(500, 25)).toBe(20);
    expect(peAsOf(500, -5)).toBeNull();
    expect(peAsOf(500, null)).toBeNull();
  });
});
