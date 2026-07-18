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
  /**
   * Gate names to skip when evaluating (default: none). Used only by offline
   * attribution/ablation tooling to measure a gate's marginal edge — production
   * config leaves this absent, so live behaviour and the weights hash are
   * unchanged.
   */
  disabledGates?: string[];
  /**
   * Optional floor on the FundamentalFactor's score (B5). When set, adds a
   * `fundamental-floor` gate that reads the factor result directly from the
   * bundle (independent of bucket activation, like the sector-leadership
   * gate) — the mechanism the B5 attribution terciles point to: trim the
   * low-fundamental loss tail rather than blend the score into the composite.
   * Absent in the default/production config → baseline byte-identical.
   */
  fundamentalFloor?: number;
  /**
   * Per-regime entry tightening (default: none). Lets a regime demand stricter
   * conditions than the base gates — the mechanism for testing regime-conditioned
   * entries (Step-1 finding: BULL is the loss sink). Absent in production config
   * until a variant is proven, so baseline behaviour and the weights hash are
   * unchanged.
   */
  regimeGateOverrides?: Partial<Record<MarketRegime, RegimeGateOverride>>;
};

/** Optional per-regime overrides layered on top of the base gates. */
export type RegimeGateOverride = {
  /** Override the RSI band lower bound in this regime. */
  rsiMin?: number;
  /** Override the RSI band upper bound in this regime (e.g. avoid overbought in BULL). */
  rsiMax?: number;
  /** Require sectorRelativeStrength ≥ this in this regime (sector leadership). */
  minSectorRs?: number;
  /** Take no new signals in this regime at all (diagnostic: quantify a regime's drag). */
  skip?: boolean;
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
    // The FundamentalFactor exists (B5) but is OBSERVATIONAL: an empty bucket
    // here keeps this frozen research baseline byte-identical (a listed factor
    // would auto-activate the regime-weighted blend). Activating it is an
    // explicit config lever — buckets.fundamental: ['fundamental'] — set only
    // on walk-forward evidence (B5/B9), mirroring how the SRS weight graduated.
    fundamental: [],
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
