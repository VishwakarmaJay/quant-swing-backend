import {
  computeMetrics,
  generateRawSignals,
  loadCandleStore,
  makeAnchoredFolds,
  runWalkForward,
  simulateSignalsPaired,
  DEFAULT_SIMULATOR_CONFIG,
  type CandleStore,
  type SimulatorConfig,
  type WFCandidate,
} from '@/backtest';
import { createProductionStrategy } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * B14c — the horizon variants through the ANCHORED WALK-FORWARD. Read-only.
 *
 *   bun run backtest:horizon:wf
 *
 * B14's sweep found holding-period effects on a single window, and this project
 * has twice been fooled by exactly that (Step-4b pullback-v2, the original
 * Phase 6). The standing rule: nothing is believed off one window. This selects
 * the EXIT config on each fold's train window and measures it on unseen test.
 *
 * Entries are held fixed (the production strategy) so the folds vary only the
 * exit horizon — the question is "does picking a horizon on past data generalize
 * to the next period?", not "which entry wins".
 */
const WARMUP = 205;
const COVERAGE_FROM = '2024-07-01';
const EMBARGO_DAYS = 60; // ≥ the longest horizon tested, else long trades leak into test

const exits = (label: string, timeStopDays: number, targetRr: [number, number], long: boolean): WFCandidate => ({
  label,
  strategy: createProductionStrategy(),
  targetRr,
  simulatorConfig: {
    ...DEFAULT_SIMULATOR_CONFIG,
    timeStopDays,
    ...(long ? { emaPeriod: 50, closesBelowEmaExit: 4, macdFlipExit: false } : {}),
  } as SimulatorConfig,
});

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

const run = async () => {
  const store: CandleStore = await loadCandleStore();
  const total = store.tradingDates.length;
  const anchor = store.tradingDates.findIndex((d) => d >= COVERAGE_FROM);

  const candidates: WFCandidate[] = [
    exits('7d (incumbent)', 7, [2, 3], false),
    exits('21d scaled', 21, [3, 5], true),
    exits('30d scaled', 30, [3, 5], true),
    exits('45d scaled', 45, [4, 6], true),
    exits('60d trend-only', 60, [6, 12], true),
  ];

  const folds = makeAnchoredFolds(WARMUP, anchor, total, 4, EMBARGO_DAYS);
  console.log(`Anchored walk-forward: ${folds.length} folds from ${COVERAGE_FROM}, embargo ${EMBARGO_DAYS}d`);
  console.log(`(embargo ≥ the longest horizon, so a train-end trade cannot resolve inside test)\n`);

  const wf = runWalkForward(store, candidates, folds, (m) => m.expectancyPct, (i, n) =>
    console.log(`  fold ${i + 1}/${n}…`),
  );

  console.log(`\n=== PER-FOLD (exit config chosen on train → measured on unseen test) ===`);
  console.log(`  ${padE('test window', 24)} ${padE('selected', 16)} ${pad('n', 6)} ${pad('exp%', 8)} ${pad('PF', 6)}`);
  for (const f of wf.folds) {
    const from = store.tradingDates[f.fold.testFrom] ?? '';
    const to = store.tradingDates[f.fold.testTo - 1] ?? '';
    console.log(
      `  ${padE(`${from}→${to}`, 24)} ${padE(f.selected, 16)} ${pad(f.testMetrics.totalTrades, 6)} ` +
        `${pad(pct(f.testMetrics.expectancyPct), 8)} ${pad(f.testMetrics.profitFactor, 6)}`,
    );
  }

  // Controls: each fixed config held across the SAME test windows (no selection).
  console.log(`\n=== OUT-OF-SAMPLE (concatenated test folds) ===`);
  console.log(`  ${padE('config', 24)} ${pad('trades', 7)} ${pad('win%', 6)} ${pad('exp%', 8)} ${pad('PF', 6)}`);
  const o = wf.oosMetrics;
  console.log(`  ${padE('walk-forward selected', 24)} ${pad(o.totalTrades, 7)} ${pad(o.winRatePct, 6)} ${pad(pct(o.expectancyPct), 8)} ${pad(o.profitFactor, 6)}`);
  for (const c of candidates) {
    const pairs = folds.flatMap((f) =>
      simulateSignalsPaired(store, generateRawSignals(store, { strategy: c.strategy, fromIndex: f.testFrom, toIndex: f.testTo }), {
        simulatorConfig: c.simulatorConfig!, targetRr: c.targetRr!,
      }),
    );
    const m = computeMetrics(pairs.map((p) => p.trade));
    console.log(`  ${padE(`fixed: ${c.label}`, 24)} ${pad(m.totalTrades, 7)} ${pad(m.winRatePct, 6)} ${pad(pct(m.expectancyPct), 8)} ${pad(m.profitFactor, 6)}`);
  }

  console.log(
    `\n  ⚠️ SIGNAL-EDGE units and ABSOLUTE returns — a longer hold collects more market beta,` +
      `\n     so read this as "does horizon selection generalize?", NOT as evidence of alpha.` +
      `\n     The beta-inclusive verdict is backtest:horizon:portfolio (HORIZON_STUDY.md §3).`,
  );
};
run().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
