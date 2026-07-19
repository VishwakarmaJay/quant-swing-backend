import { mapArticleSymbols } from '@/news';
import { prisma } from '@services/prisma';

/**
 * Re-runs the symbol mapper over the stored archive with the CURRENT alias
 * dictionary and updates rows whose tags changed (ROADMAP B3 growth loop —
 * grow aliases from the unmatched log, then remap; precedent: the SBI
 * exclusion remap, institutionalized).
 *
 *   bun run news:remap            # remap every article
 *   bun run news:remap --unmatched-only
 *
 * Idempotent; running twice changes nothing the second time. NOTE: this is
 * exactly the "entity resolution is retroactively mutable" property the
 * architecture review flagged — remap consciously, note the date, and expect
 * mapped-count metrics to move.
 */

const BATCH = 500;

const run = async () => {
  const unmatchedOnly = process.argv.includes('--unmatched-only');
  const where = unmatchedOnly ? { symbols: { isEmpty: true } } : {};

  const total = await prisma.newsArticle.count({ where });
  console.log(`Remapping ${total} article(s)${unmatchedOnly ? ' (unmatched only)' : ''}…`);

  let scanned = 0;
  let changed = 0;
  let newlyMapped = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.newsArticle.findMany({
      where,
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, title: true, body: true, symbols: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      scanned++;
      const { symbols } = mapArticleSymbols(row.title, row.body);
      const same = symbols.length === row.symbols.length && symbols.every((s, i) => s === row.symbols[i]);
      if (same) continue;
      await prisma.newsArticle.update({ where: { id: row.id }, data: { symbols } });
      changed++;
      if (row.symbols.length === 0 && symbols.length > 0) newlyMapped++;
    }
    if (scanned % 5000 < BATCH) console.log(`  ${scanned}/${total} scanned · ${changed} changed`);
  }

  console.log(`\nRemap complete: ${scanned} scanned · ${changed} retagged · ${newlyMapped} newly mapped`);
};

run()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
