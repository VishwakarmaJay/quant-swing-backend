import { env } from '@config/env';
import { prisma } from '@services/prisma';
import { NewsOrigin } from '@generated/prisma/enums';

import { isDuplicateTitle, normalizeTitle } from '../dedupe';
import { sliceDateRange } from '../gdelt/download';
import { mapArticleSymbols } from '../symbolMapper';
import type { RawFeedItem } from '../types';
import { downloadScripWindow } from './download';

/**
 * BSE announcements historical backfill (ROADMAP B3.6) — the exchange-filings
 * counterpart to the GDELT media backfill (B3.5). Same archive, same pipeline
 * (parseBse → Jaccard dedup → symbol mapper → NewsArticle rows), with the
 * strongest availability evidence a historical source can carry:
 *
 *   availableAt = DissemDT (exchange dissemination, to the second)
 *                 + BSE_BACKFILL_LATENCY_MINUTES (the live poll's worst-case lag)
 *
 * Provenance: origin = BSE_BACKFILL (source stays 'BSE_ANNOUNCEMENTS' so the
 * (source,url) identity space is shared with live capture — overlapping days
 * dedupe instead of duplicating).
 */

/** `NewsArticle.source` for backfilled rows — same as live BSE capture. */
export const BSE_SOURCE = 'BSE_ANNOUNCEMENTS';

/** Window size (days) per API request — well under the page cap for one scrip. */
export const BSE_WINDOW_DAYS = 90;

export type BseSymbolStats = {
  windows: number;
  failedWindows: number;
  downloaded: number;
  duplicates: number;
  alreadyStored: number;
  stored: number;
  mapped: number;
  unmatched: number;
};

export type BseRow = {
  source: typeof BSE_SOURCE;
  url: string;
  title: string;
  titleNormalized: string;
  body: string | null;
  symbols: string[];
  publishedAt: Date;
  fetchedAt: Date;
  availableAt: Date;
  origin: typeof NewsOrigin.BSE_BACKFILL;
};

/** Stable identity for a row — attachment URL, or the live pipeline's urn fallback. */
export const bseRowKey = (url: string, titleNormalized: string): string =>
  url.trim() || `urn:${BSE_SOURCE}:${titleNormalized}`;

export type ProcessBseResult = {
  rows: BseRow[];
  duplicates: number;
  alreadyStored: number;
  mapped: number;
  unmatched: number;
};

/**
 * Pure processing core (mirrors the GDELT one): identity check → Jaccard
 * dedup → symbol mapping (title + SLONGNAME-prepended body) → persistable
 * rows. Items without a parseable dissemination time are skipped — no honest
 * `availableAt` can be reconstructed for them. Mutates `corpus`/`existingKeys`
 * so later windows and symbols in the same run see accepted rows.
 */
export const processBseItems = (
  items: readonly RawFeedItem[],
  importedAt: Date,
  latencyMinutes: number,
  corpus: Set<string>,
  existingKeys: Set<string>,
): ProcessBseResult => {
  const rows: BseRow[] = [];
  let duplicates = 0;
  let alreadyStored = 0;
  let mapped = 0;
  let unmatched = 0;

  for (const item of items) {
    const title = item.title.trim();
    if (!title || !item.publishedAt) continue;
    const publishedAt = new Date(item.publishedAt);
    if (Number.isNaN(publishedAt.getTime())) continue;

    const titleNormalized = normalizeTitle(title);
    if (!titleNormalized) continue;
    const key = bseRowKey(item.url, titleNormalized);
    if (existingKeys.has(key)) {
      alreadyStored++;
      continue;
    }
    if (isDuplicateTitle(titleNormalized, corpus)) {
      duplicates++;
      continue;
    }

    const { symbols } = mapArticleSymbols(title, item.body);
    rows.push({
      source: BSE_SOURCE,
      url: key,
      title,
      titleNormalized,
      body: item.body,
      symbols,
      publishedAt,
      fetchedAt: importedAt,
      availableAt: new Date(publishedAt.getTime() + latencyMinutes * 60_000),
      origin: NewsOrigin.BSE_BACKFILL,
    });
    corpus.add(titleNormalized);
    existingKeys.add(key);
    if (symbols.length > 0) mapped++;
    else unmatched++;
  }

  return { rows, duplicates, alreadyStored, mapped, unmatched };
};

/** Universe symbol → BSE scrip code, from the fundamentals archive (B4). */
export const loadScripCodes = async (): Promise<Record<string, string>> => {
  const rows = await prisma.quarterlyFundamental.findMany({
    where: { bseScripCode: { not: null } },
    select: { symbol: true, bseScripCode: true },
    distinct: ['symbol'],
  });
  const out: Record<string, string> = {};
  for (const r of rows) if (r.bseScripCode) out[r.symbol] = r.bseScripCode;
  return out;
};

/**
 * Dedup corpus + identity keys for the backfill range (article-time
 * neighbourhood, same rule as the GDELT backfill): normalized titles across
 * all sources, and existing BSE (source,url) keys.
 */
export const loadBseBackfillContext = async (
  from: Date,
  to: Date,
): Promise<{ corpus: Set<string>; existingKeys: Set<string> }> => {
  const pad = env.NEWS_DEDUPE_WINDOW_DAYS * 86_400_000;
  const rows = await prisma.newsArticle.findMany({
    where: { publishedAt: { gte: new Date(from.getTime() - pad), lte: new Date(to.getTime() + pad) } },
    select: { titleNormalized: true, url: true, source: true },
  });
  const corpus = new Set<string>();
  const existingKeys = new Set<string>();
  for (const r of rows) {
    corpus.add(r.titleNormalized);
    if (r.source === BSE_SOURCE) existingKeys.add(r.url);
  }
  return { corpus, existingKeys };
};

export type BseSymbolBackfillOptions = {
  symbol: string;
  scripCode: string;
  from: Date;
  to: Date;
  dryRun?: boolean;
  importedAt: Date;
  corpus: Set<string>;
  existingKeys: Set<string>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backfills one symbol: per-scrip wide-range windows (BSE_WINDOW_DAYS),
 * paced by BSE_BACKFILL_RATE_LIMIT_MS, batch-persisted with skipDuplicates
 * ((source,url) unique = the idempotency backstop). A failed window marks the
 * symbol incomplete — the caller retries; everything is idempotent.
 */
export const backfillBseSymbol = async (options: BseSymbolBackfillOptions): Promise<BseSymbolStats> => {
  const { scripCode, from, to, dryRun = false, importedAt, corpus, existingKeys } = options;
  const windows = sliceDateRange(from, to, BSE_WINDOW_DAYS);
  const stats: BseSymbolStats = {
    windows: windows.length,
    failedWindows: 0,
    downloaded: 0,
    duplicates: 0,
    alreadyStored: 0,
    stored: 0,
    mapped: 0,
    unmatched: 0,
  };

  let first = true;
  for (const window of windows) {
    if (!first && env.BSE_BACKFILL_RATE_LIMIT_MS > 0) await sleep(env.BSE_BACKFILL_RATE_LIMIT_MS);
    first = false;

    const { items, failed } = await downloadScripWindow(scripCode, window.start, window.end);
    if (failed) {
      stats.failedWindows++;
      continue;
    }
    stats.downloaded += items.length;

    const processed = processBseItems(items, importedAt, env.BSE_BACKFILL_LATENCY_MINUTES, corpus, existingKeys);
    stats.duplicates += processed.duplicates;
    stats.alreadyStored += processed.alreadyStored;
    stats.mapped += processed.mapped;
    stats.unmatched += processed.unmatched;

    if (!dryRun && processed.rows.length > 0) {
      const { count } = await prisma.newsArticle.createMany({ data: processed.rows, skipDuplicates: true });
      stats.stored += count;
      stats.alreadyStored += processed.rows.length - count;
    }
    if (dryRun) stats.stored += processed.rows.length; // "would store"
  }

  return stats;
};
