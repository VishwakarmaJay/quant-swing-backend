import { detectMarketRegime } from '@/regime';
import { prisma } from '@services/prisma';

/**
 * Prints the current market regime from Nifty trend + universe breadth.
 * Optionally pass a VIX reading (until the VIX feed is wired):
 *
 *   bun run regime:detect
 *   bun run regime:detect 22       # with a VIX of 22
 */
const run = async () => {
  const vixArg = process.argv[2];
  const vix = vixArg !== undefined ? Number(vixArg) : null;

  const result = await detectMarketRegime(new Date(), { vix });

  console.log(`\nMarket regime: ${result.regime}`);
  for (const line of result.explanations) console.log(`  • ${line}`);
  console.log(`  metrics: ${JSON.stringify(result.metrics)}`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
