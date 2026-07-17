import { buildFeatureBundle, buildStockContext, factors } from '@/factors';
import { prisma } from '@services/prisma';

/**
 * Evaluate the registered factors over the underlying-index OHLCV history and
 * print the FeatureBundle — the Phase 2 proof (factor layer running on real
 * data). Read-only.
 *
 *   bun run factors:eval            # all 3 indices
 *   bun run factors:eval NIFTY      # one underlying by name
 */
const run = async () => {
  const [nameArg] = process.argv.slice(2);

  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: 'AMXIDX', ...(nameArg ? { name: nameArg.toUpperCase() } : {}) },
    orderBy: { name: 'asc' },
  });

  if (!instruments.length) {
    console.error('No matching AMXIDX instruments — run "bun run backfill:ohlcv" first.');
    process.exitCode = 1;
    return;
  }

  for (const instrument of instruments) {
    const ctx = await buildStockContext(instrument.id);
    if (!ctx) continue;

    const bundle = buildFeatureBundle(ctx, factors);
    console.log(`\n=== ${instrument.name} (${ctx.symbol}) as of ${ctx.asOf} ===`);
    console.log(`candles=${ctx.candles.length}  dataQuality=${bundle.dataQualityScore}`);
    for (const [name, r] of Object.entries(bundle.results)) {
      console.log(
        `  [${name}] score=${r.score} lean=${r.agreementContribution} (${r.executionTimeMs}ms)`,
      );
      for (const line of r.explanations) console.log(`      • ${line}`);
      console.log(`      metrics: ${JSON.stringify(r.metrics)}`);
    }
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
