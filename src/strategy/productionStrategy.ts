import { BullPullbackStrategy, type BullPullbackConfig } from './bullPullbackStrategy';
import { DEFAULT_STRATEGY_CONFIG, type StrategyConfig } from './types';
import { WeightedStrategy } from './weightedStrategy';

/**
 * The graduated production strategy (ROADMAP B2, upgraded to the B9 stack by
 * operator decision 2026-07-20). `DEFAULT_STRATEGY_CONFIG` is deliberately the
 * *frozen research baseline* — every backtest control (attribution, regime,
 * phase6, portfolio) reads it as `baseline`/`withSrs(0)`, so it must not drift.
 * Production instead runs the jointly-selected B9 stack, exactly as the
 * anchored walk-forward selected it on ALL 4 coverage-era folds × both origin
 * tiers and as `backtest:portfolio` evaluated it (B9_RERUN.md):
 *
 *  - Sector-relative RS in the composite at weight 0.25 (Step 3).
 *  - BULL pullback + resumption entry (Step 4b-v2) — off-BULL it delegates
 *    byte-for-byte to the WeightedStrategy, so only the BULL entry changes.
 *  - Fundamental floor 50 (B5) + sentiment factor floor 50 (B7) — tail-trim
 *    gates read straight off the bundle (buckets stay empty/dormant).
 *  - Volume REMOVED from the composite (B9 joint pruning — `-novol` was in
 *    every selected winner; the factor is still computed/observational).
 *
 * Honesty note: this is the *least-negative validated* config, not a profitable
 * one (coverage-era portfolio −6.5% vs Nifty +0.8% — B10 stays hard-gated).
 * Orders remain manual decision support.
 */

/** Production technical weights: SRS 0.25 in, volume out (composite renormalizes). */
const PRODUCTION_TECHNICAL_WEIGHTS: Record<string, number> = (() => {
  const w: Record<string, number> = {
    ...DEFAULT_STRATEGY_CONFIG.technicalFactorWeights,
    sectorRelativeStrength: 0.25,
  };
  delete w.volume;
  return w;
})();

/** WeightedStrategy config for production: the B9 stack over the frozen baseline. */
export const PRODUCTION_STRATEGY_CONFIG: StrategyConfig = {
  ...DEFAULT_STRATEGY_CONFIG,
  technicalFactorWeights: PRODUCTION_TECHNICAL_WEIGHTS,
  fundamentalFloor: 50,
  sentimentFactorFloor: 50,
};

/**
 * BULL pullback+resumption entry config (Step 4b-v2, the walk-forward pick).
 * Note this is NOT `DEFAULT_BULL_PULLBACK_CONFIG` — the validated variant
 * additionally requires the MACD histogram to be rising (resumption).
 */
export const PRODUCTION_BULL_PULLBACK_CONFIG: BullPullbackConfig = {
  rsiMin: 40,
  rsiMax: 55,
  maxExtensionAbovePct: 2,
  requireStack: true,
  requireAboveEma50: true,
  requireRsiRising: false,
  requireHistogramRising: true,
};

/** Builds the live production strategy: BULL pullback entry over the SRS-weighted composite. */
export const createProductionStrategy = (): BullPullbackStrategy =>
  new BullPullbackStrategy(
    PRODUCTION_BULL_PULLBACK_CONFIG,
    new WeightedStrategy(PRODUCTION_STRATEGY_CONFIG),
  );
