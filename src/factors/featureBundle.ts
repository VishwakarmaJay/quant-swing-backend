import type { Factor, FactorResult, FeatureBundle, StockContext } from './types';

/** Recursively freezes an object graph so a FeatureBundle is truly immutable. */
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/**
 * Runs every factor over one StockContext and assembles a deep-frozen,
 * immutable FeatureBundle. Timing is measured HERE (not inside evaluate) so
 * factor logic stays clock-free and byte-identical across runs; only the
 * executionTimeMs field varies run to run and is excluded from determinism
 * assertions.
 */
export const buildFeatureBundle = (
  ctx: StockContext,
  factors: readonly Factor[],
): FeatureBundle => {
  const results: Record<string, FactorResult> = {};
  for (const factor of factors) {
    const start = performance.now();
    const output = factor.evaluate(ctx);
    const executionTimeMs = Number((performance.now() - start).toFixed(3));
    results[factor.name] = { ...output, executionTimeMs };
  }

  return deepFreeze({
    symbol: ctx.symbol,
    asOf: ctx.asOf,
    results,
    dataQualityScore: ctx.dataQualityScore,
  });
};
