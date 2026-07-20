import { describe, expect, test } from 'bun:test';

import { DEFAULT_STRATEGY_CONFIG } from './types';
import {
  createProductionStrategy,
  PRODUCTION_BULL_PULLBACK_CONFIG,
  PRODUCTION_STRATEGY_CONFIG,
} from './productionStrategy';

/**
 * Pins the production config to the exact B9 stack the anchored walk-forward
 * selected (all 4 coverage-era folds × both tiers) and `backtest:portfolio`
 * evaluated — `pullback+srs0.25+ff50+sf50-novol` (B9_RERUN.md). Any drift here
 * changes live signal behaviour and must be a conscious, operator-approved,
 * weightsVersion-restamped decision.
 */
describe('production strategy (B9 stack)', () => {
  test('technical weights: SRS 0.25 in, volume OUT, base weights untouched', () => {
    expect(PRODUCTION_STRATEGY_CONFIG.technicalFactorWeights).toEqual({
      trend: 0.35,
      momentum: 0.3,
      relativeStrength: 0.25,
      sectorRelativeStrength: 0.25,
    });
  });

  test('both floor gates armed at 50', () => {
    expect(PRODUCTION_STRATEGY_CONFIG.fundamentalFloor).toBe(50);
    expect(PRODUCTION_STRATEGY_CONFIG.sentimentFactorFloor).toBe(50);
  });

  test('buckets stay dormant — floors read the bundle, the blend stays off', () => {
    expect(PRODUCTION_STRATEGY_CONFIG.buckets.sentiment).toEqual([]);
    expect(PRODUCTION_STRATEGY_CONFIG.buckets.fundamental).toEqual([]);
  });

  test('BULL entry is the v2 pullback+resumption walk-forward pick', () => {
    expect(PRODUCTION_BULL_PULLBACK_CONFIG).toEqual({
      rsiMin: 40,
      rsiMax: 55,
      maxExtensionAbovePct: 2,
      requireStack: true,
      requireAboveEma50: true,
      requireRsiRising: false,
      requireHistogramRising: true,
    });
    expect(createProductionStrategy().constructor.name).toBe('BullPullbackStrategy');
  });

  test('the frozen research baseline is untouched by the production config', () => {
    expect(DEFAULT_STRATEGY_CONFIG.technicalFactorWeights).toEqual({
      trend: 0.35,
      momentum: 0.3,
      relativeStrength: 0.25,
      volume: 0.1,
    });
    expect(DEFAULT_STRATEGY_CONFIG.fundamentalFloor).toBeUndefined();
    expect(DEFAULT_STRATEGY_CONFIG.sentimentFactorFloor).toBeUndefined();
  });
});
