import type { NewsSource } from './types';

/**
 * The four feeds the archive polls (ROADMAP B3). Standard RSS/Atom endpoints for
 * ET Markets, Moneycontrol and Google News; BSE corporate announcements use a
 * bespoke XML shape (dialect 'bse').
 *
 * ⚠️ Endpoint URLs must be confirmed live on networked infra before the archive
 * clock is trusted — feed paths change, and BSE in particular may require its
 * JSON API instead of an XML feed. `bun run news:ingest` prints per-source item
 * counts precisely so a dead/renamed feed is caught on the first run.
 */
export const NEWS_SOURCES: readonly NewsSource[] = [
  {
    id: 'ET_MARKETS',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    dialect: 'rss',
  },
  {
    id: 'MONEYCONTROL',
    url: 'https://www.moneycontrol.com/rss/latestnews.xml',
    dialect: 'rss',
  },
  {
    id: 'BSE_ANNOUNCEMENTS',
    // BSE corporate announcements. Confirm the live endpoint/shape on infra.
    url: 'https://www.bseindia.com/data/xml/notices.xml',
    dialect: 'bse',
  },
  {
    id: 'GOOGLE_NEWS',
    url: 'https://news.google.com/rss/search?q=(nifty%20OR%20sensex%20OR%20NSE)%20when:1d&hl=en-IN&gl=IN&ceid=IN:en',
    dialect: 'rss',
  },
];
