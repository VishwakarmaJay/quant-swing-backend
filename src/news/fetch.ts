import { env } from '@config/env';
import logger from '@services/logger';

/**
 * Thin, no-throw feed fetcher (ROADMAP B3). A slow or dead feed must never take
 * the ingestion run down — on any error it logs and returns null, and the
 * orchestrator records that source as failed for the run. The only network I/O
 * in the module, kept out of the pure parser/mapper/dedupe code so those stay
 * unit-testable.
 */
export const fetchFeed = async (url: string): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.NEWS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some feeds reject the default fetch UA; identify as a normal reader.
        'User-Agent': 'Mozilla/5.0 (compatible; QuantSwingNewsBot/1.0)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
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
