import { snapshotFundamentals } from '@/fundamentals';
import { prisma } from '@services/prisma';

/**
 * Manual fundamentals snapshot run (ROADMAP B4, clock #2). Also runs weekly via
 * the FUNDAMENTALS_SNAPSHOT cron. Each row stamps `fetchedAt` — the honest
 * as-of moment for the ratio values.
 *
 *   bun run fundamentals:snapshot              # whole universe
 *   bun run fundamentals:snapshot RELIANCE     # specific symbols
 */
const run = async () => {
  const only = process.argv.slice(2);
  const s = await snapshotFundamentals(only.length ? only : undefined);
  console.log(`\nFundamentals snapshot @ ${s.fetchedAt.toISOString()}`);
  console.log(`  Snapshots: ${s.snapshots}/${s.symbols}`);
  if (s.failedSymbols.length) console.log(`  Failed:    ${s.failedSymbols.join(', ')}`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
