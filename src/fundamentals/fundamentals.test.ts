import { describe, expect, test } from 'bun:test';

import {
  fallbackAvailableAt,
  fundamentalsAsOf,
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

describe('fundamentalsAsOf (the FundamentalFactor pre-pass reconstruction)', () => {
  // 9 quarters, EPS 10 each, announced ~45 days after each period end.
  const q = (periodEnd: string, availableAt: string, eps = 10): AvailableQuarter => ({
    periodEnd,
    epsBasic: eps,
    availableAt,
  });
  const quarters: AvailableQuarter[] = [
    q('2024-03-31', '2024-04-25T14:00:00.000Z'),
    q('2024-06-30', '2024-07-20T14:00:00.000Z'),
    q('2024-09-30', '2024-10-18T14:00:00.000Z'),
    q('2024-12-31', '2025-01-17T14:00:00.000Z'),
    q('2025-03-31', '2025-04-24T14:00:00.000Z', 15),
    q('2025-06-30', '2025-07-19T14:00:00.000Z', 15),
    q('2025-09-30', '2025-10-17T14:00:00.000Z', 15),
    q('2025-12-31', '2026-01-16T14:00:00.000Z', 15),
    q('2026-03-31', '2026-04-23T14:00:00.000Z', 20),
  ];

  test('a quarter announced ON day D is usable only AFTER D (conservative, matches ttmEpsKnownBy)', () => {
    const onDay = fundamentalsAsOf(quarters, 500, '2026-04-23');
    expect(onDay.ttmEps).toBe(60); // Mar-26 (eps 20) not yet in
    const nextDay = fundamentalsAsOf(quarters, 500, '2026-04-24');
    expect(nextDay.ttmEps).toBe(65); // 15+15+15+20 — Mar-26 replaced Mar-25
  });

  test('TTM needs 4 known quarters; YoY base needs 8', () => {
    const early = fundamentalsAsOf(quarters, 500, '2024-11-01'); // 3 known
    expect(early.quartersKnown).toBe(3);
    expect(early.ttmEps).toBeNull();
    expect(early.ttmEpsPrevYear).toBeNull();

    const mid = fundamentalsAsOf(quarters, 500, '2025-08-01'); // 6 known → TTM yes, base no
    expect(mid.ttmEps).toBe(50); // 10+10+15+15
    expect(mid.ttmEpsPrevYear).toBeNull();

    const late = fundamentalsAsOf(quarters, 500, '2026-02-01'); // 8 known
    expect(late.ttmEps).toBe(60); // four 15s
    expect(late.ttmEpsPrevYear).toBe(40); // four 10s
  });

  test('PE derives from as-of TTM; null without price or with ≤0 earnings', () => {
    const s = fundamentalsAsOf(quarters, 600, '2026-02-01');
    expect(s.pe).toBe(10); // 600 / 60
    expect(fundamentalsAsOf(quarters, null, '2026-02-01').pe).toBeNull();
    const lossy = quarters.map((x) => ({ ...x, epsBasic: -1 }));
    expect(fundamentalsAsOf(lossy, 600, '2026-02-01').pe).toBeNull();
  });

  test('resultsPending toggles across the announcement window', () => {
    // After Mar-31 quarter end, before its Apr-23 announcement → pending.
    expect(fundamentalsAsOf(quarters, 500, '2026-04-10').resultsPending).toBe(true);
    // After the announcement becomes usable → not pending.
    expect(fundamentalsAsOf(quarters, 500, '2026-04-24').resultsPending).toBe(false);
    // Mid-quarter with everything announced → not pending.
    expect(fundamentalsAsOf(quarters, 500, '2026-03-15').resultsPending).toBe(false);
  });

  test('daysSinceLastResult counts from the newest known availableAt', () => {
    const s = fundamentalsAsOf(quarters, 500, '2026-02-01');
    expect(s.daysSinceLastResult).toBe(16); // 2026-01-16 → 2026-02-01
  });

  test('no quarters → dataless snapshot', () => {
    const s = fundamentalsAsOf([], 500, '2026-02-01');
    expect(s.quartersKnown).toBe(0);
    expect(s.ttmEps).toBeNull();
    expect(s.pe).toBeNull();
    expect(s.resultsPending).toBe(false);
    expect(s.daysSinceLastResult).toBeNull();
  });
});
