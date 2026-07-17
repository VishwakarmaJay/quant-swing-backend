import { describe, expect, test } from 'bun:test';

import type { FactorResult, FeatureBundle } from '@/factors';
import { MarketRegime } from '@/regime';
import { BullPullbackStrategy } from './bullPullbackStrategy';

const fr = (score: number, metrics: Record<string, number> = {}): FactorResult => ({
  score,
  agreementContribution: (score - 50) / 50,
  explanations: [],
  metrics,
  executionTimeMs: 0,
});

/** Bundle with EMA stack + RSI controllable. Uptrend intact by default. */
const makeBundle = (o: Partial<{ close: number; emaFast: number; emaMid: number; emaSlow: number; rsi: number; histogram: number }> = {}): FeatureBundle => ({
  symbol: 'TEST',
  asOf: '2026-07-16',
  dataQualityScore: 1,
  results: {
    trend: fr(80, {
      close: o.close ?? 101,
      emaFast: o.emaFast ?? 100,
      emaMid: o.emaMid ?? 95,
      emaSlow: o.emaSlow ?? 90,
    }),
    momentum: fr(60, { rsi: o.rsi ?? 48, histogram: o.histogram ?? -1, macd: 5, signal: 6 }),
    relativeStrength: fr(60),
    sectorRelativeStrength: fr(55),
    volume: fr(55),
    volatility: fr(70, { atr: 2, atrPct: 1 }),
  },
});

const strat = new BullPullbackStrategy(); // rsi 40-55, ext≤2%, stack, aboveEma50

describe('BullPullbackStrategy', () => {
  test('non-BULL regimes delegate to the base strategy unchanged', () => {
    // A pullback bundle (RSI 48, near EMA20) would NOT pass the normal strength gates
    // (RSI band + momentum), so delegating means it is rejected in SIDEWAYS just as the
    // base WeightedStrategy would — i.e. identical behaviour off-BULL.
    const bundle = makeBundle({ rsi: 48, histogram: -1 });
    const e = strat.evaluate(bundle, MarketRegime.SIDEWAYS);
    // base WeightedStrategy rejects (macd histogram < 0) — pullback logic must NOT run here
    expect(e.rejectionReason).not.toMatch(/^bull-pullback/);
  });

  test('a clean pullback passes in BULL (dip to EMA20, RSI cooled, uptrend intact)', () => {
    const e = strat.evaluate(makeBundle({ close: 101, emaFast: 100, rsi: 48 }), MarketRegime.BULL);
    expect(e.passed).toBe(true);
    expect(e.rejectionReason).toBeNull();
  });

  test('an extended stock (far above EMA20) is rejected in BULL', () => {
    const e = strat.evaluate(makeBundle({ close: 110, emaFast: 100, rsi: 50 }), MarketRegime.BULL);
    expect(e.passed).toBe(false);
    expect(e.rejectionReason).toBe('bull-pullback:pullback-not-extended');
  });

  test('an overbought RSI is rejected in BULL (not a pullback)', () => {
    const e = strat.evaluate(makeBundle({ close: 101, emaFast: 100, rsi: 66 }), MarketRegime.BULL);
    expect(e.passed).toBe(false);
    expect(e.rejectionReason).toBe('bull-pullback:pullback-rsi');
  });

  test('a broken trend (below EMA50) is rejected in BULL', () => {
    const e = strat.evaluate(makeBundle({ close: 94, emaFast: 100, emaMid: 95, rsi: 48 }), MarketRegime.BULL);
    expect(e.passed).toBe(false);
    // fails not-extended first (94 is −6% vs EMA20) or above-ema50 — either is a valid rejection
    expect(e.rejectionReason).toMatch(/^bull-pullback:/);
  });

  test('a non-stacked uptrend is rejected when requireStack', () => {
    const e = strat.evaluate(makeBundle({ close: 101, emaFast: 100, emaMid: 105, rsi: 48 }), MarketRegime.BULL);
    expect(e.passed).toBe(false);
  });

  test('keeps the base composite/score fields (only the decision changes)', () => {
    const bundle = makeBundle({ close: 101, emaFast: 100, rsi: 48 });
    const e = strat.evaluate(bundle, MarketRegime.BULL);
    expect(e.compositeScore).toBeGreaterThan(0);
    expect(e.technicalScore).toBeGreaterThan(0);
  });

  test('is deterministic', () => {
    const bundle = makeBundle({ close: 101, emaFast: 100, rsi: 48 });
    expect(strat.evaluate(bundle, MarketRegime.BULL)).toEqual(strat.evaluate(bundle, MarketRegime.BULL));
  });

  describe('v2 resumption confirmation', () => {
    const withMomentum = (rsi: number, rsiPrev: number, histogram: number, histogramPrev: number): FeatureBundle => {
      const b = makeBundle({ close: 101, emaFast: 100, rsi });
      return {
        ...b,
        results: { ...b.results, momentum: fr(60, { rsi, rsiPrev, histogram, histogramPrev, macd: 5, signal: 6 }) },
      };
    };
    const v2rsi = new BullPullbackStrategy({ rsiMin: 40, rsiMax: 55, maxExtensionAbovePct: 2, requireStack: true, requireAboveEma50: true, requireRsiRising: true, requireHistogramRising: false });

    test('rejects a still-falling dip (RSI not rising)', () => {
      const e = v2rsi.evaluate(withMomentum(48, 50, -1, -0.5), MarketRegime.BULL); // rsi 48 < prev 50
      expect(e.passed).toBe(false);
      expect(e.rejectionReason).toBe('bull-pullback:rsi-rising');
    });

    test('accepts a turning-up dip (RSI rising)', () => {
      const e = v2rsi.evaluate(withMomentum(48, 45, -0.5, -1), MarketRegime.BULL); // rsi 48 > prev 45
      expect(e.passed).toBe(true);
    });

    test('histogram-rising gate rejects a deteriorating dip', () => {
      const v2h = new BullPullbackStrategy({ rsiMin: 40, rsiMax: 55, maxExtensionAbovePct: 2, requireStack: true, requireAboveEma50: true, requireRsiRising: false, requireHistogramRising: true });
      const e = v2h.evaluate(withMomentum(48, 45, -2, -1), MarketRegime.BULL); // hist -2 < prev -1 (falling)
      expect(e.passed).toBe(false);
      expect(e.rejectionReason).toBe('bull-pullback:histogram-rising');
    });
  });
});
