import { describe, expect, test } from 'bun:test';

import { buildDocApiUrl, GDELT_MAX_RECORDS, isThrottleResponse } from './gdeltClient';
import { buildSymbolQuery, downloadWindow, downloadWindowBatch, sliceDateRange, windowDays } from './download';

const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe('sliceDateRange', () => {
  test('single window when range ≤ batchDays', () => {
    const windows = sliceDateRange(day('2025-01-01'), day('2025-01-10'), 30);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(windows[0]!.end.toISOString()).toBe('2025-01-10T23:59:59.000Z');
    expect(windowDays(windows[0]!)).toBe(10);
  });

  test('splits into abutting non-overlapping windows', () => {
    const windows = sliceDateRange(day('2025-01-01'), day('2025-03-15'), 30);
    expect(windows).toHaveLength(3);
    expect(windows[0]!.end.toISOString()).toBe('2025-01-30T23:59:59.000Z');
    expect(windows[1]!.start.toISOString()).toBe('2025-01-31T00:00:00.000Z');
    expect(windows[1]!.end.toISOString()).toBe('2025-03-01T23:59:59.000Z');
    expect(windows[2]!.start.toISOString()).toBe('2025-03-02T00:00:00.000Z');
    expect(windows[2]!.end.toISOString()).toBe('2025-03-15T23:59:59.000Z');
    expect(windows.reduce((n, w) => n + windowDays(w), 0)).toBe(74);
  });

  test('single day range', () => {
    const windows = sliceDateRange(day('2025-01-01'), day('2025-01-01'), 30);
    expect(windows).toHaveLength(1);
    expect(windowDays(windows[0]!)).toBe(1);
  });

  test('rejects nonsense batchDays', () => {
    expect(() => sliceDateRange(day('2025-01-01'), day('2025-01-02'), 0)).toThrow();
  });
});

describe('buildSymbolQuery — alias dictionary reuse', () => {
  test('quotes the PRIMARY curated alias with India/English constraints', () => {
    // SBIN's aliases are ['state bank of india', 'sbi'] — primary only (GDELT
    // rejects parenthesized-OR phrase queries; live-verified 2026-07-18).
    expect(buildSymbolQuery('SBIN')).toBe('"state bank of india" sourcecountry:IN sourcelang:eng');
    expect(buildSymbolQuery('HDFCBANK')).toBe('"hdfc bank" sourcecountry:IN sourcelang:eng');
  });

  test('symbol without aliases → null', () => {
    expect(buildSymbolQuery('NOT_A_SYMBOL')).toBeNull();
  });
});

describe('buildDocApiUrl / isThrottleResponse', () => {
  test('formats UTC window bounds as YYYYMMDDHHMMSS', () => {
    const url = buildDocApiUrl('"sbi" sourcecountry:IN', day('2025-01-01'), new Date('2025-01-30T23:59:59Z'));
    expect(url).toContain('startdatetime=20250101000000');
    expect(url).toContain('enddatetime=20250130235959');
    expect(url).toContain('mode=artlist');
    expect(url).toContain('format=json');
    expect(url).toContain(`maxrecords=${GDELT_MAX_RECORDS}`);
    expect(url).toContain('query=%22sbi%22+sourcecountry%3AIN');
  });

  test('recognizes the live throttle message', () => {
    expect(isThrottleResponse('Please limit requests to one every 5 seconds or contact …')).toBe(true);
    expect(isThrottleResponse('{"articles": []}')).toBe(false);
  });
});

const window = { start: day('2025-01-01'), end: new Date('2025-01-30T23:59:59Z') };
const payloadWith = (urls: string[]) =>
  JSON.stringify({
    articles: urls.map((url, i) => ({
      url,
      title: `Headline number ${i}`,
      seendate: '20250115T120000Z',
      domain: 'x.test',
      language: 'English',
      sourcecountry: 'India',
    })),
  });

describe('downloadWindow', () => {
  test('fetch failure → failed, never mistaken for empty', async () => {
    const result = await downloadWindow('q', window, async () => null);
    expect(result.failed).toBe(true);
    expect(result.articles).toEqual([]);
  });

  test('unrecognizable (non-JSON, non-throttle) response → failed', async () => {
    const result = await downloadWindow('q', window, async () => '<html>maintenance</html>');
    expect(result.failed).toBe(true);
  });

  test('valid JSON empty window ({} shape) → success with zero articles', async () => {
    const result = await downloadWindow('q', window, async () => '{}');
    expect(result.failed).toBe(false);
    expect(result.articles).toEqual([]);
  });

  test('throttle message retried with backoff, then succeeds', async () => {
    let calls = 0;
    const result = await downloadWindow(
      'q',
      window,
      async () => (++calls < 3 ? 'Please limit requests to one every 5 seconds' : payloadWith(['https://x.test/a'])),
      1, // 1ms backoff for the test
    );
    expect(calls).toBe(3);
    expect(result.failed).toBe(false);
    expect(result.articles).toHaveLength(1);
  });

  test('persistent throttle → failed after bounded retries', async () => {
    let calls = 0;
    const result = await downloadWindow(
      'q',
      window,
      async () => {
        calls++;
        return 'Please limit requests to one every 5 seconds';
      },
      1,
    );
    expect(result.failed).toBe(true);
    expect(calls).toBe(4); // initial + 3 retries
  });

  test('flags truncation at the record cap', async () => {
    const urls = Array.from({ length: GDELT_MAX_RECORDS }, (_, i) => `https://x.test/${i}`);
    const result = await downloadWindow('q', window, async () => payloadWith(urls));
    expect(result.truncated).toBe(true);
  });
});

describe('downloadWindowBatch', () => {
  test('merges by URL across symbol queries and isolates failures', async () => {
    const queries = [
      { symbol: 'RELIANCE', query: 'q1' },
      { symbol: 'TCS', query: 'q2' },
      { symbol: 'INFY', query: 'q3' },
    ];
    let call = 0;
    const batch = await downloadWindowBatch(
      queries,
      window,
      async () => {
        call++;
        if (call === 1) return payloadWith(['https://x.test/shared', 'https://x.test/only-reliance']);
        if (call === 2) return null; // TCS query dies; others continue
        return payloadWith(['https://x.test/shared', 'https://x.test/only-infy']);
      },
      0, // no pacing in tests
    );
    expect(batch.failedQueries).toBe(1);
    expect(batch.articles.map((a) => a.url).sort()).toEqual([
      'https://x.test/only-infy',
      'https://x.test/only-reliance',
      'https://x.test/shared',
    ]);
  });
});
