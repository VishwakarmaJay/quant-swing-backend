import { round } from '@/factors/indicators';

import type { SignalTrade } from './backtestEngine';
import { computeMetrics, type BacktestMetrics } from './metrics';

/**
 * Factor & gate attribution (HANDOFF Step 1). The backtest proves the *entries*
 * lack edge; this measures *which* part of the entry logic is responsible,
 * before anything new is built.
 *
 * Two complementary views, both on the existing generate→simulate harness:
 *   1. Conditioning — reproduce the exact live signal set, then correlate each
 *      signal's decision context (factor scores, composite, agreement) with the
 *      trade's realised net return. Answers: among the trades we take, does a
 *      higher score predict a better outcome? (edge = monotonic; no edge = flat.)
 *   2. Leave-one-out ablation (driven by the script) — disable each gate / drop
 *      each factor and re-measure, to see marginal contribution.
 *
 * Everything here is a pure function of (signal, trade) pairs, so it is unit
 * tested independently of the DB replay.
 */

/** Average-rank of each value (ties share the mean rank). */
const rank = (xs: number[]): number[] => {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based, tie-averaged
    for (let k = i; k <= j; k++) ranks[idx[k]![1]] = avgRank;
    i = j + 1;
  }
  return ranks;
};

const pearson = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? num / den : 0;
};

/**
 * Spearman rank correlation of two series in [−1, +1]. Rank-based so it is
 * robust to the factor scores' non-linear, clamped scales. Positive = higher
 * score tends to mean higher return (edge).
 */
export const spearman = (xs: number[], ys: number[]): number => {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  return round(pearson(rank(xs), rank(ys)), 3);
};

export type Bucket = {
  label: string;
  n: number;
  avgScore: number;
  metrics: BacktestMetrics;
};

/**
 * Split pairs into `count` equal-size buckets ordered by a score, low→high, and
 * compute the trade metrics of each. A factor with edge shows expectancy rising
 * from the low bucket to the high bucket.
 */
export const bucketByScore = (
  pairs: SignalTrade[],
  scoreOf: (p: SignalTrade) => number,
  count = 3,
): Bucket[] => {
  const sorted = [...pairs].sort((a, b) => scoreOf(a) - scoreOf(b));
  const n = sorted.length;
  if (n === 0) return [];
  const buckets: Bucket[] = [];
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * n) / count);
    const end = Math.floor(((b + 1) * n) / count);
    const group = sorted.slice(start, end);
    if (!group.length) continue;
    const scores = group.map(scoreOf);
    buckets.push({
      label: `${round(scores[0]!, 1)}–${round(scores[scores.length - 1]!, 1)}`,
      n: group.length,
      avgScore: round(scores.reduce((a, s) => a + s, 0) / scores.length, 2),
      metrics: computeMetrics(group.map((p) => p.trade)),
    });
  }
  return buckets;
};

export type Conditioning = {
  feature: string;
  spearman: number;
  buckets: Bucket[];
};

/** The decision-context features conditioned on, with how to read each pair. */
export const CONDITIONING_FEATURES: { feature: string; scoreOf: (p: SignalTrade) => number }[] = [
  { feature: 'trend', scoreOf: (p) => p.signal.factorScores.trend ?? NaN },
  { feature: 'momentum', scoreOf: (p) => p.signal.factorScores.momentum ?? NaN },
  { feature: 'relativeStrength', scoreOf: (p) => p.signal.factorScores.relativeStrength ?? NaN },
  { feature: 'sectorRelativeStrength', scoreOf: (p) => p.signal.factorScores.sectorRelativeStrength ?? NaN },
  { feature: 'volume', scoreOf: (p) => p.signal.factorScores.volume ?? NaN },
  { feature: 'volatility', scoreOf: (p) => p.signal.factorScores.volatility ?? NaN },
  { feature: 'fundamental', scoreOf: (p) => p.signal.factorScores.fundamental ?? NaN },
  { feature: 'composite', scoreOf: (p) => p.signal.evaluation.compositeScore },
  { feature: 'agreement', scoreOf: (p) => p.signal.evaluation.agreementScore },
];

/**
 * Conditioning report over every feature: Spearman(score, return) plus the
 * per-bucket metrics. Pairs with a missing feature score are skipped for that
 * feature only.
 */
export const conditionFeatures = (pairs: SignalTrade[], buckets = 3): Conditioning[] =>
  CONDITIONING_FEATURES.map(({ feature, scoreOf }) => {
    const usable = pairs.filter((p) => Number.isFinite(scoreOf(p)));
    return {
      feature,
      spearman: spearman(usable.map(scoreOf), usable.map((p) => p.trade.netReturnPct)),
      buckets: bucketByScore(usable, scoreOf, buckets),
    };
  });

export type RegimeBreakdown = { regime: string; n: number; metrics: BacktestMetrics };

/** Trade metrics grouped by the regime in force at signal time. */
export const metricsByRegime = (pairs: SignalTrade[]): RegimeBreakdown[] => {
  const groups = new Map<string, SignalTrade[]>();
  for (const p of pairs) {
    const r = p.signal.evaluation.regime;
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(p);
  }
  return [...groups.entries()]
    .map(([regime, ps]) => ({ regime, n: ps.length, metrics: computeMetrics(ps.map((p) => p.trade)) }))
    .sort((a, b) => b.n - a.n);
};
