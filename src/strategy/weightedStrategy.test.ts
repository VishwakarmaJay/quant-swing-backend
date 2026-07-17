import { describe, expect, test } from 'bun:test';

import type { FactorResult, FeatureBundle } from '@/factors';
import { MarketRegime } from '@/regime';
import { WeightedStrategy } from './weightedStrategy';

const fr = (score: number, metrics: Record<string, number> = {}): FactorResult => ({
  score,
  agreementContribution: (score - 50) / 50,
  explanations: [],
  metrics,
  executionTimeMs: 0,
});

/** A FeatureBundle with sane gate-passing defaults; override any field. */
const makeBundle = (o: Partial<{
  trend: number; momentum: number; rs: number; volume: number; volatility: number;
  close: number; emaFast: number; rsi: number; histogram: number;
}> = {}): FeatureBundle => ({
  symbol: 'TEST',
  asOf: '2026-07-16',
  dataQualityScore: 1,
  results: {
    trend: fr(o.trend ?? 80, { close: o.close ?? 110, emaFast: o.emaFast ?? 105 }),
    momentum: fr(o.momentum ?? 75, { rsi: o.rsi ?? 55, histogram: o.histogram ?? 5, macd: 10, signal: 5 }),
    relativeStrength: fr(o.rs ?? 70),
    volume: fr(o.volume ?? 60),
    volatility: fr(o.volatility ?? 70, { atr: 2, atrPct: 1 }),
  },
});

const strategy = new WeightedStrategy();

describe('WeightedStrategy', () => {
  test('a strong technical setup passes in BULL', () => {
    const e = strategy.evaluate(makeBundle(), MarketRegime.BULL);
    expect(e.passed).toBe(true);
    expect(e.rejectionReason).toBeNull();
    // Only the technical bucket exists → composite equals the technical score.
    expect(e.compositeScore).toBe(e.technicalScore);
    expect(e.compositeScore).toBeGreaterThanOrEqual(65);
  });

  test('CRASH regime rejects everything', () => {
    const e = strategy.evaluate(makeBundle(), MarketRegime.CRASH);
    expect(e.passed).toBe(false);
    expect(e.rejectionReason).toBe('regime');
  });

  test('weak composite is rejected', () => {
    const e = strategy.evaluate(makeBundle({ trend: 50, momentum: 50, rs: 50, volume: 50 }), MarketRegime.BULL);
    expect(e.passed).toBe(false);
    expect(e.rejectionReason).toBe('composite');
  });

  test('bearish MACD is rejected', () => {
    const e = strategy.evaluate(makeBundle({ histogram: -3 }), MarketRegime.BULL);
    expect(e.rejectionReason).toBe('macd-bullish');
  });

  test('price below EMA20 is rejected', () => {
    const e = strategy.evaluate(makeBundle({ close: 100, emaFast: 105 }), MarketRegime.BULL);
    expect(e.rejectionReason).toBe('price-above-ema20');
  });

  test('RSI outside the band is rejected', () => {
    const e = strategy.evaluate(makeBundle({ rsi: 75 }), MarketRegime.BULL);
    expect(e.rejectionReason).toBe('rsi-band');
  });

  test('the same setup can pass in BULL but fail the stricter BEAR threshold', () => {
    // composite ~74: passes BULL (65) but fails BEAR (65 + 10 = 75).
    const bundle = makeBundle();
    expect(strategy.evaluate(bundle, MarketRegime.BULL).passed).toBe(true);
    const bear = strategy.evaluate(bundle, MarketRegime.BEAR);
    expect(bear.passed).toBe(false);
    expect(bear.rejectionReason).toBe('composite');
    expect(bear.threshold).toBe(75);
  });

  test('agreement is 1 when factors agree, lower when they diverge', () => {
    const agree = strategy.evaluate(makeBundle({ trend: 70, momentum: 70, rs: 70, volume: 70 }), MarketRegime.BULL);
    expect(agree.agreementScore).toBe(1);
    const diverge = strategy.evaluate(makeBundle({ trend: 100, momentum: 20, rs: 90, volume: 10 }), MarketRegime.BULL);
    expect(diverge.agreementScore).toBeLessThan(1);
  });

  test('is deterministic', () => {
    const bundle = makeBundle({ trend: 82, momentum: 71, rs: 64, volume: 55 });
    expect(strategy.evaluate(bundle, MarketRegime.SIDEWAYS)).toEqual(
      strategy.evaluate(bundle, MarketRegime.SIDEWAYS),
    );
  });
});
