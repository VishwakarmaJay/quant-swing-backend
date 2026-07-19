import { mapArticleSymbols } from '@/news';
import { isIndianNewsDomain } from '@/news/indianDomains';
import { prisma } from '@services/prisma';
import { NewsOrigin } from '@generated/prisma/enums';

/**
 * Re-derives `symbols[]` for the stored archive with the CURRENT alias
 * dictionary + the GDELT domain filter (ROADMAP B3 growth loop; GDELT_PRECISION_FIX
 * S3+S4). For each row:
 *   symbols = (origin=GDELT AND non-Indian domain) ? []                       ← S3
 *                                                   : mapArticleSymbols(...)   ← S4
 *
 *   bun run news:remap             # re-derive every article
 *   bun run news:remap --dry-run   # count changes, write nothing
 *   bun run news:remap --unmatched-only
 *
 * The domain guard and the remap MUST be one pass: both write `symbols[]`, so a
 * naive remap would re-tag the very foreign rows a separate unmap had cleared.
 * Idempotent; running twice changes nothing the second time. NOTE: this is the
 * "entity resolution is retroactively mutable" property the architecture review
 * flagged — remap consciously, note the date, expect mapped-count metrics to move.
 */

const BATCH = 500;

/** Domain-aware tag derivation: foreign-domain GDELT rows resolve to no symbols. */
const deriveSymbols = (row: { origin: NewsOrigin; url: string; title: string; body: string | null }): string[] => {
  if (row.origin === NewsOrigin.GDELT && !isIndianNewsDomain(row.url)) return [];
  return mapArticleSymbols(row.title, row.body).symbols;
};

const run = async () => {
  const unmatchedOnly = process.argv.includes('--unmatched-only');
  const dryRun = process.argv.includes('--dry-run');
  const where = unmatchedOnly ? { symbols: { isEmpty: true } } : {};

  const total = await prisma.newsArticle.count({ where });
  console.log(`Remapping ${total} article(s)${unmatchedOnly ? ' (unmatched only)' : ''}${dryRun ? ' — DRY RUN' : ''}…`);

  let scanned = 0;
  let changed = 0;
  let foreignUnmapped = 0;
  let newlyMapped = 0;
  let nowUnmatched = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.newsArticle.findMany({
      where,
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, origin: true, url: true, title: true, body: true, symbols: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      scanned++;
      const symbols = deriveSymbols(row);
      const same = symbols.length === row.symbols.length && symbols.every((s, i) => s === row.symbols[i]);
      if (same) continue;
      changed++;
      if (row.symbols.length > 0 && symbols.length === 0) {
        nowUnmatched++;
        if (row.origin === NewsOrigin.GDELT && !isIndianNewsDomain(row.url)) foreignUnmapped++;
      }
      if (row.symbols.length === 0 && symbols.length > 0) newlyMapped++;
      if (!dryRun) await prisma.newsArticle.update({ where: { id: row.id }, data: { symbols } });
    }
    if (scanned % 10000 < BATCH) {
      console.log(`  ${scanned}/${total} scanned · ${changed} changed · ${foreignUnmapped} foreign-unmapped`);
    }
  }

  console.log(
    `\nRemap ${dryRun ? '(dry run) ' : ''}complete: ${scanned} scanned · ${changed} retagged · ` +
      `${foreignUnmapped} foreign-domain GDELT unmapped · ${nowUnmatched} total now-unmatched · ${newlyMapped} newly mapped`,
  );
};

run()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
