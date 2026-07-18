import { cleanText } from '../rssParser';

/**
 * GDELT DOC 2.0 API response parsing (ROADMAP B3.5). Pure conversion of the
 * artlist JSON payload into the internal historical-article model — no I/O,
 * no persistence. Tolerant by the same rule as the RSS parser: a malformed
 * item is skipped, never thrown.
 *
 * Timestamp reconstruction (the point-in-time heart of B3.5):
 *  - `publishedAt`  = GDELT's `seendate` — when GDELT's global crawler first
 *    saw the article. GDELT crawls continuously, so this is the closest honest
 *    proxy for publication time a historical source can offer.
 *  - `availableAt`  = publishedAt + a configured latency margin
 *    (GDELT_LATENCY_MINUTES, default 30) — the moment OUR live collector could
 *    plausibly have captured it, had it been running. Never earlier than
 *    publication, never assumed instantaneous.
 */

/** One article as returned by the DOC API's artlist JSON mode (verified live). */
export type GdeltArticle = {
  url: string;
  title: string;
  /** GDELT crawl-time, `YYYYMMDDTHHMMSSZ` (UTC). */
  seendate: string;
  domain: string;
  language: string;
  sourcecountry: string;
};

/** A GDELT article converted to the internal historical model, ready to process. */
export type GdeltRecord = {
  url: string;
  title: string;
  /** Publication proxy: GDELT seendate (UTC). */
  publishedAt: Date;
  /** Reconstructed as-of moment: publishedAt + latency margin (UTC). */
  availableAt: Date;
  /** Publisher domain (kept for provenance/debugging; not persisted today). */
  domain: string;
};

/** Parses GDELT's `YYYYMMDDTHHMMSSZ` seendate into a UTC Date, or null. */
export const parseSeendate = (seendate: string): Date | null => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
  // Reject impossible calendar values that Date.UTC would silently roll over.
  return date.getUTCMonth() === +mo! - 1 && date.getUTCDate() === +d! ? date : null;
};

/**
 * Reconstructs the honest availability moment for a historical article:
 * publishedAt + latency minutes. This is THE as-of timestamp research reads —
 * live rows get `availableAt = fetchedAt` instead (see ingest.ts).
 */
export const reconstructAvailableAt = (publishedAt: Date, latencyMinutes: number): Date =>
  new Date(publishedAt.getTime() + latencyMinutes * 60_000);

/**
 * GDELT tokenizes punctuation in titles ("2 , 200 % profit", "3 . 5 Crore" —
 * observed live). Reattach punctuation to the preceding token and collapse
 * whitespace so stored titles read normally. Dedup/symbol-matching are both
 * punctuation-insensitive, so this is cosmetic-but-deterministic.
 */
export const cleanGdeltTitle = (title: string): string =>
  cleanText(title)
    .replace(/\s+([,.:;!?%])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Parses a DOC API artlist JSON payload into raw GDELT articles.
 *
 * Returns `null` when the payload is not JSON at all — an API error notice,
 * an HTML block page, the throttle message — so the caller can mark the
 * window FAILED instead of silently treating it as a quiet news period.
 * Valid JSON without articles (GDELT returns `{}` for an empty window) is a
 * genuine empty result: `[]`.
 */
export const parseGdeltPayload = (payload: string): GdeltArticle[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const articles = (parsed as { articles?: unknown })?.articles;
  if (!Array.isArray(articles)) return [];

  const out: GdeltArticle[] = [];
  for (const item of articles) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    if (typeof a.url !== 'string' || !a.url.trim()) continue;
    if (typeof a.title !== 'string' || !a.title.trim()) continue;
    if (typeof a.seendate !== 'string') continue;
    out.push({
      url: a.url.trim(),
      title: a.title,
      seendate: a.seendate,
      domain: typeof a.domain === 'string' ? a.domain : '',
      language: typeof a.language === 'string' ? a.language : '',
      sourcecountry: typeof a.sourcecountry === 'string' ? a.sourcecountry : '',
    });
  }
  return out;
};

/**
 * Converts raw GDELT articles into internal records with reconstructed
 * timestamps. Articles with an unparseable seendate or an empty cleaned title
 * are skipped (tolerant-parser rule).
 */
export const toGdeltRecords = (articles: GdeltArticle[], latencyMinutes: number): GdeltRecord[] => {
  const out: GdeltRecord[] = [];
  for (const a of articles) {
    const publishedAt = parseSeendate(a.seendate);
    if (!publishedAt) continue;
    const title = cleanGdeltTitle(a.title);
    if (!title) continue;
    out.push({
      url: a.url,
      title,
      publishedAt,
      availableAt: reconstructAvailableAt(publishedAt, latencyMinutes),
      domain: a.domain,
    });
  }
  return out;
};
