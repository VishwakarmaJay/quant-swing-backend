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
import { DEFAULT_STRATEGY_CONFIG, WeightedStrategy } from '@/strategy';
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
