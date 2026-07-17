import { buildFeatureBundle, buildStockContext, factors, loadBenchmarkCandles } from '@/factors';
import { detectMarketRegime } from '@/regime';
import { WeightedStrategy, type StrategyEvaluation } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * Full decision pipeline over the equity universe: detect regime → run factors
 * → WeightedStrategy → ranked candidates + rejection breakdown. Read-only.
 *
 *   bun run strategy:eval          # uses the ATR volatility proxy for regime
 *   bun run strategy:eval 22       # with a VIX of 22
 */
const run = async () => {
  const vixArg = process.argv[2];
  const vix = vixArg !== undefined ? Number(vixArg) : null;

  const regime = await detectMarketRegime(new Date(), { vix });
  const benchmarkCandles = await loadBenchmarkCandles();
  const strategy = new WeightedStrategy();

  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: 'EQ' },
    orderBy: { name: 'asc' },
  });

  const evals: (StrategyEvaluation & { sector: string | null })[] = [];
  for (const inst of instruments) {
    const ctx = await buildStockContext(inst.id, new Date(), { benchmarkCandles });
    if (!ctx) continue;
    const bundle = buildFeatureBundle(ctx, factors);
    evals.push({ ...strategy.evaluate(bundle, regime.regime), sector: inst.sector });
  }

  console.log(`\nRegime: ${regime.regime} — ${regime.explanations[0]}`);
  console.log(`Threshold: ${evals[0]?.threshold ?? '—'}\n`);

  const passed = evals.filter((e) => e.passed).sort((a, b) => b.compositeScore - a.compositeScore);
  console.log(`=== Candidates (${passed.length}) ===`);
  console.log(`  SYMBOL         SECTOR                COMP  TECH  AGREE`);
  for (const e of passed) {
    console.log(
      `  ${e.symbol.replace(/-EQ$/, '').padEnd(13)} ${(e.sector ?? '—').slice(0, 20).padEnd(20)} ` +
        `${String(e.compositeScore).padStart(5)} ${String(e.technicalScore).padStart(5)} ${String(e.agreementScore).padStart(6)}`,
    );
  }

  const byReason = new Map<string, number>();
  for (const e of evals.filter((x) => !x.passed)) {
    byReason.set(e.rejectionReason!, (byReason.get(e.rejectionReason!) ?? 0) + 1);
  }
  console.log(`\n=== Rejections (${evals.length - passed.length}) by first failed gate ===`);
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(20)} ${count}`);
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
