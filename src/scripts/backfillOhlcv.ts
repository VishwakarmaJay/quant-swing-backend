import { hasAngelOneCredentials } from '@services/angelOne';
import { prisma } from '@services/prisma';
import { backfillInstruments } from '@/ohlcv';

/**
 * OHLCV backfill script: fetch, validate, and persist daily history.
 *
 * Usage:
 *   bun run backfill:ohlcv                 # whole universe (equities + indices), 400 days
 *   bun run backfill:ohlcv equities        # just the equity universe
 *   bun run backfill:ohlcv indices         # just the 3 underlying indices
 *   bun run backfill:ohlcv RELIANCE        # one instrument by name
 *   bun run backfill:ohlcv RELIANCE 500    # ...with a custom lookback
 */

const DEFAULT_DAYS = 400; // ~265 trading days — comfortable margin over EMA200

const scopeWhere = (arg?: string) => {
  switch ((arg ?? '').toLowerCase()) {
    case '':
    case 'all':
      return { instrumentType: { in: ['EQ', 'AMXIDX'] } };
    case 'equities':
    case 'eq':
      return { instrumentType: 'EQ' };
    case 'indices':
    case 'index':
      return { instrumentType: 'AMXIDX' };
    default:
      return { name: arg!.toUpperCase() };
  }
};

const run = async () => {
  if (!hasAngelOneCredentials()) {
    console.error('Angel One credentials not set — cannot fetch historical candles.');
    process.exitCode = 1;
    return;
  }

  const [scopeArg, daysArg] = process.argv.slice(2);
  const days = Number(daysArg) || DEFAULT_DAYS;

  const instruments = await prisma.instrument.findMany({
    where: scopeWhere(scopeArg),
    orderBy: [{ instrumentType: 'asc' }, { name: 'asc' }],
  });

  if (!instruments.length) {
    console.error(`No matching instruments for "${scopeArg ?? 'all'}". Run "bun run sync:instruments" first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Backfilling ${days} days for ${instruments.length} instrument(s)…\n`);

  const results = await backfillInstruments(instruments, days);

  const low = results.filter((r) => r.quality.score < 0.8);
  console.log('\n=== Backfill summary ===');
  console.log(`  instruments: ${results.length}`);
  console.log(`  candles persisted: ${results.reduce((s, r) => s + r.persisted, 0)}`);
  console.log(`  quality OK (≥0.8): ${results.length - low.length}   LOW (<0.8): ${low.length}`);
  if (low.length) {
    console.log('\n  LOW-quality instruments (likely short history / recent listings):');
    for (const r of low) {
      console.log(
        `    ${r.symbol.padEnd(14)} quality=${r.quality.score} ` +
          `(${r.quality.metrics.total} candles) — ${r.quality.warnings.join('; ')}`,
      );
    }
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
