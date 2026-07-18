import {
  buildFeatureBundle,
  buildStockContext,
  factors,
  loadBenchmarkCandles,
  loadFundamentalInputs,
  loadSectorPeerReturns,
} from '@/factors';
import { PortfolioManager, portfolioConfigFromEnv, type PortfolioCandidate } from '@/portfolio';
import { detectMarketRegime } from '@/regime';
import { computeSignalLevels, DEFAULT_SIGNAL_MATH_CONFIG, type SignalLevels } from '@/signal';
import { WeightedStrategy, type StrategyEvaluation } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * Full decision pipeline over the equity universe: regime → factors →
 * WeightedStrategy → signal math → PortfolioManager. Read-only.
 *
 *   bun run strategy:eval             # ATR volatility proxy for regime
 *   bun run strategy:eval 22          # with a VIX of 22
 *   bun run strategy:eval na 5        # widen the SL band to 5% (tuning/demo)
 */
const run = async () => {
  const vixArg = process.argv[2];
  const vix = vixArg && vixArg !== 'na' ? Number(vixArg) : null;
  const slMaxArg = process.argv[3];
  const signalConfig = slMaxArg
    ? { ...DEFAULT_SIGNAL_MATH_CONFIG, slMaxPct: Number(slMaxArg) }
    : DEFAULT_SIGNAL_MATH_CONFIG;

  const regime = await detectMarketRegime(new Date(), { vix });
  const benchmarkCandles = await loadBenchmarkCandles();
  const sectorPeerReturns = await loadSectorPeerReturns();
  const fundamentalInputs = await loadFundamentalInputs();
  const strategy = new WeightedStrategy();

  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: 'EQ' },
    orderBy: { name: 'asc' },
  });

  type Row = StrategyEvaluation & { sector: string | null; levels: SignalLevels | null; mathReason: string | null };
  const evals: Row[] = [];
  for (const inst of instruments) {
    const ctx = await buildStockContext(inst.id, new Date(), { benchmarkCandles, sectorPeerReturns, fundamentalInputs });
    if (!ctx) continue;
    const bundle = buildFeatureBundle(ctx, factors);
    const strat = strategy.evaluate(bundle, regime.regime);

    // Signal math only runs on strategy-passed candidates.
    let levels: SignalLevels | null = null;
    let mathReason: string | null = null;
    if (strat.passed) {
      const math = computeSignalLevels(ctx.candles, signalConfig);
      if (math.ok) levels = math;
      else mathReason = math.reason;
    }
    evals.push({ ...strat, sector: inst.sector, levels, mathReason });
  }

  console.log(`\nRegime: ${regime.regime} — ${regime.explanations[0]}`);
  console.log(`Threshold: ${evals[0]?.threshold ?? '—'}\n`);

  // A final signal = passed strategy gates AND valid signal math.
  const signals = evals
    .filter((e) => e.passed && e.levels)
    .sort((a, b) => b.compositeScore - a.compositeScore);

  console.log(`=== Signals (${signals.length}) ===`);
  console.log(`  SYMBOL       SECTOR               COMP   ENTRY      SL      T1      T2   R:R`);
  for (const e of signals) {
    const l = e.levels!;
    console.log(
      `  ${e.symbol.replace(/-EQ$/, '').padEnd(12)} ${(e.sector ?? '—').slice(0, 18).padEnd(18)} ` +
        `${String(e.compositeScore).padStart(5)} ${String(l.entry).padStart(8)} ${String(l.stopLoss).padStart(7)} ` +
        `${String(l.target1).padStart(7)} ${String(l.target2).padStart(7)} ${String(l.rrToResistance ?? '∞').padStart(5)}`,
    );
  }

  // PortfolioManager: allocate the signals into approved positions (empty book).
  const portfolioConfig = portfolioConfigFromEnv();
  const pm = new PortfolioManager(portfolioConfig);
  const candidates: PortfolioCandidate[] = signals.map((e) => ({
    symbol: e.symbol.replace(/-EQ$/, ''),
    sector: e.sector,
    regime: regime.regime,
    compositeScore: e.compositeScore,
    agreementScore: e.agreementScore,
    levels: e.levels!,
  }));
  const decision = pm.manage(candidates);

  console.log(
    `\n=== Approved positions (${decision.approved.length}) ` +
      `[base ₹${portfolioConfig.baseCapitalPerTrade.toLocaleString('en-IN')}/trade, ` +
      `max ${portfolioConfig.maxOpenPositions} positions, ${portfolioConfig.maxPerSector}/sector] ===`,
  );
  for (const a of decision.approved) {
    console.log(
      `  ${a.symbol.padEnd(12)} ${(a.sector ?? '—').slice(0, 18).padEnd(18)} ` +
        `qty ${String(a.qty).padStart(4)} @ ${a.entry}  SL ${a.stopLoss}  T1 ${a.target1}  ` +
        `risk ₹${a.riskAmount}  value ₹${a.positionValue}${a.sizeReduced ? '  (size-reduced)' : ''}`,
    );
  }

  // Rejections: strategy gate failures + signal-math + portfolio rejections.
  const byReason = new Map<string, number>();
  for (const e of evals) {
    const reason = !e.passed ? e.rejectionReason! : e.mathReason;
    if (reason) byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  for (const r of decision.rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);

  console.log(`\n=== Rejections by reason ===`);
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
