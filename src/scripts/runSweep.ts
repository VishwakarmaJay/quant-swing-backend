import { benchmarkReturn, generateRawSignals, loadCandleStore, runSweep } from '@/backtest';
import { prisma } from '@services/prisma';

/**
 * Parameter sensitivity sweep: generate signals once, then evaluate a grid of
 * (time-stop × target R-multiple) configs. Ranked by profit factor. Read-only.
 *
 *   bun run backtest:sweep
 */
const run = async () => {
  console.log('Loading candles…');
  const store = await loadCandleStore();
  console.log(`Universe ${store.instruments.length} stocks, ${store.tradingDates.length} trading days.`);

  console.log('Generating signals (one replay)…');
  const signals = generateRawSignals(store);
  console.log(`${signals.length} raw signals.\n`);

  const results = runSweep(store, signals).sort((a, b) => b.metrics.profitFactor - a.metrics.profitFactor);

  const from = signals.length ? store.tradingDates[205] ?? '' : '';
  const bench = benchmarkReturn(store, from, store.tradingDates.at(-1) ?? '');

  console.log('=== Sensitivity sweep (ranked by profit factor) ===');
  console.log('  TimeStop  Targets    Trades  Win%   Expect%  PF     Cumul%   MaxDD%');
  console.log(`  ${'-'.repeat(66)}`);
  for (const { combo, metrics: m } of results) {
    console.log(
      `  ${String(combo.timeStopDays).padStart(4)}d    ` +
        `${combo.targetRr[0]}R/${combo.targetRr[1]}R`.padEnd(9) +
        `  ${String(m.totalTrades).padStart(5)}  ${String(m.winRatePct).padStart(4)}  ` +
        `${String(m.expectancyPct).padStart(7)}  ${String(m.profitFactor).padStart(4)}  ` +
        `${String(m.cumulativeReturnPct).padStart(7)}  ${String(m.maxDrawdownPct).padStart(7)}`,
    );
  }

  if (bench) console.log(`\n  Benchmark (Nifty B&H): ${bench.returnPct}%`);
  console.log(
    `\n  ⚠️ Signal-edge, technicals-only, survivorship-biased. Targets/time-stop swept;` +
      `\n     entry signals held fixed. Use as a hypothesis generator, not a promise.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
