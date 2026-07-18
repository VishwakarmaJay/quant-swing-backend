import { env } from '@config/env';
import logger from '@services/logger';

import { BROWSER_UA } from '../fetch';

/**
 * GDELT DOC 2.0 API client (ROADMAP B3.5) — networking only. URL construction,
 * the HTTP call (browser UA + timeout, same posture as the B3 fetcher), and
 * protocol-level response classification. No parsing beyond "is this the
 * throttle message", no persistence, no business logic.
 *
 * API notes (live-verified 2026-07-18):
 *  - Endpoint: https://api.gdeltproject.org/api/v2/doc/doc, mode=artlist,
 *    format=json, maxrecords ≤ 250, startdatetime/enddatetime = YYYYMMDDHHMMSS (UTC).
 *  - Coverage starts 2017-01-01.
 *  - The API asks for ≤1 request / 5 seconds. Exceeding it returns **HTTP 429**
 *    with a plain-text body ("Please limit requests to one every 5 seconds…").
 *    The fetcher passes that body through (unlike the live-feed fetcher, which
 *    nulls every non-200) so the download layer can tell "throttled — back off
 *    and retry" apart from "dead endpoint" — a throttled window must never
 *    silently look empty or merely failed.
 */

export const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** Hard API cap on records per response. A full window may be truncated at this. */
export const GDELT_MAX_RECORDS = 250;

/** Earliest date the DOC API has coverage for. */
export const GDELT_COVERAGE_START = new Date(Date.UTC(2017, 0, 1));

const toGdeltDatetime = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}` +
  `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}`;

/** Builds one DOC API artlist request URL for a query over a UTC time window. */
export const buildDocApiUrl = (query: string, start: Date, end: Date, maxRecords: number = GDELT_MAX_RECORDS): string => {
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(maxRecords),
    sort: 'datedesc',
    startdatetime: toGdeltDatetime(start),
    enddatetime: toGdeltDatetime(end),
  });
  return `${GDELT_DOC_API}?${params.toString()}`;
};

/**
 * True when the payload is GDELT's rate-limit message (served with HTTP 429,
 * plain text) rather than a JSON result.
 */
export const isThrottleResponse = (payload: string): boolean =>
  payload.trimStart().startsWith('Please limit requests');

/**
 * Fetches one DOC API URL. Returns the raw payload string for HTTP 200 AND
 * for HTTP 429 (the throttle message body, so callers can detect it via
 * `isThrottleResponse` and back off); null on any other failure (no-throw,
 * same degradation contract as the live feeds).
 */
/**
 * The DOC API can take tens of seconds on 250-record windows (and stalls when
 * the IP is inside its rate-limit penalty) — observed live. Give it a more
 * generous floor than the live feeds' snappy RSS timeout.
 */
const FETCH_TIMEOUT_MS = Math.max(env.NEWS_FETCH_TIMEOUT_MS, 30_000);

export const fetchGdeltPayload = async (url: string): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*' },
    });
    if (!res.ok && res.status !== 429) {
      logger.warn(`[GDELT]: fetch → HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    logger.warn(`[GDELT]: fetch failed: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
};
