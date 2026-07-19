import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

import { env } from '@config/env';
import { prisma } from '@services/prisma';

import { cleanGdeltTitle, processGdeltRecords, reconstructAvailableAt, type GdeltRecord } from '@/news/gdelt';
import { DatedTitleIndex } from '@/news/dedupe';

/**
 * Imports a GAL NDJSON file (produced by `news:gal:download`) into the news
 * archive through the SAME processing core as the DOC-API backfill
 * (`processGdeltRecords`): URL identity → time-windowed Jaccard dedup →
 * symbol mapper → origin=GDELT rows with availableAt = date + latency.
 *
 *   bun run news:gal:import --file .cache/gal-matched.ndjson [--dry-run]
 *
 * Idempotent — (source='GDELT', url) unique + skipDuplicates; safe to re-run
 * and safe alongside rows the DOC-API run already stored.
 */

const usage = (): never => {
  console.error('Usage: bun run news:gal:import --file <ndjson> [--dry-run]');
  process.exit(1);
};

const parseArgs = (argv: string[]) => {
  let file: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--file') file = argv[++i];
    else if (a === '--dry-run') dryRun = true;
    else usage();
  }
  if (!file) usage();
  return { file: file!, dryRun };
};

const BATCH = 2_000;

const run = async () => {
  const { file, dryRun } = parseArgs(process.argv.slice(2));
  const importedAt = new Date();

  // Context: existing GDELT urls + dated titles across the whole archive
  // (the GAL range is wide — load once, mutate as we go, same as backfill).
  const existing = await prisma.newsArticle.findMany({
    select: { titleNormalized: true, url: true, source: true, publishedAt: true },
  });
  const corpus = new DatedTitleIndex(env.NEWS_DEDUPE_WINDOW_DAYS * 86_400_000);
  const existingUrls = new Set<string>();
  for (const r of existing) {
    corpus.add(r.titleNormalized, r.publishedAt.getTime());
    if (r.source === 'GDELT') existingUrls.add(r.url);
  }
  console.log(`Context: ${existing.length} archive titles · ${existingUrls.size} GDELT urls`);

  const totals = { read: 0, invalid: 0, duplicates: 0, alreadyStored: 0, stored: 0, mapped: 0, unmatched: 0 };
  let batch: GdeltRecord[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const processed = processGdeltRecords(batch, importedAt, corpus, existingUrls);
    totals.duplicates += processed.duplicates;
    totals.alreadyStored += processed.alreadyStored;
    totals.mapped += processed.mapped;
    totals.unmatched += processed.unmatched;
    if (!dryRun && processed.rows.length > 0) {
      const { count } = await prisma.newsArticle.createMany({ data: processed.rows, skipDuplicates: true });
      totals.stored += count;
      totals.alreadyStored += processed.rows.length - count;
    } else if (dryRun) {
      totals.stored += processed.rows.length;
    }
    batch = [];
  };

  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    totals.read++;
    let rec: { date: string; url: string; domain?: string; title: string; desc?: string };
    try {
      rec = JSON.parse(line);
    } catch {
      totals.invalid++;
      continue;
    }
    const publishedAt = new Date(rec.date);
    const title = cleanGdeltTitle(rec.title ?? '');
    if (!rec.url || !title || Number.isNaN(publishedAt.getTime())) {
      totals.invalid++;
      continue;
    }
    batch.push({
      url: rec.url,
      title,
      publishedAt,
      availableAt: reconstructAvailableAt(publishedAt, env.GDELT_LATENCY_MINUTES),
      domain: rec.domain ?? '',
      body: rec.desc?.trim() ? rec.desc.trim() : null,
    });
    if (batch.length >= BATCH) {
      await flush();
      if (totals.read % 20_000 < BATCH) {
        console.log(`  ${totals.read} read · stored ${totals.stored} · dupes ${totals.duplicates} · already ${totals.alreadyStored}`);
      }
    }
  }
  await flush();

  console.log(
    `\nGAL import ${dryRun ? '(dry run) ' : ''}complete: ${totals.read} read · ${totals.invalid} invalid · ` +
      `${totals.duplicates} dupes · ${totals.alreadyStored} already stored · stored ${totals.stored} · ` +
      `mapped ${totals.mapped} · unmatched ${totals.unmatched}`,
  );
  if (!dryRun && totals.stored > 0) {
    console.log('  Note: new rows are unscored — the ingest cron (or `bun run sentiment:score`) catches up.');
  }
};

run()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
