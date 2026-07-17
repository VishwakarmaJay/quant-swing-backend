import { benchmarkReturn, computeMetrics, loadCandleStore, runBacktest } from '@/backtest';
import { prisma } from '@services/prisma';

/**
 * Runs the historical backtest over the available OHLCV window and prints a
 * performance report vs Buy & Hold Nifty. Read-only.
 *
 *   bun run backtest:run
 *
 * NOTE: the window is bounded by the backfilled history (~270 days − 205 warmup
 * ≈ 65 days). For a longer backtest, backfill more: `bun run backfill:ohlcv all 800`.
 */
const run = async () => {
  console.log('Loading candles…');
  const store = await loadCandleStore();
  console.log(`Universe ${store.instruments.length} stocks, ${store.tradingDates.length} trading days.`);

  console.log('Replaying pipeline (no lookahead)…');
  const result = runBacktest(store);
  const m = computeMetrics(result.trades);
  const bench = benchmarkReturn(store, result.window.from, result.window.to);

  console.log(`\n=== Backtest ${result.window.from} → ${result.window.to} (${result.daysReplayed} days replayed) ===`);
  console.log(`  Trades:          ${m.totalTrades}   (win ${m.wins} / loss ${m.losses})`);
  console.log(`  Win rate:        ${m.winRatePct}%`);
  console.log(`  Expectancy:      ${m.expectancyPct}% / trade   (avg win ${m.avgWinPct}%, avg loss ${m.avgLossPct}%)`);
  console.log(`  Profit factor:   ${m.profitFactor}`);
  console.log(`  Cumulative:      ${m.cumulativeReturnPct}%   (additive, equal-weight)`);
  console.log(`  Max drawdown:    ${m.maxDrawdownPct}%`);
  console.log(`  Sharpe/Sortino:  ${m.sharpeTradeLevel} / ${m.sortinoTradeLevel}   (trade-level, not annualized)`);
  console.log(`  Best / worst:    ${m.bestPct}% / ${m.worstPct}%`);
  console.log(`  Avg holding:     ${m.avgHoldingDays} days`);
  console.log(`  Exit reasons:    ${JSON.stringify(m.exitReasons)}`);

  if (bench) {
    const edge = (m.cumulativeReturnPct - bench.returnPct).toFixed(2);
    console.log(`\n  Benchmark (Nifty B&H, same window): ${bench.returnPct}%`);
    console.log(`  Strategy − Benchmark (naive):       ${edge}%`);
  }

  console.log(
    `\n  ⚠️ Technicals-only (no sentiment/fundamental factors, no historical sentiment).` +
      `\n     Survivorship bias: universe = today's constituents. Signal-edge (no 2-position cap).` +
      `\n     Short window — backfill more history for a statistically meaningful result.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
