import { env } from '@config/env';
import logger from '@services/logger';

import { COMPANY_ALIASES } from '../companyAliases';
import { buildDocApiUrl, fetchGdeltPayload, GDELT_MAX_RECORDS, isThrottleResponse } from './gdeltClient';
import { parseGdeltPayload, type GdeltArticle } from './parser';

/**
 * GDELT download orchestration (ROADMAP B3.5): slice a date range into query
 * windows, build per-symbol queries from the SAME curated alias dictionary the
 * live symbol mapper uses, and drive the client politely (rate limit +
 * throttle backoff). Pure helpers are exported for unit tests; the only I/O
 * is through the injected fetch function (defaults to the real client).
 */

/** One [start, end] UTC window for a single DOC API request. */
export type DateWindow = { start: Date; end: Date };

/**
 * Slices [from, to] (inclusive calendar days, UTC) into windows of at most
 * `batchDays` days. Windows abut without overlap: each starts at 00:00:00 UTC
 * and ends at 23:59:59 UTC of its last day.
 */
export const sliceDateRange = (from: Date, to: Date, batchDays: number): DateWindow[] => {
  if (batchDays < 1 || !Number.isFinite(batchDays)) throw new Error(`batchDays must be ≥ 1, got ${batchDays}`);
  const windows: DateWindow[] = [];
  const dayMs = 86_400_000;
  let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const endOfRange = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) + dayMs - 1_000;
  while (cursor <= endOfRange) {
    const windowEnd = Math.min(cursor + batchDays * dayMs - 1_000, endOfRange);
    windows.push({ start: new Date(cursor), end: new Date(windowEnd) });
    cursor = windowEnd + 1_000;
  }
  return windows;
};

/** Days covered by a window (for the days-processed progress counter). */
export const windowDays = (w: DateWindow): number => Math.round((w.end.getTime() + 1_000 - w.start.getTime()) / 86_400_000);

/**
 * Builds the DOC API query for one universe symbol from its curated aliases —
 * the same dictionary the live mapper matches with (requirement: one alias
 * source, not two). The PRIMARY (first) alias is used as a single quoted
 * phrase, constrained to English-language Indian coverage. Returns null when
 * the symbol has no aliases (nothing safe to search for).
 *
 * Why not OR all aliases: live-verified 2026-07-18 — GDELT answers
 * parenthesized-OR phrase queries with its HTTP 429 throttle message even as
 * the first request after a long cooldown, while the identical single-phrase
 * query returns articles. Secondary aliases are therefore NOT searched
 * (recall trade-off, documented in GDELT_BACKFILL.md §8); the mapper still
 * matches every alias in whatever titles come back.
 */
export const buildSymbolQuery = (symbol: string): string | null => {
  const primary = COMPANY_ALIASES[symbol]?.[0]?.trim();
  if (!primary) return null;
  return `"${primary}" sourcecountry:IN sourcelang:eng`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Outcome of downloading one (query, window) cell. */
export type WindowDownload = {
  articles: GdeltArticle[];
  /** True when the response hit the API's 250-record cap (possible truncation). */
  truncated: boolean;
  /** True when the request ultimately failed (fetch error or persistent throttle). */
  failed: boolean;
};

/** GDELT's own stated pacing; used as the throttle-retry backoff floor. */
const THROTTLE_BACKOFF_MS = 5_000;
const THROTTLE_RETRIES = 3;

/**
 * Downloads one query over one window, honouring GDELT's throttle protocol:
 * a rate-limit message (HTTP 200, plain text) is retried after ≥5s backoff,
 * a few times, then surfaced as failed — never mistaken for an empty window.
 */
export const downloadWindow = async (
  query: string,
  window: DateWindow,
  fetchPayload: (url: string) => Promise<string | null> = fetchGdeltPayload,
  backoffMs: number = Math.max(THROTTLE_BACKOFF_MS, env.GDELT_RATE_LIMIT_MS),
): Promise<WindowDownload> => {
  const url = buildDocApiUrl(query, window.start, window.end);
  for (let attempt = 0; attempt <= THROTTLE_RETRIES; attempt++) {
    const payload = await fetchPayload(url);
    if (payload === null) return { articles: [], truncated: false, failed: true };
    if (isThrottleResponse(payload)) {
      if (attempt === THROTTLE_RETRIES) {
        logger.warn(`[GDELT]: still throttled after ${THROTTLE_RETRIES} retries — window marked failed`);
        return { articles: [], truncated: false, failed: true };
      }
      await sleep(backoffMs * (attempt + 1));
      continue;
    }
    const articles = parseGdeltPayload(payload);
    if (articles === null) {
      // Not JSON and not the throttle message — an API error/notice page.
      // Never mistake it for a quiet news window.
      logger.warn(`[GDELT]: unrecognizable response (${payload.slice(0, 120).replace(/\s+/g, ' ')}…) — window marked failed`);
      return { articles: [], truncated: false, failed: true };
    }
    return { articles, truncated: articles.length >= GDELT_MAX_RECORDS, failed: false };
  }
  return { articles: [], truncated: false, failed: true };
};

/** Result of downloading all symbol queries for one window. */
export type WindowBatch = {
  window: DateWindow;
  /** URL-keyed merge across symbol queries (the same article often matches several). */
  articles: GdeltArticle[];
  truncatedQueries: number;
  failedQueries: number;
};

/**
 * Downloads every symbol query for one window, pacing requests by
 * GDELT_RATE_LIMIT_MS, and merges the results by URL so an article matched by
 * several symbol queries is downloaded once. Per-query failures degrade
 * independently (the B3 per-feed rule).
 */
export const downloadWindowBatch = async (
  queries: readonly { symbol: string; query: string }[],
  window: DateWindow,
  fetchPayload: (url: string) => Promise<string | null> = fetchGdeltPayload,
  rateLimitMs: number = env.GDELT_RATE_LIMIT_MS,
): Promise<WindowBatch> => {
  const byUrl = new Map<string, GdeltArticle>();
  let truncatedQueries = 0;
  let failedQueries = 0;

  for (let i = 0; i < queries.length; i++) {
    if (i > 0 && rateLimitMs > 0) await sleep(rateLimitMs);
    const { symbol, query } = queries[i]!;
    const result = await downloadWindow(query, window, fetchPayload);
    if (result.failed) {
      failedQueries++;
      logger.warn(`[GDELT]: query for ${symbol} failed in window ${window.start.toISOString().slice(0, 10)}`);
      continue;
    }
    if (result.truncated) {
      truncatedQueries++;
      logger.warn(
        `[GDELT]: ${symbol} hit the ${GDELT_MAX_RECORDS}-record cap in window starting ` +
          `${window.start.toISOString().slice(0, 10)} — coverage may be truncated (lower GDELT_BATCH_DAYS)`,
      );
    }
    for (const a of result.articles) if (!byUrl.has(a.url)) byUrl.set(a.url, a);
  }

  return { window, articles: [...byUrl.values()], truncatedQueries, failedQueries };
};
