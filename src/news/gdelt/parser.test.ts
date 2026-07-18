import { describe, expect, test } from 'bun:test';

import {
  cleanGdeltTitle,
  parseGdeltPayload,
  parseSeendate,
  reconstructAvailableAt,
  toGdeltRecords,
} from './parser';

// Shape captured live from the DOC API 2026-07-18 (including GDELT's
// tokenized punctuation in titles).
const LIVE_PAYLOAD = JSON.stringify({
  articles: [
    {
      url: 'https://economictimes.indiatimes.com/markets/stocks/news/the-ambani-formula/articleshow/121826116.cms',
      url_mobile: 'https://m.economictimes.com/…',
      title: 'The Ambani formula for making money : 17 years + 1 Nifty stock = 2 , 200 % profit',
      seendate: '20250613T160000Z',
      socialimage: 'https://img.etimg.com/thumb.jpg',
      domain: 'economictimes.indiatimes.com',
      language: 'English',
      sourcecountry: 'India',
    },
    {
      url: 'https://www.freepressjournal.in/business/reliance-sells-major-stake-in-asian-paints',
      url_mobile: '',
      title: 'Reliance Sells Major Stake In Asian Paints , 3 . 5 Crore Shares Offloaded',
      seendate: '20250613T104500Z',
      socialimage: '',
      domain: 'freepressjournal.in',
      language: 'English',
      sourcecountry: 'India',
    },
  ],
});

describe('parseSeendate', () => {
  test('parses GDELT UTC timestamps', () => {
    expect(parseSeendate('20250613T160000Z')?.toISOString()).toBe('2025-06-13T16:00:00.000Z');
    expect(parseSeendate('20170101T000000Z')?.toISOString()).toBe('2017-01-01T00:00:00.000Z');
  });

  test('rejects malformed or impossible dates', () => {
    expect(parseSeendate('2025-06-13T16:00:00Z')).toBeNull();
    expect(parseSeendate('20250613')).toBeNull();
    expect(parseSeendate('20251340T160000Z')).toBeNull(); // month 13
    expect(parseSeendate('20250230T120000Z')).toBeNull(); // Feb 30 (would roll over)
    expect(parseSeendate('')).toBeNull();
  });
});

describe('reconstructAvailableAt — timestamp reconstruction', () => {
  test('availableAt = publishedAt + latency minutes', () => {
    const publishedAt = new Date('2025-06-13T16:00:00Z');
    expect(reconstructAvailableAt(publishedAt, 30).toISOString()).toBe('2025-06-13T16:30:00.000Z');
    expect(reconstructAvailableAt(publishedAt, 0).toISOString()).toBe('2025-06-13T16:00:00.000Z');
    expect(reconstructAvailableAt(publishedAt, 90).toISOString()).toBe('2025-06-13T17:30:00.000Z');
  });

  test('never earlier than publication', () => {
    const publishedAt = new Date('2025-06-13T16:00:00Z');
    expect(reconstructAvailableAt(publishedAt, 30).getTime()).toBeGreaterThan(publishedAt.getTime());
  });
});

describe('cleanGdeltTitle', () => {
  test("reattaches GDELT's tokenized punctuation", () => {
    expect(cleanGdeltTitle('17 years + 1 Nifty stock = 2 , 200 % profit')).toBe(
      '17 years + 1 Nifty stock = 2, 200% profit',
    );
    expect(cleanGdeltTitle('Reliance Sells Stake , 3 . 5 Crore Shares ')).toBe('Reliance Sells Stake, 3. 5 Crore Shares');
  });

  test('collapses whitespace and decodes entities', () => {
    expect(cleanGdeltTitle('  Tata &amp; Sons \n rally  ')).toBe('Tata & Sons rally');
  });
});

describe('parseGdeltPayload', () => {
  test('parses the live artlist shape', () => {
    const articles = parseGdeltPayload(LIVE_PAYLOAD)!;
    expect(articles).toHaveLength(2);
    expect(articles[0]!.url).toContain('economictimes');
    expect(articles[0]!.seendate).toBe('20250613T160000Z');
    expect(articles[1]!.domain).toBe('freepressjournal.in');
  });

  test('non-JSON (throttle/error text) → null, never a silent empty window', () => {
    expect(parseGdeltPayload('Please limit requests to one every 5 seconds…')).toBeNull();
    expect(parseGdeltPayload('<html>blocked</html>')).toBeNull();
  });

  test('valid JSON without an articles array → genuinely empty', () => {
    expect(parseGdeltPayload('{}')).toEqual([]);
    expect(parseGdeltPayload('{"articles": "nope"}')).toEqual([]);
  });

  test('malformed items are skipped, valid ones kept', () => {
    const payload = JSON.stringify({
      articles: [
        { url: '', title: 'no url', seendate: '20250613T160000Z' },
        { url: 'https://x.test/a', title: '', seendate: '20250613T160000Z' },
        { url: 'https://x.test/b', title: 'no seendate' },
        null,
        'garbage',
        { url: 'https://x.test/ok', title: 'Valid item', seendate: '20250613T160000Z' },
      ],
    });
    const articles = parseGdeltPayload(payload)!;
    expect(articles).toHaveLength(1);
    expect(articles[0]!.url).toBe('https://x.test/ok');
  });
});

describe('toGdeltRecords', () => {
  test('converts with reconstructed timestamps (default-style 30 min latency)', () => {
    const records = toGdeltRecords(parseGdeltPayload(LIVE_PAYLOAD)!, 30);
    expect(records).toHaveLength(2);
    expect(records[0]!.publishedAt.toISOString()).toBe('2025-06-13T16:00:00.000Z');
    expect(records[0]!.availableAt.toISOString()).toBe('2025-06-13T16:30:00.000Z');
    expect(records[0]!.title).toBe('The Ambani formula for making money: 17 years + 1 Nifty stock = 2, 200% profit');
  });

  test('drops unparseable seendates and empty titles', () => {
    const records = toGdeltRecords(
      [
        { url: 'https://x.test/bad-date', title: 'ok', seendate: 'not-a-date', domain: '', language: '', sourcecountry: '' },
        { url: 'https://x.test/blank', title: '   ', seendate: '20250613T160000Z', domain: '', language: '', sourcecountry: '' },
        { url: 'https://x.test/ok', title: 'Kept', seendate: '20250613T160000Z', domain: '', language: '', sourcecountry: '' },
      ],
      30,
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.url).toBe('https://x.test/ok');
  });
});
