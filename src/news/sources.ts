import type { NewsSource } from './types';

/**
 * The four feeds the archive polls (ROADMAP B3). Live-verified 2026-07-18:
 *
 * - ET_MARKETS   : standard RSS, no UA filtering — worked from day one.
 * - LIVEMINT     : standard RSS (CDATA-wrapped fields), fresh same-day items.
 *   ⚠️ Replaces MONEYCONTROL — Moneycontrol's public RSS (latestnews.xml,
 *   buzzingstocks.xml) is FROZEN at 23 Apr 2024 (every item; verified with a
 *   browser UA), so it can never feed the archive.
 * - BSE_ANNOUNCEMENTS : the corp-announcements JSON API, endpoint + params
 *   confirmed from the live ann.html page (devtools capture, operator-provided):
 *   `AnnSubCategoryGetData/w` with `subcategory=-1`. ⚠️ The API only accepts
 *   SINGLE-DAY windows — `strPrevDate` must equal `strToDate`; any multi-day
 *   range returns `{}` (live-verified; this is why earlier yesterday→today
 *   probes "found no records"). The `{date}` placeholder is therefore expanded
 *   into TWO same-day URLs per run (yesterday + today) so filings disseminated
 *   around midnight (e.g. 00:49 in the capture) are never missed; the
 *   (source,url) unique key makes the overlap idempotent. Requires the Referer
 *   header (WAF) and a browser UA (fetch.ts).
 * - GOOGLE_NEWS  : standard RSS, no UA filtering — worked from day one.
 *
 * All fetches send a browser User-Agent (see fetch.ts) — Moneycontrol and BSE
 * return HTTP 403 to bot-style UAs on these same public URLs.
 */
export const NEWS_SOURCES: readonly NewsSource[] = [
  {
    id: 'ET_MARKETS',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    dialect: 'rss',
  },
  {
    id: 'LIVEMINT',
    url: 'https://www.livemint.com/rss/markets',
    dialect: 'rss',
  },
  {
    id: 'BSE_ANNOUNCEMENTS',
    // {date} → YYYYMMDD; expanded to yesterday + today (single-day windows only).
    url: 'https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate={date}&strScrip=&strSearch=P&strToDate={date}&strType=C&subcategory=-1',
    dialect: 'bse',
    headers: {
      Referer: 'https://www.bseindia.com/corporates/ann.html',
      Accept: 'application/json, text/plain, */*',
    },
  },
  {
    id: 'GOOGLE_NEWS',
    url: 'https://news.google.com/rss/search?q=(nifty%20OR%20sensex%20OR%20NSE)%20when:1d&hl=en-IN&gl=IN&ceid=IN:en',
    dialect: 'rss',
  },
];

const yyyymmdd = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/**
 * Resolves a source into the URL(s) to fetch this run. Placeholder-free URLs
 * pass through as a single entry; a `{date}` URL expands to two same-day
 * windows (yesterday + today) — see the BSE note above.
 */
export const resolveSourceUrls = (source: NewsSource, fetchedAt: Date): string[] => {
  if (!source.url.includes('{date}')) return [source.url];
  const yesterday = new Date(fetchedAt.getTime() - 86_400_000);
  return [
    source.url.replaceAll('{date}', yyyymmdd(yesterday)),
    source.url.replaceAll('{date}', yyyymmdd(fetchedAt)),
  ];
};
