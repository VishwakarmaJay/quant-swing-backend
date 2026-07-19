import { env } from '@config/env';
import logger from '@services/logger';
import { prisma } from '@services/prisma';
import { NewsOrigin } from '@generated/prisma/enums';

import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';

import { DatedTitleIndex, normalizeTitle } from '../dedupe';
import { mapArticleSymbols } from '../symbolMapper';
import { GDELT_COVERAGE_START } from './gdeltClient';
import { buildSymbolQuery, downloadWindowBatch, sliceDateRange, windowDays } from './download';
import { toGdeltRecords, type GdeltRecord } from './parser';

/**
 * GDELT historical backfill (ROADMAP B3.5) — batch persistence into the SAME
 * `news_article` archive the live collector writes, through the SAME dedup and
 * symbol-mapping code. Historical rows differ from live rows in exactly two
 * honest ways:
 *
 *  - `origin = GDELT` (provenance — research always knows retro-imported from
 *    live-captured);
 *  - `availableAt = publishedAt + GDELT_LATENCY_MINUTES` (reconstructed
 *    availability — we were not running then, so we must not pretend the
 *    article was actionable the instant it was printed). For live rows
 *    `availableAt = fetchedAt` as always. `fetchedAt` on a GDELT row is merely
 *    the import time.
 *
 * Idempotent: (source='GDELT', url) is the stable identity — the DB unique key
 *  plus a pre-loaded existing-URL set make re-runs create zero duplicates —
 *  and the Jaccard title dedup additionally absorbs cross-source syndication
 *  exactly as it does live.
 */

/** `NewsArticle.source` value for GDELT-imported rows. */
export const GDELT_SOURCE = 'GDELT';

export type BackfillStats = {
  daysProcessed: number;
  /** Distinct articles returned by GDELT (after per-window URL merge). */
  downloaded: number;
  /** Skipped: near-duplicate headline (Jaccard vs archive + in-run corpus). */
  duplicates: number;
  /** Skipped: this (source,url) is already in the archive (idempotent re-run). */
  alreadyStored: number;
  /** New rows persisted (0 in dry-run — `wouldStore` carries the count). */
  stored: number;
  /** Stored/storable rows that matched ≥1 universe symbol. */
  mapped: number;
  /** Stored/storable rows that matched no universe symbol (still archived). */
  unmatched: number;
  /** Windows×queries that hit the 250-record API cap (possible truncation). */
  truncatedQueries: number;
  /** Windows×queries that failed (fetch error / persistent throttle). */
  failedQueries: number;
};

const emptyStats = (): BackfillStats => ({
  daysProcessed: 0,
  downloaded: 0,
  duplicates: 0,
  alreadyStored: 0,
  stored: 0,
  mapped: 0,
  unmatched: 0,
  truncatedQueries: 0,
  failedQueries: 0,
});

/** A processed historical article, shaped for `newsArticle.createMany`. */
export type GdeltRow = {
  source: typeof GDELT_SOURCE;
  url: string;
  title: string;
  titleNormalized: string;
  body: string | null;
  symbols: string[];
  publishedAt: Date;
  fetchedAt: Date;
  availableAt: Date;
  origin: typeof NewsOrigin.GDELT;
};

export type ProcessResult = {
  rows: GdeltRow[];
  duplicates: number;
  alreadyStored: number;
  mapped: number;
  unmatched: number;
  /** Capped sample of headlines that matched no symbol (dictionary growth). */
  unmatchedSample: string[];
};

/**
 * Pure processing core: GDELT records → persistable rows + stats. Order of
 * checks mirrors an idempotent re-run's needs:
 *  1. (source,url) already stored → `alreadyStored` (identity, not similarity);
 *  2. Jaccard near-duplicate vs archive titles published within
 *     ±NEWS_DEDUPE_WINDOW_DAYS of the record's own time (the live recency
 *     rule in article time — an unwindowed multi-year corpus collapses every
 *     recurrence of a similar headline into its first occurrence);
 *  3. symbol-map via the live mapper (title only — GDELT has no body).
 *
 * Mutates `corpus` and `existingUrls` as rows are accepted so subsequent
 * windows in the same run see them.
 */
export const processGdeltRecords = (
  records: readonly GdeltRecord[],
  importedAt: Date,
  corpus: DatedTitleIndex,
  existingUrls: Set<string>,
  unmatchedSampleCap = 25,
): ProcessResult => {
  const rows: GdeltRow[] = [];
  const unmatchedSample: string[] = [];
  let duplicates = 0;
  let alreadyStored = 0;
  let mapped = 0;
  let unmatched = 0;

  for (const record of records) {
    if (existingUrls.has(record.url)) {
      alreadyStored++;
      continue;
    }
    const titleNormalized = normalizeTitle(record.title);
    if (!titleNormalized) continue;
    if (corpus.hasDuplicate(titleNormalized, record.publishedAt.getTime())) {
      duplicates++;
      continue;
    }

    const { symbols } = mapArticleSymbols(record.title, record.body ?? null);
    rows.push({
      source: GDELT_SOURCE,
      url: record.url,
      title: record.title,
      titleNormalized,
      body: record.body ?? null,
      symbols,
      publishedAt: record.publishedAt,
      fetchedAt: importedAt,
      availableAt: record.availableAt,
      origin: NewsOrigin.GDELT,
    });
    corpus.add(titleNormalized, record.publishedAt.getTime());
    existingUrls.add(record.url);
    if (symbols.length > 0) {
      mapped++;
    } else {
      unmatched++;
      if (unmatchedSample.length < unmatchedSampleCap) unmatchedSample.push(record.title);
    }
  }

  return { rows, duplicates, alreadyStored, mapped, unmatched, unmatchedSample };
};

export type BackfillOptions = {
  /** First calendar day to backfill (UTC). */
  from: Date;
  /** Last calendar day to backfill (UTC, inclusive). */
  to: Date;
  /** Universe symbols to query for; default = every symbol with aliases. */
  symbols?: readonly string[];
  /** Parse/dedupe/map but persist nothing. */
  dryRun?: boolean;
  /** Progress sink (one line per window); default = logger.info. */
  onProgress?: (line: string) => void;
};

export type BackfillSummary = {
  stats: BackfillStats;
  unmatchedSample: string[];
  /** Symbols requested but skipped for having no alias (nothing safe to query). */
  symbolsWithoutAliases: string[];
  dryRun: boolean;
};

/**
 * Loads the dedup corpus (normalized titles) and the existing GDELT URL set
 * for the backfill range. The corpus window is the article-time neighbourhood
 * of [from, to] — historical articles must be deduped against titles published
 * AROUND THEIR OWN TIME, not against today's fetch window (the live
 * `loadRecentTitles` recency rule transposed to archive time).
 */
const loadBackfillContext = async (from: Date, to: Date): Promise<{ corpus: DatedTitleIndex; existingUrls: Set<string> }> => {
  const pad = env.NEWS_DEDUPE_WINDOW_DAYS * 86_400_000;
  const rows = await prisma.newsArticle.findMany({
    where: { publishedAt: { gte: new Date(from.getTime() - pad), lte: new Date(to.getTime() + pad) } },
    select: { titleNormalized: true, url: true, source: true, publishedAt: true },
  });
  const corpus = new DatedTitleIndex(env.NEWS_DEDUPE_WINDOW_DAYS * 86_400_000);
  const existingUrls = new Set<string>();
  for (const r of rows) {
    corpus.add(r.titleNormalized, r.publishedAt.getTime());
    if (r.source === GDELT_SOURCE) existingUrls.add(r.url);
  }
  return { corpus, existingUrls };
};

/**
 * Runs the historical backfill: slice the range into GDELT_BATCH_DAYS windows,
 * download every symbol query per window (rate-limited), process through the
 * shared dedup + symbol mapper, and batch-persist with `createMany
 * skipDuplicates` (the (source,url) unique key is the final idempotency
 * backstop). Progress is reported per window.
 */
export const runGdeltBackfill = async (options: BackfillOptions): Promise<BackfillSummary> => {
  const { from, to, dryRun = false } = options;
  const onProgress = options.onProgress ?? ((line: string) => logger.info(`[GDELT]: ${line}`));

  if (from.getTime() > to.getTime()) throw new Error('--from must be on or before --to');
  if (from.getTime() < GDELT_COVERAGE_START.getTime()) {
    throw new Error(`GDELT DOC API coverage starts ${GDELT_COVERAGE_START.toISOString().slice(0, 10)} — --from is earlier`);
  }

  const universe = new Set(EQUITY_UNIVERSE.map((e) => e.symbol));
  const requested = options.symbols ?? [...universe];
  const unknown = requested.filter((s) => !universe.has(s));
  if (unknown.length) throw new Error(`Unknown universe symbol(s): ${unknown.join(', ')}`);

  const queries: { symbol: string; query: string }[] = [];
  const symbolsWithoutAliases: string[] = [];
  for (const symbol of requested) {
    const query = buildSymbolQuery(symbol);
    if (query === null) {
      symbolsWithoutAliases.push(symbol);
    } else {
      queries.push({ symbol, query });
    }
  }
  if (queries.length === 0) throw new Error('No queryable symbols (none of the requested symbols have aliases)');

  const importedAt = new Date();
  const windows = sliceDateRange(from, to, env.GDELT_BATCH_DAYS);
  const { corpus, existingUrls } = await loadBackfillContext(from, to);
  const stats = emptyStats();
  const unmatchedSample: string[] = [];

  onProgress(
    `backfill ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} · ` +
      `${windows.length} window(s) × ${queries.length} symbol quer${queries.length === 1 ? 'y' : 'ies'}` +
      (dryRun ? ' · DRY RUN (nothing will be stored)' : ''),
  );

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let firstWindow = true;
  for (const window of windows) {
    // Pace between windows too — downloadWindowBatch only paces between the
    // queries INSIDE a window, so single-query symbols would otherwise fire
    // consecutive window requests back-to-back.
    if (!firstWindow && env.GDELT_RATE_LIMIT_MS > 0) await sleep(env.GDELT_RATE_LIMIT_MS);
    firstWindow = false;
    const batch = await downloadWindowBatch(queries, window);
    stats.truncatedQueries += batch.truncatedQueries;
    stats.failedQueries += batch.failedQueries;

    const records = toGdeltRecords(batch.articles, env.GDELT_LATENCY_MINUTES);
    stats.downloaded += records.length;

    const processed = processGdeltRecords(records, importedAt, corpus, existingUrls);
    stats.duplicates += processed.duplicates;
    stats.alreadyStored += processed.alreadyStored;
    stats.mapped += processed.mapped;
    stats.unmatched += processed.unmatched;
    for (const t of processed.unmatchedSample) if (unmatchedSample.length < 25) unmatchedSample.push(t);

    if (!dryRun && processed.rows.length > 0) {
      // Batch persistence; skipDuplicates makes a concurrent live-ingest or an
      // interrupted-then-resumed run harmless ((source,url) unique key).
      const { count } = await prisma.newsArticle.createMany({ data: processed.rows, skipDuplicates: true });
      stats.stored += count;
      stats.alreadyStored += processed.rows.length - count;
    }
    const wouldStore = dryRun ? ` (would store ${processed.rows.length})` : '';

    stats.daysProcessed += windowDays(window);
    onProgress(
      `${window.start.toISOString().slice(0, 10)}..${window.end.toISOString().slice(0, 10)} — ` +
        `days ${stats.daysProcessed} · downloaded ${stats.downloaded} · dupes ${stats.duplicates} · ` +
        `already ${stats.alreadyStored} · stored ${stats.stored}${wouldStore} · mapped ${stats.mapped} · ` +
        `unmatched ${stats.unmatched}` +
        (batch.failedQueries ? ` · ⚠️ ${batch.failedQueries} failed quer${batch.failedQueries === 1 ? 'y' : 'ies'}` : ''),
    );
  }

  return { stats, unmatchedSample, symbolsWithoutAliases, dryRun };
};
