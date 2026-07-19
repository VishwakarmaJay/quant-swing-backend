import { describe, expect, test } from 'bun:test';

import { domainOf, isIndianNewsDomain } from './indianDomains';

describe('domainOf', () => {
  test('strips scheme, www, path, query, and port', () => {
    expect(domainOf('https://www.moneycontrol.com/news/x')).toBe('moneycontrol.com');
    expect(domainOf('http://autocarindia.com:443/reviews')).toBe('autocarindia.com');
    expect(domainOf('https://economictimes.indiatimes.com/markets?foo=1')).toBe('economictimes.indiatimes.com');
  });
});

describe('isIndianNewsDomain — Indian outlets pass', () => {
  const indian = [
    'https://economictimes.indiatimes.com/markets/stocks/x',
    'https://auto.economictimes.indiatimes.com/news/x', // subdomain
    'https://www.moneycontrol.com/news/x',
    'https://mmb.moneycontrol.com/x',
    'https://www.livemint.com/market/x',
    'https://www.thehindubusinessline.com/x',
    'https://www.business-standard.com/x',
    'https://www.businesstoday.in/x', // .in ccTLD
    'https://trak.in/x', // .in
    'https://www.ibtimes.co.in/x', // .co.in
    'https://autocarindia.com:443/x', // port suffix
    'https://www.ndtv.com/x',
    'https://zeenews.india.com/x',
  ];
  for (const url of indian) {
    test(`allows ${domainOf(url)}`, () => expect(isIndianNewsDomain(url)).toBe(true));
  }
});

describe('isIndianNewsDomain — the actual false-positive sources are blocked', () => {
  const foreign = [
    'https://thecolgatemaroonnews.com/x', // Colgate University paper → COLPAL false pos
    'https://screenrant.com/lupin-x', // Lupin the Netflix show → LUPIN
    'https://collider.com/lupin-x',
    'https://www.cruiseindustrynews.com/x', // P&O ship Britannia
    'https://coincommunity.com/forum/x', // gold Britannia coin
    'https://ipswichtownnews.com/britannia-stand', // football stadium
    'https://www.marketscreener.com/quote/x', // French aggregator
    'https://finanznachrichten.de/x', // German
    'https://finance.yahoo.com/news/x', // global
    'https://www.yahoo.com/x',
    'https://tickerreport.com/x', // algorithmic stock spam
    'https://wkrb13.com/x',
    'https://modernreaders.com/x',
    'https://www.bbc.com/news/x',
    'https://allafrica.com/x',
    'https://www.thestar.com.my/x', // Malaysia
    'https://westseattleblog.com/x', // US local
    'https://openpr.com/x', // PR wire
    'https://www.prnewswire.com/x',
  ];
  for (const url of foreign) {
    test(`blocks ${domainOf(url)}`, () => expect(isIndianNewsDomain(url)).toBe(false));
  }
});

describe('isIndianNewsDomain — boundary safety', () => {
  test('a foreign domain merely ending in a curated string does not match', () => {
    // endsWith('.'+base) boundary — "notindia.com" must not match "india.com".
    expect(isIndianNewsDomain('https://notindia.com/x')).toBe(false);
    expect(isIndianNewsDomain('https://fakerediff.com/x')).toBe(false);
  });

  test('empty / malformed url → not Indian', () => {
    expect(isIndianNewsDomain('')).toBe(false);
    expect(isIndianNewsDomain('   ')).toBe(false);
  });

  test('a fake `.in`-looking host is still treated as Indian ccTLD (accepted risk)', () => {
    // Documented precision-first choice: any .in host is allowed.
    expect(isIndianNewsDomain('https://someblog.in/x')).toBe(true);
  });
});
