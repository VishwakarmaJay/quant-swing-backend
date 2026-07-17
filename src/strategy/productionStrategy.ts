import { BullPullbackStrategy, type BullPullbackConfig } from './bullPullbackStrategy';
import { DEFAULT_STRATEGY_CONFIG, type StrategyConfig } from './types';
import { WeightedStrategy } from './weightedStrategy';

/**
 * The graduated production strategy (ROADMAP B2). `DEFAULT_STRATEGY_CONFIG` is
 * deliberately the *frozen research baseline* — every backtest control
 * (attribution, regime, phase6, portfolio) reads it as `baseline`/`withSrs(0)`,
 * so it must not drift. Production instead runs the OOS-validated `combined`
 * config: the two robust relative levers found in the research program, wired
 * together exactly as `backtest:phase6` selected them on all 3 walk-forward
 * folds (`pullback+srs0.25`) and as `backtest:portfolio` evaluated them.
 *
 * Honesty note: this is a *less-negative*, not a profitable, strategy (OOS
 * PF 0.91, expectancy −0.12%/trade). Orders stay manual and Phase 5 remains
 * hard-gated (B10) — B2 only graduates the nightly signals off the known-worst
 * baseline onto the validated config.
 *
 * Levers:
 *  - Sector-relative RS added to the technical composite at weight 0.25 (Step 3).
 *  - BULL pullback + resumption entry (Step 4b-v2) — off-BULL it delegates
 *    byte-for-byte to the WeightedStrategy, so only the BULL entry changes.
 */

/** WeightedStrategy config for production: baseline + SRS at composite weight 0.25. */
export const PRODUCTION_STRATEGY_CONFIG: StrategyConfig = {
  ...DEFAULT_STRATEGY_CONFIG,
  technicalFactorWeights: {
    ...DEFAULT_STRATEGY_CONFIG.technicalFactorWeights,
    sectorRelativeStrength: 0.25,
  },
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
