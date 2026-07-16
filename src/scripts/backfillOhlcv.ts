import { hasAngelOneCredentials } from '@services/angelOne';
import { prisma } from '@services/prisma';
import { backfillInstruments } from '@/ohlcv';

/**
 * OHLCV backfill script — the Phase 1 "M1 proof" entry point: fetch, validate,
 * and persist daily history for one or more instruments.
 *
 * Usage:
 *   bun run backfill:ohlcv                 # all 3 underlying indices, 300 days
 *   bun run backfill:ohlcv NIFTY           # one underlying by name
 *   bun run backfill:ohlcv NIFTY 500       # ...with a custom lookback
 */

const run = async () => {
  if (!hasAngelOneCredentials()) {
    console.error('Angel One credentials not set — cannot fetch historical candles.');
    process.exitCode = 1;
    return;
  }

  const [nameArg, daysArg] = process.argv.slice(2);
  const days = Number(daysArg) || 300;

  const instruments = await prisma.instrument.findMany({
    where: {
      instrumentType: 'AMXIDX',
      ...(nameArg ? { name: nameArg.toUpperCase() } : {}),
    },
    orderBy: { name: 'asc' },
  });

  if (!instruments.length) {
    console.error(
      nameArg
        ? `No AMXIDX instrument named "${nameArg}". Run "bun run sync:instruments" first.`
        : 'No AMXIDX instruments in DB. Run "bun run sync:instruments" first.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Backfilling ${days} days for: ${instruments.map((i) => i.name).join(', ')}\n`);

  const results = await backfillInstruments(instruments, days);

  console.log('\n=== Backfill report ===');
  for (const r of results) {
    const flag = r.quality.score >= 0.8 ? 'OK ' : 'LOW';
    console.log(
      `[${flag}] ${r.symbol.padEnd(12)} fetched=${String(r.fetched).padStart(4)} ` +
        `persisted=${String(r.persisted).padStart(4)} quality=${r.quality.score} ` +
        `(${r.quality.metrics.total} candles, ${r.quality.metrics.malformed} malformed, ` +
        `continuity ${r.quality.metrics.continuity.toFixed(2)}, ${r.quality.metrics.stalenessDays}d stale)` +
        (r.quality.warnings.length ? `\n       warnings: ${r.quality.warnings.join('; ')}` : ''),
    );
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
