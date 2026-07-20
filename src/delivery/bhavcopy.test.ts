import { describe, expect, test } from 'bun:test';

import { bhavcopyDateToken, bhavcopyUrl, parseBhavcopy, parseBhavDate } from './bhavcopy';

/** Verbatim shape of the real file, including its leading-space padding. */
const HEADER =
  'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER';
const RELIANCE =
  'RELIANCE, EQ, 17-Jul-2026, 1296.60, 1300.00, 1330.30, 1296.10, 1328.80, 1327.20, 1321.39, 18302218, 241843.86, 257494, 11508344, 62.88';
const BAJAJ =
  'BAJAJ-AUTO, EQ, 17-Jul-2026, 10331.50, 10366.00, 10499.00, 10350.00, 10439.50, 10443.00, 10425.92, 426656, 44482.79, 53575, 261772, 61.35';
const BOND = '1018GS2026, GS, 17-Jul-2026, 103.28, 104.24, 104.24, 104.24, 104.24, 104.24, 104.24, 14, 0.01, 5, -, -';

describe('parseBhavDate', () => {
  test('converts the NSE date format to ISO', () => {
    expect(parseBhavDate('17-Jul-2026')).toBe('2026-07-17');
    expect(parseBhavDate(' 01-Jan-2021 ')).toBe('2021-01-01');
  });
  test('rejects anything else rather than guessing', () => {
    expect(parseBhavDate('2026-07-17')).toBeNull();
    expect(parseBhavDate('17-Xxx-2026')).toBeNull();
    expect(parseBhavDate('')).toBeNull();
  });
});

describe('parseBhavcopy', () => {
  test('parses EQ rows, stripping the leading-space padding', () => {
    const { rows } = parseBhavcopy([HEADER, RELIANCE].join('\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      symbol: 'RELIANCE',
      tradeDate: '2026-07-17',
      tradedQty: 18302218,
      deliveryQty: 11508344,
      deliveryPct: 62.88,
      trades: 257494,
    });
  });

  test('symbols arrive already canonical — hyphenated names survive intact', () => {
    const { rows } = parseBhavcopy([HEADER, BAJAJ].join('\n'));
    expect(rows[0]!.symbol).toBe('BAJAJ-AUTO'); // never truncated to BAJAJ
  });

  test('keeps only the EQ series (other series carry "-" delivery)', () => {
    const { rows } = parseBhavcopy([HEADER, RELIANCE, BOND].join('\n'));
    expect(rows.map((r) => r.symbol)).toEqual(['RELIANCE']);
  });

  test('skips malformed rows without throwing, and reports the count', () => {
    const short = 'BADROW, EQ, 17-Jul-2026, 1.0';
    const noPct = 'NOPCT, EQ, 17-Jul-2026, 1, 1, 1, 1, 1, 1, 1, 100, 1, 5, 50, -';
    const { rows, skipped } = parseBhavcopy([HEADER, RELIANCE, short, noPct].join('\n'));
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  test('rejects out-of-range delivery percentages as corrupt', () => {
    const bad = 'WEIRD, EQ, 17-Jul-2026, 1, 1, 1, 1, 1, 1, 1, 100, 1, 5, 50, 140.00';
    const { rows, skipped } = parseBhavcopy([HEADER, bad].join('\n'));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  test('tolerates CRLF line endings and a trailing blank line', () => {
    const { rows } = parseBhavcopy([HEADER, RELIANCE, ''].join('\r\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deliveryPct).toBe(62.88);
  });

  test('an empty or header-only file yields nothing, not an error', () => {
    expect(parseBhavcopy('').rows).toEqual([]);
    expect(parseBhavcopy(HEADER).rows).toEqual([]);
  });
});

describe('url construction', () => {
  test('builds the ddmmyyyy archive token', () => {
    expect(bhavcopyDateToken('2026-07-17')).toBe('17072026');
    expect(bhavcopyDateToken('2021-01-04')).toBe('04012021');
  });
  test('builds the archive URL', () => {
    expect(bhavcopyUrl('2026-07-17')).toContain('sec_bhavdata_full_17072026.csv');
  });
});
