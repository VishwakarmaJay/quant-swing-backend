import {
  computeMetrics,
  generateRawSignals,
  loadCandleStore,
  makeAnchoredFolds,
  SENTIMENT_ORIGIN_TIERS,
  simulateSignalsPaired,
} from '@/backtest';
import { BullPullbackStrategy, DEFAULT_STRATEGY_CONFIG, WeightedStrategy } from '@/strategy';
import { writeCsv, r } from '@/research/report';
import { prisma } from '@services/prisma';

/**
 * Task 9a/11 support — export the B9 signal-edge trade ledger. Read-only, no
 * simulator changes (Task 9's MFE/MAE additive fields are NOT triggered — Task 8
 * found no signal — so the fixed-21d columns are omitted; the realized-window
 * maePct/mfePct already on ClosedTrade are exported). Reproduces the B9 stack on
 * the OOS-concat window with the live+bse tier, matching docs/B9_RERUN.md's
 * reported expectancy/PF of −0.04 / 0.97.
 *
 *   bun run src/scripts/runLedgerExport.ts
 */

const WARMUP = 205;
const ANCHOR = '2024-07-01'; // B9 anchored test era (docs/B9_RERUN.md)
const N_FOLDS = 4;
const EMBARGO_DAYS = 10;

// B9 stack, verbatim from runPortfolioBacktest.ts (production config, read-only).
const pullbackV2 = {
  rsiMin: 40,
  rsiMax: 55,
  maxExtensionAbovePct: 2,
  requireStack: true,
  requireAboveEma50: true,
  requireRsiRising: false,
  requireHistogramRising: true,
};
const withSrs = (w: number, opts: { fundamentalFloor?: number; sentimentFactorFloor?: number; dropVolume?: boolean }) => {
  const weights: Record<string, number> = { ...DEFAULT_STRATEGY_CONFIG.technicalFactorWeights, sectorRelativeStrength: w };
  if (opts.dropVolume) delete weights.volume;
  return new WeightedStrategy({
    ...DEFAULT_STRATEGY_CONFIG,
    technicalFactorWeights: weights,
    ...(opts.fundamentalFloor != null ? { fundamentalFloor: opts.fundamentalFloor } : {}),
    ...(opts.sentimentFactorFloor != null ? { sentimentFactorFloor: opts.sentimentFactorFloor } : {}),
  });
};

const run = async () => {
  console.log('Loading candle store (sentiment tier: live+bse)…');
  const store = await loadCandleStore({ sentimentOrigins: SENTIMENT_ORIGIN_TIERS['live+bse'] });
  const total = store.tradingDates.length;
  const anchor = store.tradingDates.findIndex((d) => d >= ANCHOR);
  const folds = makeAnchoredFolds(WARMUP, anchor, total, N_FOLDS, EMBARGO_DAYS);
  console.log(`Anchored OOS: ${folds.length} folds, test era ${store.tradingDates[anchor]} → ${store.tradingDates[total - 1]}`);

  const b9 = new BullPullbackStrategy(pullbackV2, withSrs(0.25, { fundamentalFloor: 50, sentimentFactorFloor: 50, dropVolume: true }));
  console.log('Replaying B9 stack across anchored test folds (OOS concat)…');
  // OOS concat: the fixed B9 stack on each fold's TEST window, concatenated —
  // the same construction docs/B9_RERUN.md reports (B9 won all folds).
  const pairs = folds.flatMap((f) =>
    simulateSignalsPaired(store, generateRawSignals(store, { strategy: b9, fromIndex: f.testFrom, toIndex: f.testTo })),
  );
  const trades = pairs.map((p) => p.trade);
  const m = computeMetrics(trades);
  console.log(`\nReproduced B9 signal-edge: trades ${trades.length} · expectancy ${m.expectancyPct}% · PF ${m.profitFactor} · win% ${m.winRatePct}`);
  console.log('(docs/B9_RERUN.md reports −0.04 / 0.97 for the live+bse OOS concat)');

  const rows = trades.map((t) => [
    t.symbol,
    t.sector ?? '',
    t.signalDate,
    t.entryDate,
    t.exitDate,
    t.holdingDays,
    r(t.entryPrice, 2),
    r(t.grossReturnPct, 3),
    r(t.netReturnPct, 3),
    r(t.maePct, 2),
    r(t.mfePct, 2),
    t.win ? 1 : 0,
    t.finalReason,
    t.exits.length,
  ]);
  writeCsv(
    'research-output/ledger_b9_full.csv',
    ['symbol', 'sector', 'signalDate', 'entryDate', 'exitDate', 'holdingDays', 'entryPrice', 'grossReturnPct', 'netReturnPct', 'maePct', 'mfePct', 'win', 'finalReason', 'nExits'],
    rows,
  );
  console.log(`\nWrote research-output/ledger_b9_full.csv (${rows.length} trades).`);
};

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
