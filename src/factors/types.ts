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
 * than `asOf` (no lookahead), plus the data-quality score from the gate. The
 * market benchmark (Nifty) and sector are injected too, so cross-sectional
 * factors (relative strength) stay pure — they read them from the context
 * rather than fetching anything.
 */
export type StockContext = {
  readonly symbol: string;
  /** ISO date (YYYY-MM-DD), injected — never read from the wall clock. */
  readonly asOf: string;
  readonly candles: readonly Candle[];
  readonly dataQualityScore: number;
  /** Sector label (equities); null for index instruments. */
  readonly sector?: string | null;
  /** Market benchmark candles (Nifty), aligned ≤ asOf; null if unavailable. */
  readonly benchmark?: { readonly symbol: string; readonly candles: readonly Candle[] } | null;
  /**
   * Cross-sectional sector context for SectorRelativeStrength, produced by a
   * pre-pass over the universe (a single stock can't see its peers). Holds the
   * lookback returns (%) of every equity in THIS stock's sector as of `asOf`
   * (including this stock). Absent for single-stock evaluations / index rows →
   * the factor returns a neutral 50. Kept as injected data so evaluate stays
   * pure (no fetching, no cross-instrument reads inside the factor).
   */
  readonly sectorPeers?: { readonly peerReturnsPct: readonly number[]; readonly lookback: number } | null;
  /**
   * Point-in-time fundamentals for THIS stock as of `asOf`, plus the as-of PEs
   * of its sector peers (cross-sectional pre-pass, like sectorPeers). Every
   * number is reconstructed from announcement-dated quarters (B4) — a quarter
   * enters only after its result became public, never at period end. Absent
   * (table not backfilled / index rows) → the factor returns a neutral 50.
   */
  readonly fundamentals?: StockFundamentals | null;
  /**
   * Point-in-time news sentiment for THIS stock as of `asOf` (ROADMAP B7),
   * produced by a pre-pass over the FinBERT-scored news archive: every article
   * whose honest availability time (`availableAt`) is ≤ `asOf` and within the
   * lookback window, as `{ ageDays, score, neutralProb }`. The factor aggregates
   * these (recency + confidence weighted) — kept as injected data so `evaluate`
   * stays pure. Absent / thin coverage → the factor returns a neutral 50.
   */
  readonly sentiment?: StockSentiment | null;
};

/** One as-of scored article the SentimentFactor aggregates (point-in-time). */
export type SentimentArticleInput = {
  /** `asOf − availableAt` in days (≥ 0) — the point-in-time recency key. */
  readonly ageDays: number;
  /** FinBERT pos − neg ∈ [−1, 1]. */
  readonly score: number;
  /** FinBERT neutral probability ∈ [0, 1] (drives the confidence weight). */
  readonly neutralProb: number;
};

/** The injected sentiment inputs the SentimentFactor scores (all as-of). */
export type StockSentiment = {
  /** Scored articles for this stock with `availableAt ≤ asOf`, within the window. */
  readonly articles: readonly SentimentArticleInput[];
};

/** The injected fundamental inputs the FundamentalFactor scores (all as-of). */
export type StockFundamentals = {
  /** As-of P/E (null when TTM earnings are negative/unknown). */
  readonly pe: number | null;
  /** As-of PEs of the sector peer group (valid PEs only, incl. self when valid). */
  readonly sectorPeerPes: readonly number[];
  readonly ttmEps: number | null;
  /** TTM EPS one year earlier — the YoY growth base (null until 8 known quarters). */
  readonly ttmEpsPrevYear: number | null;
  readonly quartersKnown: number;
  readonly daysSinceLastResult: number | null;
  /** A calendar quarter ended but its result is not yet public (risk window). */
  readonly resultsPending: boolean;
};

/** Deep-frozen bundle of every factor's result for one instrument as of a date. */
export type FeatureBundle = {
  readonly symbol: string;
  readonly asOf: string;
  readonly results: Readonly<Record<string, FactorResult>>;
  readonly dataQualityScore: number;
};
