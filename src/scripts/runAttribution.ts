import {
  computeMetrics,
  conditionFeatures,
  generateRawSignals,
  loadCandleStore,
  metricsByRegime,
  SENTIMENT_ORIGIN_TIERS,
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
 *   bun run backtest:attribution [live|live+bse|all]
 *
 * 1. Conditioning: reproduce the live signal set once, correlate each signal's
 *    factor/composite/agreement scores with the trade's realised net return.
 * 2. Leave-one-out ablation: disable each gate, and drop each factor from the
 *    composite, one at a time; re-measure vs baseline.
 *
 * The optional origin-tier argument (B7 Phase 2, default `all`) restricts which
 * news origins feed the SentimentFactor — run all three tiers so sentiment
 * conclusions can be validated on the strongest availability evidence
 * (SENTIMENT_FACTOR.md §4). Non-sentiment sections are tier-independent.
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

/**
 * Activates the sentiment bucket at λ × the spec's regime weights (B7 Phase 2
 * selection test — the 2d pattern). With fundamental still absent the weights
 * renormalize over {technical, sentiment}, so e.g. HIGH_VOL λ=1 gives sentiment
 * 0.45/0.85 ≈ 53% of the composite.
 */
const withSentimentBucket = (lambda: number): WeightedStrategy => {
  const regimeWeights = Object.fromEntries(
    Object.entries(DEFAULT_STRATEGY_CONFIG.regimeWeights).map(([regime, w]) => [
      regime,
      { ...w, sentiment: Number((w.sentiment * lambda).toFixed(4)) },
    ]),
  ) as StrategyConfig['regimeWeights'];
  return new WeightedStrategy({
    ...DEFAULT_STRATEGY_CONFIG,
    regimeWeights,
    buckets: { ...DEFAULT_STRATEGY_CONFIG.buckets, sentiment: ['sentiment'] },
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
  const tier = process.argv[2] ?? 'all';
  if (!(tier in SENTIMENT_ORIGIN_TIERS)) {
    console.error(`Unknown origin tier '${tier}' — use one of: ${Object.keys(SENTIMENT_ORIGIN_TIERS).join(' | ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Loading candles… (sentiment origin tier: ${tier})`);
  const store = await loadCandleStore({ sentimentOrigins: SENTIMENT_ORIGIN_TIERS[tier] });
  const articleCount = [...store.newsBySymbol.values()].reduce((n, a) => n + a.length, 0);
  console.log(
    `Universe ${store.instruments.length} stocks, ${store.tradingDates.length} trading days; ` +
      `${articleCount} scored articles across ${store.newsBySymbol.size} symbols (tier ${tier}).\n`,
  );

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

  // Sentiment coverage on the baseline set: the factor returns exactly 50 when
  // no articles are in-window (thin-coverage-neutral), so score ≠ 50 ≈ informed.
  const sentInformed = basePairs.filter((p) => {
    const s = p.signal.factorScores.sentiment;
    return s != null && s !== 50;
  }).length;
  console.log(
    `  Sentiment coverage: ${sentInformed}/${basePairs.length} trades ` +
      `(${((100 * sentInformed) / basePairs.length).toFixed(1)}%) carry an informed (≠ neutral-50) score [tier ${tier}].`,
  );

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

  // ── 2f. ACTIVATE the sentiment bucket (B7 Phase 2 selection test) ──
  // The 2d pattern: conditioning is range-restricted, so the honest question is
  // whether sentiment-informed SELECTION picks a better trade set. λ scales the
  // spec's regime weight matrix. Run per-tier (script arg) — reconstructed
  // availability (GDELT/BSE_BACKFILL) is weaker evidence than live capture.
  console.log(`\n=== 2f. ACTIVATE sentiment bucket at λ × spec regime weights (Δ vs baseline) [tier ${tier}] ===`);
  console.log(`  Earns its bucket if activating RAISES expectancy / PF (picks better stocks).`);
  console.log(`  ${padE('sent λ', 20)} ${pad('signals', 8)} ${pad('win%', 7)} ${pad('exp%', 8)} ${pad('PF', 6)}  ${pad('Δexp', 8)} ${pad('Δsignals', 9)}`);
  for (const lambda of [0.1, 0.25, 0.5, 1.0]) {
    const v = runVariant(store, `λ=${lambda}`, withSentimentBucket(lambda));
    const dExp = v.metrics.expectancyPct - baseM.expectancyPct;
    console.log(
      `  ${padE(`λ=${lambda}`, 20)} ${pad(v.signalCount, 8)} ${pad(v.metrics.winRatePct, 7)} ${pad(pct(v.metrics.expectancyPct), 8)} ${pad(v.metrics.profitFactor, 6)}  ${pad(pct(dExp), 8)} ${pad(v.signalCount - baseSignals.length >= 0 ? '+' + (v.signalCount - baseSignals.length) : v.signalCount - baseSignals.length, 9)}`,
    );
  }

  // ── 2g. Sentiment FACTOR-FLOOR gate (B7 Phase 2) — the B5 tail-trim mechanism ──
  // 2f blends the score into the composite (re-ranks everything); this instead
  // just refuses the actively-negative tail. Floors ≤ 50 keep uncovered names
  // (thin coverage → neutral 50); 55 additionally demands positive sentiment.
  console.log(`\n=== 2g. SENTIMENT FLOOR gate (reject sentiment < floor; Δ vs baseline) [tier ${tier}] ===`);
  console.log(`  Earns a floor if trimming the negative-sentiment tail RAISES expectancy / PF.`);
  console.log(`  ${padE('floor', 20)} ${pad('signals', 8)} ${pad('win%', 7)} ${pad('exp%', 8)} ${pad('PF', 6)}  ${pad('Δexp', 8)} ${pad('Δsignals', 9)}`);
  for (const floor of [40, 45, 48, 50, 55]) {
    const v = runVariant(store, `floor=${floor}`, new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, sentimentFactorFloor: floor }));
    const dExp = v.metrics.expectancyPct - baseM.expectancyPct;
    console.log(
      `  ${padE(`floor=${floor}`, 20)} ${pad(v.signalCount, 8)} ${pad(v.metrics.winRatePct, 7)} ${pad(pct(v.metrics.expectancyPct), 8)} ${pad(v.metrics.profitFactor, 6)}  ${pad(pct(dExp), 8)} ${pad(v.signalCount - baseSignals.length >= 0 ? '+' + (v.signalCount - baseSignals.length) : v.signalCount - baseSignals.length, 9)}`,
    );
  }

  console.log(
    `\n  ⚠️ Survivorship bias (today's constituents), signal-edge (no 2-position cap).` +
      `\n     Conditioning is range-restricted (all trades already cleared the gates) — it measures` +
      `\n     marginal discrimination WITHIN the selected set, not standalone factor power.` +
      `\n     Sentiment (2f/2g): backfilled origins carry RECONSTRUCTED availableAt — validate any` +
      `\n     positive result on the live/live+bse tiers before believing it (SENTIMENT_FACTOR.md §4).`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
