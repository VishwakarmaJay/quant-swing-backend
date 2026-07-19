import { describe, expect, test } from 'bun:test';

import type { FactorResult, FeatureBundle } from '@/factors';
import { MarketRegime } from '@/regime';
import { DEFAULT_STRATEGY_CONFIG } from './types';
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

describe('WeightedStrategy — regimeGateOverrides (regime-conditioned entries)', () => {
  /** Bundle including a sectorRelativeStrength score (for the leadership gate). */
  const bundleWithSectorRs = (sectorRs: number, rsi = 55) => {
    const b = makeBundle({ rsi });
    return { ...b, results: { ...b.results, sectorRelativeStrength: fr(sectorRs) } };
  };

  test('a passing BULL setup is unaffected when no override is set (baseline preserved)', () => {
    const plain = new WeightedStrategy();
    expect(plain.evaluate(makeBundle({ rsi: 65 }), MarketRegime.BULL).passed).toBe(true);
  });

  test('BULL rsiMax override rejects an otherwise-passing overbought stock', () => {
    const s = new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, regimeGateOverrides: { [MarketRegime.BULL]: { rsiMax: 60 } } });
    const e = s.evaluate(makeBundle({ rsi: 65 }), MarketRegime.BULL); // 65 ≤ base 68 but > 60
    expect(e.passed).toBe(false);
    expect(e.rejectionReason).toBe('rsi-band');
  });

  test('the same override does NOT affect SIDEWAYS (regime-scoped)', () => {
    const s = new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, regimeGateOverrides: { [MarketRegime.BULL]: { rsiMax: 60 } } });
    expect(s.evaluate(makeBundle({ rsi: 65 }), MarketRegime.SIDEWAYS).passed).toBe(true);
  });

  test('BULL sector-leadership gate rejects a sector laggard and passes a leader', () => {
    const s = new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, regimeGateOverrides: { [MarketRegime.BULL]: { minSectorRs: 55 } } });
    const laggard = s.evaluate(bundleWithSectorRs(30), MarketRegime.BULL);
    expect(laggard.passed).toBe(false);
    expect(laggard.rejectionReason).toBe('sector-leadership');
    expect(s.evaluate(bundleWithSectorRs(80), MarketRegime.BULL).passed).toBe(true);
  });

  test('BULL skip rejects every candidate in BULL only', () => {
    const s = new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, regimeGateOverrides: { [MarketRegime.BULL]: { skip: true } } });
    const bull = s.evaluate(makeBundle(), MarketRegime.BULL);
    expect(bull.passed).toBe(false);
    expect(bull.rejectionReason).toBe('regime');
    expect(s.evaluate(makeBundle(), MarketRegime.SIDEWAYS).passed).toBe(true);
  });
});

describe('FundamentalFactor is observational (B5)', () => {
  test('a fundamental result in the bundle leaves the baseline evaluation byte-identical', () => {
    // The frozen baseline config has buckets.fundamental: [] — the registered
    // FundamentalFactor's score must not touch composite, gates, or agreement
    // until a config explicitly lists it. This is the observational guarantee.
    const plain = makeBundle();
    const withFund: FeatureBundle = {
      ...plain,
      results: { ...plain.results, fundamental: fr(95, { pe: 12, valueScore: 95 }) },
    };
    const a = strategy.evaluate(plain, MarketRegime.BULL);
    const b = strategy.evaluate(withFund, MarketRegime.BULL);
    expect(b).toEqual(a);
    expect(b.fundamentalScore).toBeNull(); // bucket inactive → not even reported
  });

  test('activation is the explicit config lever: listing it in the bucket blends the composite', () => {
    const cfg = {
      ...DEFAULT_STRATEGY_CONFIG,
      buckets: { ...DEFAULT_STRATEGY_CONFIG.buckets, fundamental: ['fundamental'] },
    };
    const active = new WeightedStrategy(cfg);
    const plain = makeBundle();
    const withFund: FeatureBundle = {
      ...plain,
      results: { ...plain.results, fundamental: fr(95) },
    };
    const e = active.evaluate(withFund, MarketRegime.BULL);
    expect(e.fundamentalScore).toBe(95);
    // BULL weights technical 0.5 / fundamental 0.2 renormalized over present buckets.
    const technical = e.technicalScore;
    const expected = Number(((technical * 0.5 + 95 * 0.2) / 0.7).toFixed(2));
    expect(e.compositeScore).toBe(expected);
  });
});

describe('SentimentFactor is observational (B7)', () => {
  test('a sentiment result in the bundle leaves the baseline evaluation byte-identical', () => {
    // The frozen baseline has buckets.sentiment: [] — the registered
    // SentimentFactor's score must not touch composite, gates (incl. gate 7
    // sentiment-floor), or agreement until a config explicitly lists it.
    const plain = makeBundle();
    const withSent: FeatureBundle = {
      ...plain,
      results: { ...plain.results, sentiment: fr(95, { articleCount: 12, sentimentMean: 0.9 }) },
    };
    const a = strategy.evaluate(plain, MarketRegime.BULL);
    const b = strategy.evaluate(withSent, MarketRegime.BULL);
    expect(b).toEqual(a);
    expect(b.sentimentScore).toBeNull(); // bucket inactive → not reported, gate 7 dormant
  });

  test('activation via the bucket lever blends the composite + arms gate 7', () => {
    const cfg = {
      ...DEFAULT_STRATEGY_CONFIG,
      buckets: { ...DEFAULT_STRATEGY_CONFIG.buckets, sentiment: ['sentiment'] },
    };
    const active = new WeightedStrategy(cfg);
    const plain = makeBundle();
    const withSent: FeatureBundle = {
      ...plain,
      results: { ...plain.results, sentiment: fr(95) },
    };
    const e = active.evaluate(withSent, MarketRegime.BULL);
    expect(e.sentimentScore).toBe(95);
    // BULL weights technical 0.5 / sentiment 0.3 renormalized over present buckets.
    const expected = Number(((e.technicalScore * 0.5 + 95 * 0.3) / 0.8).toFixed(2));
    expect(e.compositeScore).toBe(expected);
  });
});
