import { env } from '@config/env';
import logger from '@services/logger';

/**
 * Thin, no-throw feed fetcher (ROADMAP B3). A slow or dead feed must never take
 * the ingestion run down — on any error it logs and returns null, and the
 * orchestrator records that source as failed for the run. The only network I/O
 * in the module, kept out of the pure parser/mapper/dedupe code so those stay
 * unit-testable.
 *
 * User-Agent: a standard browser string, NOT a "(compatible; …Bot)" identifier —
 * live-verified 2026-07: Moneycontrol (Akamai) and BSE's WAF return HTTP 403 to
 * bot-style UAs but 200 to a browser UA on the same public feed URLs. Per-source
 * extra headers (e.g. BSE's required Referer) are merged over the defaults.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const fetchFeed = async (url: string, headers?: Record<string, string>): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.NEWS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*',
        ...headers,
      },
    });
    if (!res.ok) {
      logger.warn(`[News]: fetch ${url} → HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    logger.warn(`[News]: fetch ${url} failed: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
};
