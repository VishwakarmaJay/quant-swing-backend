import { aliasCoverage, ingestNews } from '@/news';
import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';
import { prisma } from '@services/prisma';

const EQUITY_COUNT = EQUITY_UNIVERSE.length;

/**
 * Manual news ingestion run (ROADMAP B3).
 *
 *   bun run news:ingest
 *
 * Fetches every feed once and prints per-source volume/dupe/unmatched counts so a
 * dead or renamed feed is caught immediately, plus a sample of unmatched
 * headlines (dictionary-growth candidates) and the alias-coverage gaps. Needs
 * networked infra (live feeds) + a reachable database.
 */
const pad = (s: string | number, w: number) => String(s).padEnd(w);

const run = async () => {
  const summary = await ingestNews();

  console.log(`\nNews ingest @ ${summary.fetchedAt.toISOString()}\n`);
  console.log(
    `  ${pad('source', 20)} ${pad('parsed', 8)} ${pad('new', 6)} ${pad('dupes', 7)} ${pad('stored', 7)} ${pad('unmatched', 10)} ${pad('newest item', 22)} status`,
  );
  const staleCutoff = summary.fetchedAt.getTime() - 3 * 86_400_000;
  for (const r of summary.perSource) {
    // A feed whose newest item is days old is FROZEN even when counts look healthy
    // (how Moneycontrol's RSS — dead since Apr 2024 — was caught).
    const frozen = r.newestItem !== null && Date.parse(r.newestItem) < staleCutoff;
    const status = r.error ?? (frozen ? '⚠️ FROZEN? newest item is >3d old' : 'ok');
    console.log(
      `  ${pad(r.source, 20)} ${pad(r.parsed, 8)} ${pad(r.inserted, 6)} ${pad(r.duplicates, 7)} ` +
        `${pad(r.alreadyStored, 7)} ${pad(r.unmatched, 10)} ${pad(r.newestItem?.slice(0, 16) ?? '—', 22)} ${status}`,
    );
  }
  const t = summary.totals;
  console.log(
    `\n  TOTAL: ${t.inserted} new / ${t.parsed} parsed · ${t.duplicates} dupes · ` +
      `${t.alreadyStored} already stored · ${t.unmatched} unmatched`,
  );

  if (summary.unmatchedSample.length) {
    console.log(`\n  Unmatched headlines (grow the alias dictionary):`);
    for (const h of summary.unmatchedSample) console.log(`    · ${h}`);
  }

  const cov = aliasCoverage();
  if (cov.unknownAliasKeys.length) {
    console.log(`\n  ⚠️ Alias keys not in the universe (typos?): ${cov.unknownAliasKeys.join(', ')}`);
  }
  console.log(
    `\n  Alias coverage: ${EQUITY_COUNT - cov.uncovered.length}/${EQUITY_COUNT} universe symbols have aliases` +
      (cov.uncovered.length ? ` (missing: ${cov.uncovered.join(', ')})` : ''),
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
