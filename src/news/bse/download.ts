import { env } from '@config/env';
import logger from '@services/logger';

import { fetchFeed } from '../fetch';
import { parseBse } from '../rssParser';
import type { RawFeedItem } from '../types';

/**
 * BSE announcements historical download (ROADMAP B3.6). Per-scrip queries to
 * the same `AnnSubCategoryGetData` API the live source polls — but where the
 * universe-wide live query only accepts single-day windows, PER-SCRIP queries
 * accept wide date ranges (live-verified on the fundamentals side for
 * `strCat=Result` and re-verified 2026-07-18 for `strCat=-1`, all categories).
 *
 * Pagination: the response carries `Table1: [{ROWCNT: n}]` — the total row
 * count for the query. Pages are fetched until the collected count reaches
 * ROWCNT (or a hard page cap, defensive).
 */

/** Same WAF requirements as the live source (browser UA comes from fetchFeed). */
export const BSE_ANN_HEADERS: Record<string, string> = {
  Referer: 'https://www.bseindia.com/corporates/ann.html',
  Accept: 'application/json, text/plain, */*',
};

const fmtDate = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

/** Builds one per-scrip announcements URL for a date window + page. */
export const buildScripAnnouncementsUrl = (scripCode: string, from: Date, to: Date, pageno: number): string =>
  `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${pageno}&strCat=-1` +
  `&strPrevDate=${fmtDate(from)}&strScrip=${scripCode}&strSearch=P&strToDate=${fmtDate(to)}&strType=C&subcategory=-1`;

/** Total row count for the query (`Table1[0].ROWCNT`), or null when absent. */
export const parseRowcnt = (payload: string): number | null => {
  try {
    const parsed: unknown = JSON.parse(payload);
    const t1 = (parsed as { Table1?: unknown })?.Table1;
    if (!Array.isArray(t1) || t1.length === 0) return null;
    const n = (t1[0] as { ROWCNT?: unknown })?.ROWCNT;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

/** Defensive cap — no scrip×window should legitimately need this many pages. */
const MAX_PAGES = 25;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type ScripWindowDownload = {
  items: RawFeedItem[];
  /** True when any page fetch failed (window must be retried, not trusted). */
  failed: boolean;
};

/**
 * Downloads every announcement for one scrip over one window, following
 * ROWCNT pagination, pacing requests by BSE_BACKFILL_RATE_LIMIT_MS. Rows are
 * parsed by the SAME `parseBse` the live pipeline uses (title, attachment
 * URL, DissemDT, SLONGNAME-prepended body).
 */
export const downloadScripWindow = async (
  scripCode: string,
  from: Date,
  to: Date,
  fetchImpl: (url: string, headers?: Record<string, string>) => Promise<string | null> = fetchFeed,
  rateLimitMs: number = env.BSE_BACKFILL_RATE_LIMIT_MS,
): Promise<ScripWindowDownload> => {
  const items: RawFeedItem[] = [];
  let expected: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1 && rateLimitMs > 0) await sleep(rateLimitMs);
    const payload = await fetchImpl(buildScripAnnouncementsUrl(scripCode, from, to, page), BSE_ANN_HEADERS);
    if (payload === null) return { items, failed: true };

    const pageItems = parseBse(payload);
    if (expected === null) expected = parseRowcnt(payload);
    items.push(...pageItems);

    // Stop when the API says we have everything, or a page comes back empty
    // (no ROWCNT + empty page = end either way).
    if (pageItems.length === 0) break;
    if (expected !== null && items.length >= expected) break;
  }

  if (expected !== null && items.length < expected) {
    logger.warn(`[BSE-backfill]: scrip ${scripCode} window collected ${items.length}/${expected} rows (page cap?)`);
  }
  return { items, failed: false };
};
