import type { FactorResult, FeatureBundle } from '@/factors';
import { round } from '@/factors/indicators';
import { MarketRegime } from '@/regime';

import {
  DEFAULT_STRATEGY_CONFIG,
  type GateResult,
  type Strategy,
  type StrategyConfig,
  type StrategyEvaluation,
} from './types';

/** Reads a numeric metric off a factor result, or null if absent/non-numeric. */
const num = (r: FactorResult | undefined, key: string): number | null => {
  const v = r?.metrics[key];
  return typeof v === 'number' ? v : null;
};

/** Mean of a factor set's scores (present only), or null when none present. */
const bucketScore = (bundle: FeatureBundle, names: string[]): number | null => {
  const scores = names.map((n) => bundle.results[n]?.score).filter((s): s is number => s != null);
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
};

/** Weighted technical score over present directional factors (weights renormalized). */
const technicalComposite = (bundle: FeatureBundle, weights: Record<string, number>): number | null => {
  let sum = 0;
  let wSum = 0;
  for (const [name, w] of Object.entries(weights)) {
    const s = bundle.results[name]?.score;
    if (s == null) continue;
    sum += s * w;
    wSum += w;
  }
  return wSum > 0 ? sum / wSum : null;
};

/** Factor agreement: 1 − normalized stddev of the directional scores. */
const agreement = (bundle: FeatureBundle, names: string[]): number => {
  const scores = names.map((n) => bundle.results[n]?.score).filter((s): s is number => s != null);
  if (scores.length < 2) return 1;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const std = Math.sqrt(scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length);
  return round(Math.max(0, Math.min(1, 1 - std / 50)), 4);
};

/**
 * WeightedStrategy: regime-weighted composite of factor buckets + hard gates.
 * Buckets absent today (sentiment, fundamental) drop out and their weight is
 * renormalized onto the present buckets, so the composite is well-defined now
 * (= technical) and becomes the full blend automatically once those factors
 * exist. Gate 6 (R:R) is applied by the signal-math step; gate 7 (sentiment
 * floor) activates when a SentimentFactor is present.
 */
export class WeightedStrategy implements Strategy {
  constructor(private readonly config: StrategyConfig = DEFAULT_STRATEGY_CONFIG) {}

  evaluate(bundle: FeatureBundle, regime: MarketRegime): StrategyEvaluation {
    const cfg = this.config;

    const technicalScore = technicalComposite(bundle, cfg.technicalFactorWeights) ?? 0;
    const sentimentScore = bucketScore(bundle, cfg.buckets.sentiment);
    const fundamentalScore = bucketScore(bundle, cfg.buckets.fundamental);
    const agreementScore = agreement(bundle, cfg.buckets.technical);

    // Composite: regime weights renormalized over present buckets.
    const weights = cfg.regimeWeights[regime as 'BULL' | 'SIDEWAYS' | 'HIGH_VOL' | 'BEAR'] ??
      cfg.regimeWeights.SIDEWAYS;
    const present: { score: number; w: number }[] = [{ score: technicalScore, w: weights.technical }];
    if (sentimentScore != null) present.push({ score: sentimentScore, w: weights.sentiment });
    if (fundamentalScore != null) present.push({ score: fundamentalScore, w: weights.fundamental });
    const wSum = present.reduce((a, p) => a + p.w, 0);
    const compositeScore = round(
      wSum > 0 ? present.reduce((a, p) => a + p.score * p.w, 0) / wSum : technicalScore,
      2,
    );

    const threshold = cfg.baseThreshold + (cfg.regimeThresholdAdj[regime] ?? 0);

    // Gate-relevant indicator values from factor metrics.
    const trend = bundle.results.trend;
    const momentum = bundle.results.momentum;
    const close = num(trend, 'close');
    const emaFast = num(trend, 'emaFast');
    const histogram = num(momentum, 'histogram');
    const rsi = num(momentum, 'rsi');

    // Optional per-regime tightening (default: none → base gates unchanged).
    const override = cfg.regimeGateOverrides?.[regime];
    const rsiMin = override?.rsiMin ?? cfg.rsiMin;
    const rsiMax = override?.rsiMax ?? cfg.rsiMax;

    const gates: GateResult[] = [
      {
        name: 'regime',
        passed: regime !== MarketRegime.CRASH && !override?.skip,
        detail: regime === MarketRegime.CRASH
          ? 'CRASH — no new signals'
          : override?.skip
            ? `regime ${regime} — skipped by override`
            : `regime ${regime}`,
      },
      {
        name: 'composite',
        passed: compositeScore >= threshold,
        detail: `composite ${compositeScore} vs threshold ${threshold}`,
      },
      {
        name: 'technical-floor',
        passed: technicalScore >= cfg.technicalFloor,
        detail: `technical ${round(technicalScore, 2)} vs floor ${cfg.technicalFloor}`,
      },
      {
        name: 'macd-bullish',
        passed: histogram != null && histogram > 0,
        detail: histogram == null ? 'MACD unavailable' : `MACD histogram ${histogram}`,
      },
      {
        name: 'price-above-ema20',
        passed: close != null && emaFast != null && close > emaFast,
        detail: close == null || emaFast == null ? 'trend unavailable' : `close ${close} vs EMA20 ${emaFast}`,
      },
      {
        name: 'rsi-band',
        passed: rsi != null && rsi >= rsiMin && rsi <= rsiMax,
        detail: rsi == null ? 'RSI unavailable' : `RSI ${rsi} vs [${rsiMin}, ${rsiMax}]`,
      },
    ];

    // Regime-conditioned sector-leadership gate (only when the regime overrides it).
    if (override?.minSectorRs != null) {
      const sectorRs = bundle.results.sectorRelativeStrength?.score ?? null;
      gates.push({
        name: 'sector-leadership',
        passed: sectorRs != null && sectorRs >= override.minSectorRs,
        detail:
          sectorRs == null
            ? 'sector RS unavailable'
            : `sectorRS ${round(sectorRs, 2)} vs floor ${override.minSectorRs} (${regime})`,
      });
    }

    // Fundamental floor (B5) only when the config sets one. Reads the factor
    // result straight off the bundle — works while the bucket stays inactive.
    if (cfg.fundamentalFloor != null) {
      const fund = bundle.results.fundamental?.score ?? null;
      gates.push({
        name: 'fundamental-floor',
        passed: fund != null && fund >= cfg.fundamentalFloor,
        detail:
          fund == null
            ? 'fundamental unavailable'
            : `fundamental ${round(fund, 2)} vs floor ${cfg.fundamentalFloor}`,
      });
    }

    // Gate 7 (sentiment floor) only when a SentimentFactor is present.
    if (sentimentScore != null) {
      gates.push({
        name: 'sentiment-floor',
        passed: sentimentScore >= cfg.sentimentFloor,
        detail: `sentiment ${round(sentimentScore, 2)} vs floor ${cfg.sentimentFloor}`,
      });
    }

    // Offline ablation only: a disabled gate still reports its pass/fail (for the
    // record) but cannot cause a rejection. Absent in production config.
    const disabled = cfg.disabledGates ?? [];
    const firstFailed = gates.find((g) => !g.passed && !disabled.includes(g.name));
    const passed = firstFailed === undefined;

    const explanations = passed
      ? [`PASS in ${regime}: composite ${compositeScore} ≥ ${threshold}, agreement ${agreementScore}`]
      : [`REJECT (${firstFailed!.name}): ${firstFailed!.detail}`];

    return {
      symbol: bundle.symbol,
      asOf: bundle.asOf,
      regime,
      compositeScore,
      technicalScore: round(technicalScore, 2),
      sentimentScore: sentimentScore != null ? round(sentimentScore, 2) : null,
      fundamentalScore: fundamentalScore != null ? round(fundamentalScore, 2) : null,
      agreementScore,
      threshold,
      passed,
      rejectionReason: firstFailed?.name ?? null,
      gates,
      explanations,
    };
  }
}
