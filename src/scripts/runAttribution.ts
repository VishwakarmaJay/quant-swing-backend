import {
  computeMetrics,
  conditionFeatures,
  generateRawSignals,
  loadCandleStore,
  metricsByRegime,
  simulateSignalsPaired,
  type BacktestMetrics,
  type CandleStore,
} from '@/backtest';
import { DEFAULT_STRATEGY_CONFIG, WeightedStrategy, type StrategyConfig } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * Factor & gate attribution (HANDOFF Step 1). Read-only. Measures which entry
 * component is responsible for the missing edge, using the Phase-4 harness:
 *
 *   bun run backtest:attribution
 *
 * 1. Conditioning: reproduce the live signal set once, correlate each signal's
 *    factor/composite/agreement scores with the trade's realised net return.
 * 2. Leave-one-out ablation: disable each gate, and drop each factor from the
 *    composite, one at a time; re-measure vs baseline.
 *
 * NOTE: statistical strength scales with the backfilled window. For the full
 * ~981-trade picture, backfill first: `bun run backfill:ohlcv all 800`.
 */

const GATES = ['regime', 'composite', 'technical-floor', 'macd-bullish', 'price-above-ema20', 'rsi-band'];
const TECHNICAL_FACTORS = ['trend', 'momentum', 'relativeStrength', 'volume'];

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const pad = (s: string | number, w: number) => String(s).padStart(w);
const padE = (s: string | number, w: number) => String(s).padEnd(w);

type VariantResult = { label: string; signalCount: number; trades: number; metrics: BacktestMetrics };

const runVariant = (store: CandleStore, label: string, strategy: WeightedStrategy): VariantResult => {
  const signals = generateRawSignals(store, { strategy });
  const pairs = simulateSignalsPaired(store, signals);
  return { label, signalCount: signals.length, trades: pairs.length, metrics: computeMetrics(pairs.map((p) => p.trade)) };
};

/**
 * Activates the fundamental bucket at λ × the spec's regime weights (B5
 * selection test). λ=1 is the docs' full weight matrix; smaller λ probes the
 * dose–response. With sentiment absent the weights renormalize over
 * {technical, fundamental}, so e.g. SIDEWAYS λ=1 gives fundamental a hefty
 * 0.4/0.75 ≈ 53% of the composite.
 */
const withFundamentalBucket = (lambda: number): WeightedStrategy => {
  const regimeWeights = Object.fromEntries(
    Object.entries(DEFAULT_STRATEGY_CONFIG.regimeWeights).map(([regime, w]) => [
      regime,
      { ...w, fundamental: Number((w.fundamental * lambda).toFixed(4)) },
    ]),
  ) as StrategyConfig['regimeWeights'];
  return new WeightedStrategy({
    ...DEFAULT_STRATEGY_CONFIG,
    regimeWeights,
    buckets: { ...DEFAULT_STRATEGY_CONFIG.buckets, fundamental: ['fundamental'] },
  });
};

const dropFactorWeights = (drop: string): Record<string, number> => {
  const w: Record<string, number> = {};
  for (const [k, v] of Object.entries(DEFAULT_STRATEGY_CONFIG.technicalFactorWeights)) {
    if (k !== drop) w[k] = v; // technicalComposite renormalizes over present factors
  }
  return w;
};

const run = async () => {
  console.log('Loading candles…');
  const store = await loadCandleStore();
  console.log(`Universe ${store.instruments.length} stocks, ${store.tradingDates.length} trading days.\n`);

  // ── Baseline: the exact live signal set, enriched with decision context ──
  console.log('Replaying pipeline (baseline, no lookahead)…');
  const baseSignals = generateRawSignals(store);
  const basePairs = simulateSignalsPaired(store, baseSignals);
  const baseM = computeMetrics(basePairs.map((p) => p.trade));

  console.log(`\n=== BASELINE ===`);
  console.log(`  Signals ${baseSignals.length}  ·  Trades ${basePairs.length}`);
  console.log(`  Win ${baseM.winRatePct}%  ·  Expectancy ${pct(baseM.expectancyPct)}%/trade  ·  PF ${baseM.profitFactor}`);
  if (basePairs.length === 0) {
    console.log('\n  No trades — backfill more history (`bun run backfill:ohlcv all 800`) and retry.');
    return;
  }

  // ── 1. Conditioning: does any score discriminate winners from losers? ──
  console.log(`\n=== 1. CONDITIONING (Spearman of score vs net return; terciles low→high) ===`);
  console.log(`  A factor has edge if expectancy RISES across terciles and Spearman > 0.`);
  console.log(`  ${padE('feature', 18)} ${pad('Spearman', 9)}   terciles: n | win% | exp% | PF`);
  for (const c of conditionFeatures(basePairs)) {
    const cells = c.buckets
      .map((b) => `${b.n}|${b.metrics.winRatePct}|${pct(b.metrics.expectancyPct)}|${b.metrics.profitFactor}`)
      .join('   ');
    console.log(`  ${padE(c.feature, 18)} ${pad(c.spearman, 9)}   ${cells}`);
  }

  // ── Regime breakdown ──
  console.log(`\n=== REGIME BREAKDOWN ===`);
  console.log(`  ${padE('regime', 10)} ${pad('n', 5)} ${pad('win%', 7)} ${pad('exp%', 8)} ${pad('PF', 6)}`);
  for (const r of metricsByRegime(basePairs)) {
    console.log(
      `  ${padE(r.regime, 10)} ${pad(r.n, 5)} ${pad(r.metrics.winRatePct, 7)} ${pad(pct(r.metrics.expectancyPct), 8)} ${pad(r.metrics.profitFactor, 6)}`,
    );
  }

  // ── 2a. Gate leave-one-out ──
  console.log(`\n=== 2a. GATE ABLATION (disable one gate; Δ vs baseline) ===`);
  console.log(`  A gate has POSITIVE edge if disabling it LOWERS expectancy (it was filtering losers).`);
  console.log(`  ${padE('disabled gate', 20)} ${pad('signals', 8)} ${pad('win%', 7)} ${pad('exp%', 8)} ${pad('PF', 6)}  ${pad('Δexp', 8)} ${pad('Δsignals', 9)}`);
  for (const gate of GATES) {
    const v = runVariant(store, gate, new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, disabledGates: [gate] }));
    const dExp = v.metrics.expectancyPct - baseM.expectancyPct;
    console.log(
      `  ${padE(gate, 20)} ${pad(v.signalCount, 8)} ${pad(v.metrics.winRatePct, 7)} ${pad(pct(v.metrics.expectancyPct), 8)} ${pad(v.metrics.profitFactor, 6)}  ${pad(pct(dExp), 8)} ${pad(v.signalCount - baseSignals.length >= 0 ? '+' + (v.signalCount - baseSignals.length) : v.signalCount - baseSignals.length, 9)}`,
    );
  }

  // ── 2b. Factor leave-one-out (drop from composite) ──
  console.log(`\n=== 2b. FACTOR ABLATION (drop one factor from the composite; Δ vs baseline) ===`);
  console.log(`  A factor CONTRIBUTES if dropping it LOWERS expectancy.`);
  console.log(`  ${padE('dropped factor', 20)} ${pad('signals', 8)} ${pad('win%', 7)} ${pad('exp%', 8)} ${pad('PF', 6)}  ${pad('Δexp', 8)} ${pad('Δsignals', 9)}`);
  for (const factor of TECHNICAL_FACTORS) {
    const v = runVariant(
      store,
      factor,
      new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, technicalFactorWeights: dropFactorWeights(factor) }),
    );
    const dExp = v.metrics.expectancyPct - baseM.expectancyPct;
    console.log(
      `  ${padE(factor, 20)} ${pad(v.signalCount, 8)} ${pad(v.metrics.winRatePct, 7)} ${pad(pct(v.metrics.expectancyPct), 8)} ${pad(v.metrics.profitFactor, 6)}  ${pad(pct(dExp), 8)} ${pad(v.signalCount - baseSignals.length >= 0 ? '+' + (v.signalCount - baseSignals.length) : v.signalCount - baseSignals.length, 9)}`,
    );
  }

  // ── 2c. ADD sectorRelativeStrength to the composite (does selection improve?) ──
  // Conditioning above is range-restricted (SRS didn't select these trades). This tests SRS
  // as a *selection* signal: give it composite weight, regenerate, see if the new set is better.
  console.log(`\n=== 2c. ADD sectorRelativeStrength to composite (Δ vs baseline) ===`);
  console.log(`  Earns a weight if adding it RAISES expectancy / PF (picks better stocks).`);
  console.log(`  ${padE('SRS weight', 20)} ${pad('signals', 8)} ${pad('win%', 7)} ${pad('exp%', 8)} ${pad('PF', 6)}  ${pad('Δexp', 8)} ${pad('Δsignals', 9)}`);
  for (const w of [0.15, 0.25, 0.4]) {
    const weights = { ...DEFAULT_STRATEGY_CONFIG.technicalFactorWeights, sectorRelativeStrength: w };
    const v = runVariant(store, `w=${w}`, new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, technicalFactorWeights: weights }));
    const dExp = v.metrics.expectancyPct - baseM.expectancyPct;
    console.log(
      `  ${padE(`w=${w}`, 20)} ${pad(v.signalCount, 8)} ${pad(v.metrics.winRatePct, 7)} ${pad(pct(v.metrics.expectancyPct), 8)} ${pad(v.metrics.profitFactor, 6)}  ${pad(pct(dExp), 8)} ${pad(v.signalCount - baseSignals.length >= 0 ? '+' + (v.signalCount - baseSignals.length) : v.signalCount - baseSignals.length, 9)}`,
    );
  }

  // ── 2d. ACTIVATE the fundamental bucket (B5 selection test) ──
  // Same logic as 2c (the SRS lesson): conditioning on the baseline set is
  // range-restricted; the honest question is whether fundamentally-informed
  // SELECTION picks a better trade set. λ scales the spec's regime weight matrix.
  console.log(`\n=== 2d. ACTIVATE fundamental bucket at λ × spec regime weights (Δ vs baseline) ===`);
  console.log(`  Earns its bucket if activating RAISES expectancy / PF (picks better stocks).`);
  console.log(`  ${padE('fund λ', 20)} ${pad('signals', 8)} ${pad('win%', 7)} ${pad('exp%', 8)} ${pad('PF', 6)}  ${pad('Δexp', 8)} ${pad('Δsignals', 9)}`);
  for (const lambda of [0.1, 0.25, 0.5, 1.0]) {
    const v = runVariant(store, `λ=${lambda}`, withFundamentalBucket(lambda));
    const dExp = v.metrics.expectancyPct - baseM.expectancyPct;
    console.log(
      `  ${padE(`λ=${lambda}`, 20)} ${pad(v.signalCount, 8)} ${pad(v.metrics.winRatePct, 7)} ${pad(pct(v.metrics.expectancyPct), 8)} ${pad(v.metrics.profitFactor, 6)}  ${pad(pct(dExp), 8)} ${pad(v.signalCount - baseSignals.length >= 0 ? '+' + (v.signalCount - baseSignals.length) : v.signalCount - baseSignals.length, 9)}`,
    );
  }

  // ── 2e. Fundamental FLOOR gate (B5) — the mechanism the terciles point to ──
  // 2d blends the score into the composite (re-ranks everything); this instead
  // just refuses the low-fundamental tail, leaving selection otherwise intact.
  console.log(`\n=== 2e. FUNDAMENTAL FLOOR gate (reject fundamental < floor; Δ vs baseline) ===`);
  console.log(`  Earns a floor if trimming the low-fundamental tail RAISES expectancy / PF.`);
  console.log(`  ${padE('floor', 20)} ${pad('signals', 8)} ${pad('win%', 7)} ${pad('exp%', 8)} ${pad('PF', 6)}  ${pad('Δexp', 8)} ${pad('Δsignals', 9)}`);
  for (const floor of [40, 45, 50, 55]) {
    const v = runVariant(store, `floor=${floor}`, new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, fundamentalFloor: floor }));
    const dExp = v.metrics.expectancyPct - baseM.expectancyPct;
    console.log(
      `  ${padE(`floor=${floor}`, 20)} ${pad(v.signalCount, 8)} ${pad(v.metrics.winRatePct, 7)} ${pad(pct(v.metrics.expectancyPct), 8)} ${pad(v.metrics.profitFactor, 6)}  ${pad(pct(dExp), 8)} ${pad(v.signalCount - baseSignals.length >= 0 ? '+' + (v.signalCount - baseSignals.length) : v.signalCount - baseSignals.length, 9)}`,
    );
  }

  console.log(
    `\n  ⚠️ Technicals-only, survivorship bias (today's constituents), signal-edge (no 2-position cap).` +
      `\n     Conditioning is range-restricted (all trades already cleared the gates) — it measures` +
      `\n     marginal discrimination WITHIN the selected set, not standalone factor power.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
