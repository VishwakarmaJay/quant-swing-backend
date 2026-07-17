import { prisma } from '@services/prisma';
import { runOhlcvIncremental } from '@/ohlcv';

/**
 * Manual trigger for the nightly incremental OHLCV job (same function the
 * OHLCV_INCREMENTAL cron runs). Brings every history-bearing instrument
 * current from its last stored candle.
 *
 *   bun run ohlcv:update
 */
const run = async () => {
  const results = await runOhlcvIncremental();

  if (!results.length) {
    console.log('Nothing updated (no candle history yet, or credentials unset).');
    return;
  }

  console.log('\n=== Incremental update report ===');
  for (const r of results) {
    console.log(
      `${r.symbol.padEnd(12)} upserted=${String(r.upserted).padStart(3)} ` +
        `latest=${r.latestDate ?? '—'}` +
        (r.skippedMalformed ? ` (${r.skippedMalformed} malformed skipped)` : ''),
    );
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
