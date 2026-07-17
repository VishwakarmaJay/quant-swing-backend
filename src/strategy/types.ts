import type { FeatureBundle } from '@/factors';
import type { MarketRegime } from '@/regime';

/**
 * Strategy layer (docs STRATEGIES / ADR-0003). WeightedStrategy is v1's sole
 * implementation: a regime-weighted composite of the factor buckets plus hard
 * gates. It answers "is this a good trade?"; the PortfolioManager (next) answers
 * "can we take it now?".
 */

export type BucketWeights = { technical: number; sentiment: number; fundamental: number };

export type StrategyConfig = {
  /** Regime → bucket weights (docs CONFIGURATION). CRASH takes no new trades. */
  regimeWeights: Record<'BULL' | 'SIDEWAYS' | 'HIGH_VOL' | 'BEAR', BucketWeights>;
  /** Threshold add-on per regime (stricter in worse regimes). */
  regimeThresholdAdj: Record<MarketRegime, number>;
  baseThreshold: number;
  technicalFloor: number;
  sentimentFloor: number;
  rsiMin: number;
  rsiMax: number;
  /** Minimum reward:risk — used by signal math (next step). */
  rrMinimum: number;
  /** Factor names composing each bucket. */
  buckets: { technical: string[]; sentiment: string[]; fundamental: string[] };
  /** Sub-weights within the technical bucket (renormalized over present factors). */
  technicalFactorWeights: Record<string, number>;
};

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  regimeWeights: {
    BULL: { technical: 0.5, sentiment: 0.3, fundamental: 0.2 },
    SIDEWAYS: { technical: 0.35, sentiment: 0.25, fundamental: 0.4 },
    HIGH_VOL: { technical: 0.4, sentiment: 0.45, fundamental: 0.15 },
    BEAR: { technical: 0.3, sentiment: 0.3, fundamental: 0.4 },
  },
  regimeThresholdAdj: { BULL: 0, SIDEWAYS: 0, HIGH_VOL: 5, BEAR: 10, CRASH: 0 },
  baseThreshold: 65,
  technicalFloor: 60,
  sentimentFloor: 40,
  rsiMin: 35,
  rsiMax: 68,
  rrMinimum: 2.0,
  buckets: {
    // Volatility is non-directional (feeds signal-math/sizing), so it is NOT in
    // the directional technical composite.
    technical: ['trend', 'momentum', 'relativeStrength', 'volume'],
    sentiment: ['sentiment'],
    fundamental: ['fundamental'],
  },
  technicalFactorWeights: { trend: 0.35, momentum: 0.3, relativeStrength: 0.25, volume: 0.1 },
};

export type GateResult = { name: string; passed: boolean; detail: string };

export type StrategyEvaluation = {
  symbol: string;
  asOf: string;
  regime: MarketRegime;
  compositeScore: number;
  technicalScore: number;
  sentimentScore: number | null;
  fundamentalScore: number | null;
  /** Factor agreement (1 − normalized stddev); uncalibrated (docs). */
  agreementScore: number;
  threshold: number;
  /** True when every applicable gate passed. */
  passed: boolean;
  /** Name of the first failed gate, or null when passed. */
  rejectionReason: string | null;
  gates: GateResult[];
  explanations: string[];
};

export interface Strategy {
  evaluate(factors: FeatureBundle, regime: MarketRegime): StrategyEvaluation;
}
