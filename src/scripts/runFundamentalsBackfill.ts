import { backfillFundamentals } from '@/fundamentals';
import { prisma } from '@services/prisma';

/**
 * Historical fundamentals backfill (ROADMAP B4). Point-in-time honest:
 * each quarter carries its BSE result-announcement date (`announcedAt`) or a
 * conservative SEBI-deadline fallback. Idempotent upserts — safe to re-run.
 *
 *   bun run fundamentals:backfill              # whole universe (~166 × 2 fetches, paced)
 *   bun run fundamentals:backfill RELIANCE TCS # specific symbols
 */
const run = async () => {
  const only = process.argv.slice(2);
  const s = await backfillFundamentals(only.length ? only : undefined);

  console.log(`\nFundamentals backfill @ ${s.fetchedAt.toISOString()}`);
  console.log(`  Symbols:            ${s.pagesOk}/${s.symbols} pages parsed`);
  console.log(`  Quarters upserted:  ${s.quartersUpserted}`);
  console.log(`  Announcement-dated: ${s.withAnnouncedAt}`);
  console.log(`  Fallback-dated:     ${s.fallbackDated}   (SEBI deadline: periodEnd + 45/60d)`);
  if (s.failedSymbols.length) console.log(`  Failed:             ${s.failedSymbols.join(', ')}`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
