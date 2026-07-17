import type { Candle } from '@/ohlcv';

/**
 * Factor layer contracts (docs project/ARCHITECTURE.md, frozen). Factors are
 * pure feature extractors: same input → byte-identical output, no clock /
 * random / env reads inside evaluate (IMPLEMENTATION_RULES #4). Timing is the
 * one non-deterministic field, so it is NOT produced by evaluate — the runner
 * (buildFeatureBundle) measures it and attaches it to form the FactorResult.
 */

export const FactorCategory = {
  TREND: 'TREND',
  MOMENTUM: 'MOMENTUM',
  RELATIVE_STRENGTH: 'RELATIVE_STRENGTH',
  VOLUME: 'VOLUME',
  VOLATILITY: 'VOLATILITY',
  SENTIMENT: 'SENTIMENT',
  FUNDAMENTAL: 'FUNDAMENTAL',
} as const;
export type FactorCategory = (typeof FactorCategory)[keyof typeof FactorCategory];

/** JSON-serializable raw values a factor exposes for logging/attribution. */
export type MetricValue = number | string | boolean;

/**
 * Everything the factor computes deterministically from a StockContext. The
 * score is 0–100 (higher = more bullish); agreementContribution is the
 * directional lean in [−1, 1] (bullish +, bearish −) the strategy aggregates
 * into its agreement metric.
 */
export type FactorOutput = {
  readonly score: number;
  readonly agreementContribution: number;
  readonly explanations: readonly string[];
  readonly metrics: Readonly<Record<string, MetricValue>>;
};

/** FactorOutput plus the runner-measured execution time (docs contract). */
export type FactorResult = FactorOutput & {
  readonly executionTimeMs: number;
};

export interface Factor {
  readonly name: string;
  readonly category: FactorCategory;
  /** Pure & deterministic — no clock/random/env. Timing is added by the runner. */
  evaluate(ctx: StockContext): FactorOutput;
}

/**
 * The immutable input a factor sees: candles ascending by date, none newer
 * than `asOf` (no lookahead), plus the data-quality score from the gate.
 */
export type StockContext = {
  readonly symbol: string;
  /** ISO date (YYYY-MM-DD), injected — never read from the wall clock. */
  readonly asOf: string;
  readonly candles: readonly Candle[];
  readonly dataQualityScore: number;
};

/** Deep-frozen bundle of every factor's result for one instrument as of a date. */
export type FeatureBundle = {
  readonly symbol: string;
  readonly asOf: string;
  readonly results: Readonly<Record<string, FactorResult>>;
  readonly dataQualityScore: number;
};
