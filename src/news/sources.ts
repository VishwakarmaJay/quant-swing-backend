import type { NewsSource } from './types';

/**
 * The four feeds the archive polls (ROADMAP B3). Live-verified 2026-07-18:
 *
 * - ET_MARKETS   : standard RSS, no UA filtering — worked from day one.
 * - LIVEMINT     : standard RSS (CDATA-wrapped fields), fresh same-day items.
 *   ⚠️ Replaces MONEYCONTROL — Moneycontrol's public RSS (latestnews.xml,
 *   buzzingstocks.xml) is FROZEN at 23 Apr 2024 (every item; verified with a
 *   browser UA), so it can never feed the archive.
 * - BSE_ANNOUNCEMENTS : the corp-announcements JSON API (the notices.xml this
 *   pointed at before is standard RSS of exchange-circular PDFs — wrong dialect
 *   AND near-useless for per-stock news). The API passes the WAF with a browser
 *   UA + Referer (verified), but returned "No Record Found!" for date-window
 *   probes here — ⚠️ confirm the exact query params on infra by copying the
 *   request the ann.html page makes (browser devtools → network tab). The
 *   `{from}`/`{to}` placeholders are substituted per run (YYYYMMDD).
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
    // Corp-announcements JSON API; {from}/{to} become YYYYMMDD at fetch time.
    // Query params to be confirmed live on infra (see header comment).
    url: 'https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?pageno=1&strCat=-1&strPrevDate={from}&strScrip=&strSearch=P&strToDate={to}&strType=C',
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

/** Substitutes the {from}/{to} date placeholders (YYYYMMDD) in a source URL. */
export const resolveSourceUrl = (source: NewsSource, fetchedAt: Date): string => {
  if (!source.url.includes('{from}') && !source.url.includes('{to}')) return source.url;
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const from = new Date(fetchedAt.getTime() - 86_400_000); // yesterday→today window
  return source.url.replace('{from}', fmt(from)).replace('{to}', fmt(fetchedAt));
};
