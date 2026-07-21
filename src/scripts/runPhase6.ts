import {
  benchmarkReturn,
  computeMetrics,
  loadCandleStore,
  makeAnchoredFolds,
  makeExpandingFolds,
  runWalkForward,
  SENTIMENT_ORIGIN_TIERS,
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
 *   bun run backtest:phase6 [live|live+bse|all] [--from YYYY-MM-DD] [--folds N]
 *
 * The optional origin-tier argument (B7 Phase 2, default `all`) restricts which
 * news origins feed the SentimentFactor for any sentiment candidates in the
 * grid; non-sentiment candidates are tier-independent.
 *
 * `--from` (B9) anchors the FIRST test window at that date (coverage-era fold
 * design): deep-window folds leave archive-dependent levers (ff/sf floors)
 * expressible on only the last fold because the archives start 2024-01/2025-01.
 * Anchoring the test era inside coverage gives them a fair multi-fold test;
 * train still expands from warmup over all history. `--folds` (default 3;
 * 4 recommended with --from) sets the fold count.
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
/** B8.3: train ends this many trading days before each test window — purges
 * trades whose exits (7-day time-stop etc.) would resolve inside the test. */
const EMBARGO_DAYS = 10;

// SRS weight into the composite (Step-3 lever). Pullback+resumption BULL entry (Step-4b lever).
// Fundamental floor gate (B5 lever — the attribution-selected mechanism; the
// bucket-blend path was measured harmful at every λ and is not a candidate).
// Sentiment factor floor (B7 Phase 2 lever — same story: the 2f bucket blend was
// rejected, the 2g floor showed a concave dose–response peaking at 50 with the
// effect STRONGER on the live+bse tier than with GDELT added).
// dropVolume (B9): volume has been the standing suspect since Step-1 attribution
// (mildly harmful, dropping it helped) — tested jointly here for the first time.
const withSrs = (
  w: number,
  opts: { fundamentalFloor?: number; sentimentFactorFloor?: number; dropVolume?: boolean } = {},
) => {
  const weights: Record<string, number> = {
    ...DEFAULT_STRATEGY_CONFIG.technicalFactorWeights,
    sectorRelativeStrength: w,
  };
  if (opts.dropVolume) delete weights.volume; // technical composite renormalizes over present factors
  return new WeightedStrategy({
    ...DEFAULT_STRATEGY_CONFIG,
    technicalFactorWeights: weights,
    ...(opts.fundamentalFloor != null ? { fundamentalFloor: opts.fundamentalFloor } : {}),
    ...(opts.sentimentFactorFloor != null ? { sentimentFactorFloor: opts.sentimentFactorFloor } : {}),
  });
};
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
  const args = process.argv.slice(2);
  const tier = args.find((a) => !a.startsWith('--')) ?? 'all';
  const fromArg = args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined;
  const nFolds = args.includes('--folds') ? Number(args[args.indexOf('--folds') + 1]) : 3;
  if (!(tier in SENTIMENT_ORIGIN_TIERS) || !Number.isInteger(nFolds) || nFolds < 1) {
    console.error(`Usage: backtest:phase6 [${Object.keys(SENTIMENT_ORIGIN_TIERS).join('|')}] [--from YYYY-MM-DD] [--folds N]`);
    process.exitCode = 1;
    return;
  }
  const midcap = args.includes('--midcap'); // Option-B: run the walk-forward on the EQ_MID universe
  console.log(`Loading candles… (sentiment origin tier: ${tier}${midcap ? ', MIDCAP universe' : ''})`);
  const store: CandleStore = await loadCandleStore({ sentimentOrigins: SENTIMENT_ORIGIN_TIERS[tier], universeType: midcap ? 'EQ_MID' : 'EQ' });
  const total = store.tradingDates.length;
  console.log(`Universe ${store.instruments.length} stocks, ${total} trading days (tier ${tier}${midcap ? ', MIDCAP' : ''}).\n`);

  // The B9 joint grid: incumbents as controls, each validated floor alone, the
  // fold-3 stack, and volume-pruned variants. Dose-neighbours (ff45/sf48) served
  // their purpose in B5/B7 attribution and are dropped to limit selection churn.
  const candidates: WFCandidate[] = [
    { label: 'baseline', strategy: withSrs(0) },
    { label: 'srs0.25', strategy: withSrs(0.25) },
    { label: 'pullback+srs0.25', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25)) },
    { label: 'pullback+srs0.25+ff50', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25, { fundamentalFloor: 50 })) },
    { label: 'pullback+srs0.25+sf50', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25, { sentimentFactorFloor: 50 })) },
    { label: 'pullback+srs0.25+ff50+sf50', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25, { fundamentalFloor: 50, sentimentFactorFloor: 50 })) },
    { label: 'pullback+srs0.25-novol', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25, { dropVolume: true })) },
    { label: 'pullback+srs0.25+ff50+sf50-novol', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25, { fundamentalFloor: 50, sentimentFactorFloor: 50, dropVolume: true })) },
  ];

  let folds;
  if (fromArg != null) {
    const anchor = store.tradingDates.findIndex((d) => d >= fromArg);
    if (anchor < 0) {
      console.error(`--from ${fromArg} is beyond the stored range (${store.tradingDates.at(-1)}).`);
      process.exitCode = 1;
      return;
    }
    folds = makeAnchoredFolds(WARMUP, anchor, total, nFolds, EMBARGO_DAYS);
    console.log(`Fold design: ANCHORED — test era ${store.tradingDates[anchor]}→end (coverage-era, B9).`);
  } else {
    folds = makeExpandingFolds(WARMUP, total, nFolds, EMBARGO_DAYS);
  }
  console.log(
    `Walk-forward: ${folds.length} folds (embargo ${EMBARGO_DAYS}d), ${candidates.length} candidates each.`,
  );
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
