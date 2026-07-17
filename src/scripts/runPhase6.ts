import {
  benchmarkReturn,
  computeMetrics,
  loadCandleStore,
  makeExpandingFolds,
  runWalkForward,
  simulateSignalsPaired,
  generateRawSignals,
  type CandleStore,
  type WFCandidate,
} from '@/backtest';
import { DEFAULT_STRATEGY_CONFIG } from '@/strategy';
import { BullPullbackStrategy, WeightedStrategy } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * Phase 6 — combine the measured levers and validate walk-forward. Read-only.
 *
 *   bun run backtest:phase6
 *
 * The two robust *relative* levers found so far — sector-relative RS in the
 * composite (Step 3) and the BULL pullback+resumption entry (Step 4b) — were
 * each measured on a single window and flattered themselves. Here they are
 * combined into candidate strategies and evaluated by WALK-FORWARD: each fold
 * selects the best candidate on its train window and scores it on the unseen
 * test window. The honest question: does the enriched, walk-forward-selected
 * strategy beat the baseline OUT-OF-SAMPLE — and does it look like edge at all?
 */

const WARMUP = 205;
const N_FOLDS = 3;

// SRS weight into the composite (Step-3 lever). Pullback+resumption BULL entry (Step-4b lever).
const withSrs = (w: number) =>
  new WeightedStrategy({
    ...DEFAULT_STRATEGY_CONFIG,
    technicalFactorWeights: { ...DEFAULT_STRATEGY_CONFIG.technicalFactorWeights, sectorRelativeStrength: w },
  });
const pullbackV2 = {
  rsiMin: 40,
  rsiMax: 55,
  maxExtensionAbovePct: 2,
  requireStack: true,
  requireAboveEma50: true,
  requireRsiRising: false,
  requireHistogramRising: true,
};

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

const run = async () => {
  console.log('Loading candles…');
  const store: CandleStore = await loadCandleStore();
  const total = store.tradingDates.length;
  console.log(`Universe ${store.instruments.length} stocks, ${total} trading days.\n`);

  // Candidate grid: {SRS weight 0 / 0.25} × {BULL entry strength / pullback-v2}.
  const candidates: WFCandidate[] = [
    { label: 'baseline', strategy: withSrs(0) },
    { label: 'srs0.25', strategy: withSrs(0.25) },
    { label: 'pullback', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0)) },
    { label: 'pullback+srs0.25', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25)) },
  ];

  const folds = makeExpandingFolds(WARMUP, total, N_FOLDS);
  console.log(`Walk-forward: ${folds.length} expanding folds, ${candidates.length} candidates each.`);
  console.log('Replaying (this runs the pipeline many times)…\n');

  const wf = runWalkForward(store, candidates, folds, (m) => m.expectancyPct, (i, n) =>
    console.log(`  fold ${i + 1}/${n}…`),
  );

  // Baseline held fixed across the same test windows (no selection) — the control.
  const baselineOosPairs = folds.flatMap((f) =>
    simulateSignalsPaired(store, generateRawSignals(store, { strategy: withSrs(0), fromIndex: f.testFrom, toIndex: f.testTo })),
  );
  const baselineOos = computeMetrics(baselineOosPairs.map((p) => p.trade));

  console.log(`\n=== PER-FOLD (config chosen on train → measured on unseen test) ===`);
  console.log(`  ${padE('test window', 16)} ${padE('selected', 18)} ${pad('test n', 7)} ${pad('test exp', 9)} ${pad('PF', 6)}`);
  for (const fr of wf.folds) {
    const from = store.tradingDates[fr.fold.testFrom] ?? '';
    const to = store.tradingDates[fr.fold.testTo - 1] ?? '';
    console.log(
      `  ${padE(`${from}→${to}`, 16)} ${padE(fr.selected, 18)} ${pad(fr.testMetrics.totalTrades, 7)} ` +
        `${pad(pct(fr.testMetrics.expectancyPct), 9)} ${pad(fr.testMetrics.profitFactor, 6)}`,
    );
  }

  const o = wf.oosMetrics;
  console.log(`\n=== OUT-OF-SAMPLE (concatenated test folds) ===`);
  console.log(`  ${padE('strategy', 24)} ${pad('trades', 7)} ${pad('win%', 6)} ${pad('exp%', 8)} ${pad('PF', 6)} ${pad('cum%', 8)}`);
  console.log(
    `  ${padE('walk-forward selected', 24)} ${pad(o.totalTrades, 7)} ${pad(o.winRatePct, 6)} ${pad(pct(o.expectancyPct), 8)} ${pad(o.profitFactor, 6)} ${pad(pct(o.cumulativeReturnPct), 8)}`,
  );
  console.log(
    `  ${padE('baseline (control)', 24)} ${pad(baselineOos.totalTrades, 7)} ${pad(baselineOos.winRatePct, 6)} ${pad(pct(baselineOos.expectancyPct), 8)} ${pad(baselineOos.profitFactor, 6)} ${pad(pct(baselineOos.cumulativeReturnPct), 8)}`,
  );

  // Nifty B&H over the concatenated OOS window (naive comparison — see caveat).
  const oosFrom = store.tradingDates[folds[0]!.testFrom] ?? '';
  const oosTo = store.tradingDates[total - 1] ?? '';
  const bench = benchmarkReturn(store, oosFrom, oosTo);
  if (bench) console.log(`\n  Nifty B&H over OOS window ${oosFrom}→${oosTo}: ${pct(bench.returnPct)}%`);

  console.log(
    `\n  ⚠️ Per-trade net % is SIGNAL-EDGE (every signal taken, no 2-position cap) — the cumulative` +
      `\n     and the Nifty B&H % are NOT directly comparable (B&H is one capital base; these are` +
      `\n     equal-weight overlapping trades). A true beat-Nifty test needs portfolio-level simulation.` +
      `\n     Read PF/expectancy as the honest OOS edge signal; > 1 / > 0 is necessary, not sufficient.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
