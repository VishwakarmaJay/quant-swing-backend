import { describe, expect, test } from 'bun:test';

import { cleanText, decodeEntities, parseBse, parseFeed, parseRss } from './rssParser';

describe('decodeEntities / cleanText', () => {
  test('decodes named and numeric entities', () => {
    expect(decodeEntities('Tata &amp; Sons &#38; &#x26; Co &quot;x&quot;')).toBe('Tata & Sons & & Co "x"');
  });

  test('strips CDATA and HTML tags to plain text', () => {
    expect(cleanText('<![CDATA[<b>Reliance</b> up 3%]]>')).toBe('Reliance up 3%');
    expect(cleanText('  multi   space\n\ttext ')).toBe('multi space text');
  });

  test('empty/nullish → empty string', () => {
    expect(cleanText(null)).toBe('');
    expect(cleanText(undefined)).toBe('');
  });
});

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Infosys Q1 profit rises 8%]]></title>
    <link>https://example.com/infy-q1</link>
    <pubDate>Wed, 16 Jul 2025 09:30:00 +0530</pubDate>
    <description>Infosys reported net profit up 8% YoY.</description>
  </item>
  <item>
    <title>TCS wins deal &amp; guidance</title>
    <link>https://example.com/tcs</link>
    <pubDate>Wed, 16 Jul 2025 10:00:00 +0530</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>HDFC Bank update</title>
    <link rel="alternate" href="https://example.com/hdfc"/>
    <published>2025-07-16T04:00:00Z</published>
    <summary>Bank posts steady growth.</summary>
  </entry>
</feed>`;

describe('parseRss', () => {
  test('parses RSS 2.0 items with title/link/date/body', () => {
    const items = parseRss(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe('Infosys Q1 profit rises 8%');
    expect(items[0]!.url).toBe('https://example.com/infy-q1');
    expect(items[0]!.body).toBe('Infosys reported net profit up 8% YoY.');
    expect(items[0]!.publishedAt).toBe(new Date('Wed, 16 Jul 2025 09:30:00 +0530').toISOString());
    expect(items[1]!.title).toBe('TCS wins deal & guidance');
    expect(items[1]!.body).toBeNull();
  });

  test('parses Atom entries via href link and published date', () => {
    const items = parseRss(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe('https://example.com/hdfc');
    expect(items[0]!.publishedAt).toBe('2025-07-16T04:00:00.000Z');
  });

  test('skips items with no title; tolerates malformed dates', () => {
    const items = parseRss('<rss><channel><item><link>x</link></item><item><title>Ok</title><pubDate>garbage</pubDate></item></channel></rss>');
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Ok');
    expect(items[0]!.publishedAt).toBeNull();
  });
});

describe('parseBse', () => {
  test('parses Table rows, builds attachment URL, falls back to RSS otherwise', () => {
    const bse = `<root>
      <Table><HEADLINE>Board Meeting Intimation</HEADLINE><NEWS_DT>2025-07-16 11:00:00</NEWS_DT><ATTACHMENTNAME>abc.pdf</ATTACHMENTNAME></Table>
      <Table><NEWSSUB>Reliance results</NEWSSUB></Table>
    </root>`;
    const items = parseBse(bse);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe('Board Meeting Intimation');
    expect(items[0]!.url).toContain('abc.pdf');
    expect(items[1]!.title).toBe('Reliance results');
    // No <Table> → RSS fallback path.
    expect(parseFeed(RSS, 'bse')).toHaveLength(2);
  });
});

describe('parseFeed', () => {
  test('never throws on garbage input', () => {
    expect(parseFeed('not xml at all', 'rss')).toEqual([]);
    expect(parseFeed('', 'bse')).toEqual([]);
  });
});
