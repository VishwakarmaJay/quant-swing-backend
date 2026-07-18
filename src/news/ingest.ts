import { env } from '@config/env';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import { isDuplicateTitle, normalizeTitle } from './dedupe';
import { fetchFeed } from './fetch';
import { parseFeed } from './rssParser';
import { NEWS_SOURCES, resolveSourceUrls } from './sources';
import { mapArticleSymbols } from './symbolMapper';
import { originForSource, type NewsSource, type NewsSourceId, type RawFeedItem } from './types';

/** Per-source outcome of one ingestion run (for monitoring volume/dupe rate). */
export type SourceResult = {
  source: NewsSourceId;
  /** Raw items parsed from the feed. */
  parsed: number;
  /** New articles written this run. */
  inserted: number;
  /** Items skipped as near-duplicates (Jaccard) of a recent headline. */
  duplicates: number;
  /** Items skipped because the (source,url) already exists. */
  alreadyStored: number;
  /** Inserted articles that matched zero universe symbols (dictionary-growth log). */
  unmatched: number;
  /**
   * Newest feed-declared publish time among parsed items (ISO), or null. A feed
   * whose newest item is days old is FROZEN even though counts look healthy —
   * this is how Moneycontrol's dead RSS (frozen at Apr 2024) is caught.
   */
  newestItem: string | null;
  /** null on success; a short message when the feed fetch/parse failed. */
  error: string | null;
};

export type IngestSummary = {
  fetchedAt: Date;
  perSource: SourceResult[];
  totals: { parsed: number; inserted: number; duplicates: number; alreadyStored: number; unmatched: number };
  /** A capped sample of unmatched headlines to review for new aliases. */
  unmatchedSample: string[];
};

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

/** Recent normalized titles (within the dedupe window) — the cross-source corpus. */
const loadRecentTitles = async (fetchedAt: Date): Promise<string[]> => {
  const cutoff = new Date(fetchedAt.getTime() - env.NEWS_DEDUPE_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.newsArticle.findMany({
    where: { fetchedAt: { gte: cutoff } },
    select: { titleNormalized: true },
  });
  return rows.map((r) => r.titleNormalized);
};

/**
 * One ingestion pass over all feeds (ROADMAP B3). Fetch → parse → symbol-map →
 * cross-source dedup → persist, per source, degrading independently: one dead
 * feed does not stop the others. Idempotent — re-running only adds genuinely new
 * articles ((source,url) unique + Jaccard near-dup skip).
 *
 * `fetchedAt` is stamped once per run and, for live capture, IS the article's
 * as-of date (lookahead discipline) — never the feed's own `publishedAt`.
 * B3.5: `availableAt` (the field all research reads) is set equal to
 * `fetchedAt` here; only the historical GDELT backfill reconstructs it from
 * `publishedAt` + latency. `origin` records the collection path.
 */
export const ingestNews = async (sources: readonly NewsSource[] = NEWS_SOURCES): Promise<IngestSummary> => {
  const fetchedAt = new Date();
  // Corpus of recent normalized titles; grown in-memory as we accept articles so
  // the same story arriving from two feeds in one run is deduped too.
  const corpus = new Set(await loadRecentTitles(fetchedAt));
  const unmatchedSample: string[] = [];

  const perSource: SourceResult[] = [];

  for (const source of sources) {
    const result: SourceResult = {
      source: source.id,
      parsed: 0,
      inserted: 0,
      duplicates: 0,
      alreadyStored: 0,
      unmatched: 0,
      newestItem: null,
      error: null,
    };

    // A source may resolve to several URLs (BSE: yesterday + today single-day
    // windows). Failed only when every URL fails; partial results still count.
    const urls = resolveSourceUrls(source, fetchedAt);
    const items: RawFeedItem[] = [];
    let failedUrls = 0;
    for (const url of urls) {
      const payload = await fetchFeed(url, source.headers);
      if (payload === null) {
        failedUrls++;
        continue;
      }
      items.push(...parseFeed(payload, source.dialect));
    }
    if (failedUrls === urls.length) {
      result.error = 'fetch failed';
      perSource.push(result);
      continue;
    }

    result.parsed = items.length;
    result.newestItem =
      items.reduce<string | null>((max, i) => (i.publishedAt && (!max || i.publishedAt > max) ? i.publishedAt : max), null);

    for (const item of items) {
      const title = item.title.trim();
      if (!title) continue;
      const titleNormalized = normalizeTitle(title);

      if (isDuplicateTitle(titleNormalized, corpus)) {
        result.duplicates++;
        continue;
      }

      const { symbols } = mapArticleSymbols(title, item.body);
      // Stable key when a feed omits the link (e.g. some BSE rows).
      const url = item.url?.trim() || `urn:${source.id}:${titleNormalized}`;
      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : fetchedAt;

      try {
        await prisma.newsArticle.create({
          data: {
            source: source.id,
            url,
            title,
            titleNormalized,
            body: item.body,
            symbols,
            publishedAt,
            fetchedAt,
            // Live capture: the moment we fetched it is the moment we could act on it.
            availableAt: fetchedAt,
            origin: originForSource(source.id),
          },
        });
        result.inserted++;
        corpus.add(titleNormalized);
        if (symbols.length === 0) {
          result.unmatched++;
          if (unmatchedSample.length < 25) unmatchedSample.push(title);
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          result.alreadyStored++;
        } else {
          logger.error(`[News]: insert failed (${source.id}): ${err instanceof Error ? err.message : err}`);
          result.error = 'insert error';
        }
      }
    }

    perSource.push(result);
  }

  const totals = perSource.reduce(
    (a, r) => ({
      parsed: a.parsed + r.parsed,
      inserted: a.inserted + r.inserted,
      duplicates: a.duplicates + r.duplicates,
      alreadyStored: a.alreadyStored + r.alreadyStored,
      unmatched: a.unmatched + r.unmatched,
    }),
    { parsed: 0, inserted: 0, duplicates: 0, alreadyStored: 0, unmatched: 0 },
  );

  logger.info(
    `[News]: ingest — ${totals.inserted} new / ${totals.parsed} parsed, ` +
      `${totals.duplicates} dupes, ${totals.alreadyStored} already stored, ${totals.unmatched} unmatched`,
  );

  // B6: keep the archive scored as it grows. No-throw degraded-neutral — a
  // down sidecar leaves rows unscored; the next ingest (or `sentiment:score`)
  // catches up. Import is lazy so ingest tests never touch the scoring path.
  try {
    const { scoreUnscoredArticles } = await import('./scoreArticles');
    const s = await scoreUnscoredArticles();
    if (s.degraded && s.modelVersion === null) {
      logger.warn('[News]: sentiment sidecar down — new articles left unscored (will catch up)');
    } else if (s.scored.length > 0) {
      logger.info(`[News]: sentiment — scored ${s.scored.length} article(s) with ${s.modelVersion}`);
    }
  } catch (err) {
    logger.warn(`[News]: sentiment scoring skipped: ${err instanceof Error ? err.message : err}`);
  }

  return { fetchedAt, perSource, totals, unmatchedSample };
};
