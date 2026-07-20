import { describe, expect, test } from 'bun:test';

import { classifyEvent, exchangeLabelOf, EXTRACTOR_VERSION } from './classify';

/**
 * Fixtures are REAL stored rows from the BSE archive (title | body shape), so
 * these tests pin the classifier against the data it actually runs on.
 */
describe('exchangeLabelOf', () => {
  test('extracts the exchange subcategory embedded in the body', () => {
    expect(
      exchangeLabelOf('Adani Enterprises Ltd — Announcement under Regulation 30 (LODR)-Acquisition'),
    ).toBe('Acquisition');
    expect(
      exchangeLabelOf('ONGC Ltd — Announcement under Regulation 30 (LODR)-Appointment of Statutory Auditor/s'),
    ).toBe('Appointment of Statutory Auditor/s');
  });

  test('returns null when the body carries no label', () => {
    expect(exchangeLabelOf('Sun Pharma — Intimation Of The Record Date For The Interim Dividend')).toBeNull();
    expect(exchangeLabelOf(null)).toBeNull();
    expect(exchangeLabelOf('')).toBeNull();
  });
});

describe('classifyEvent — exchange label (authoritative path)', () => {
  const cases: [string, string][] = [
    ['Announcement under Regulation 30 (LODR)-Acquisition', 'M_AND_A'],
    ['Announcement under Regulation 30 (LODR)-Credit Rating', 'RATING_ACTION'],
    ['Announcement under Regulation 30 (LODR)-Award_of_Order_Receipt_of_Order', 'ORDER_WIN'],
    ['Announcement under Regulation 30 (LODR)-Earnings Call Transcript', 'EARNINGS_CALL'],
    ['Announcement under Regulation 30 (LODR)-Analyst / Investor Meet - Intimation', 'EARNINGS_CALL'],
    ['Announcement under Regulation 30 (LODR)-Change in Directorate', 'MGMT_CHANGE'],
    ['Announcement under Regulation 30 (LODR)-Allotment of ESOP / ESPS', 'CAPITAL_ISSUE'],
    ['Announcement under Regulation 30 (LODR)-Press Release / Media Release', 'MEDIA_ROUTINE'],
    ['Announcement under Regulation 30 (LODR)-Dividend Updates', 'DIVIDEND'],
  ];
  for (const [body, expected] of cases) {
    test(`${body.split('-').pop()} → ${expected}`, () => {
      const c = classifyEvent('any headline', `Some Co Ltd — ${body}`);
      expect(c.type).toBe(expected as never);
      expect(c.method).toBe('exchange-label');
      expect(c.extractorVersion).toBe(EXTRACTOR_VERSION);
    });
  }

  test('an exchange label outside our map is OTHER — but still marked as labelled, never guessed', () => {
    const c = classifyEvent('x', 'Co — Announcement under Regulation 30 (LODR)-Monitoring Agency Report');
    expect(c.type).toBe('OTHER');
    expect(c.method).toBe('exchange-label');
    expect(c.rawLabel).toBe('Monitoring Agency Report');
  });

  test('the exchange label WINS over a misleading headline', () => {
    // Headline says "order", the exchange says it is a credit rating filing.
    const c = classifyEvent('Order of the day: rating agencies', 'Co — Announcement under Regulation 30 (LODR)-Credit Rating');
    expect(c.type).toBe('RATING_ACTION');
  });
});

describe('classifyEvent — keyword pack (unlabelled rows)', () => {
  const cases: [string, string][] = [
    ['Integrated Financials for the quarter and nine months ended December 31, 2024', 'EARNINGS_RESULT'],
    ['Unaudited Financial Results for the quarter ended June 30, 2025', 'EARNINGS_RESULT'],
    ['Intimation of Earnings Call with analysts', 'EARNINGS_CALL'],
    ['Company receives Letter of Award from NTPC', 'ORDER_WIN'],
    ['CRISIL upgrades long-term rating', 'RATING_ACTION'],
    ['Intimation of sale and transfer of project specific SPV/ subsidiary', 'M_AND_A'],
    ['The Record date for the purpose of Interim Dividend for FY 2025-26', 'DIVIDEND'],
    ['Closure of Trading Window', 'INSIDER_PLEDGE'],
    ['Change in Key Managerial Personnel', 'MGMT_CHANGE'],
    ['Intimation of Loss of Share Certificate', 'OTHER'],
  ];
  for (const [title, expected] of cases) {
    test(`"${title.slice(0, 44)}…" → ${expected}`, () => {
      const c = classifyEvent(title, 'Co Ltd — no exchange label here');
      expect(c.type).toBe(expected as never);
      expect(c.method).toBe(expected === 'OTHER' ? 'none' : 'keyword');
    });
  }

  test('a plain board meeting notice types as BOARD_MEETING', () => {
    const c = classifyEvent('Board Meeting scheduled on 15/05/2024', null);
    expect(c.type).toBe('BOARD_MEETING');
  });

  test('a board meeting called TO CONSIDER results is BOARD_MEETING, not EARNINGS_RESULT', () => {
    // The scheduling notice precedes the actual results by days. Typing it as
    // the result would contaminate that cell with pre-announcements — the
    // "results-adjacent notice" failure the B4 architecture review flagged.
    const c = classifyEvent('Board Meeting Intimation for consideration of results', null);
    expect(c.type).toBe('BOARD_MEETING');
  });
});

describe('classifier discipline', () => {
  test('is pure and deterministic — same input, same output', () => {
    const a = classifyEvent('Unaudited Financial Results for Q1', 'Co — x');
    const b = classifyEvent('Unaudited Financial Results for Q1', 'Co — x');
    expect(a).toEqual(b);
  });

  test('unrecognized text is OTHER/none — never a guess', () => {
    const c = classifyEvent('Some entirely unrelated corporate correspondence', null);
    expect(c.type).toBe('OTHER');
    expect(c.method).toBe('none');
    expect(c.rawLabel).toBeNull();
  });
});
