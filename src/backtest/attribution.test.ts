import { describe, expect, test } from 'bun:test';

import { bucketByScore, conditionFeatures, metricsByRegime, spearman } from './attribution';
import type { SignalTrade } from './backtestEngine';
import type { ClosedTrade } from './tradeSimulator';

/** Minimal ClosedTrade with just the fields the attribution reads. */
const trade = (netReturnPct: number): ClosedTrade => ({
  symbol: 'X',
  sector: null,
  signalDate: '2025-01-01',
  entryDate: '2025-01-02',
  entryPrice: 100,
  exits: [],
  exitDate: '2025-01-05',
  holdingDays: 3,
  grossReturnPct: netReturnPct,
  netReturnPct,
  maePct: 0,
  mfePct: 0,
  win: netReturnPct > 0,
  finalReason: 'time-stop',
});

/** Pair with a single factor score `s` (as `trend`) and a given return. */
const pair = (s: number, ret: number, regime = 'BULL'): SignalTrade => ({
  signal: {
    symbol: 'X',
    sector: null,
    instrumentId: 'i',
    signalIndex: 10,
    entry: 100,
    stopLoss: 95,
    factorScores: { trend: s, momentum: 50, relativeStrength: 50, volume: 50, volatility: 50 },
    evaluation: {
      symbol: 'X',
      asOf: '2025-01-01',
      regime: regime as never,
      compositeScore: s,
      technicalScore: s,
      sentimentScore: null,
      fundamentalScore: null,
      agreementScore: 0.5,
      threshold: 65,
      passed: true,
      rejectionReason: null,
      gates: [],
      explanations: [],
    },
  },
  trade: trade(ret),
});

describe('spearman', () => {
  test('perfect monotonic increasing = +1', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
  });

  test('perfect monotonic decreasing = −1', () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
  });

  test('non-linear but monotonic still = +1 (rank-based)', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 1000])).toBe(1);
  });

  test('ties share the mean rank', () => {
    // x has a tie; correlation is well-defined and finite in [−1, 1]
    const r = spearman([1, 1, 2, 3], [5, 6, 7, 8]);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  test('degenerate inputs return 0', () => {
    expect(spearman([1], [1])).toBe(0);
    expect(spearman([], [])).toBe(0);
  });
});

describe('bucketByScore', () => {
  test('splits into ordered terciles low→high', () => {
    const pairs = [30, 10, 20, 60, 50, 40].map((s, i) => pair(s, i));
    const buckets = bucketByScore(pairs, (p) => p.signal.factorScores.trend!, 3);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]!.avgScore).toBeLessThan(buckets[2]!.avgScore);
    expect(buckets.reduce((a, b) => a + b.n, 0)).toBe(6);
  });

  test('empty input yields no buckets', () => {
    expect(bucketByScore([], (p) => p.signal.factorScores.trend!)).toEqual([]);
  });
});

describe('conditionFeatures', () => {
  test('recovers a positive score→return relationship on the composite', () => {
    // higher composite → higher return, monotonic
    const pairs = [50, 55, 60, 65, 70, 75].map((s, i) => pair(s, i - 2));
    const byFeature = Object.fromEntries(conditionFeatures(pairs).map((c) => [c.feature, c]));
    expect(byFeature.composite!.spearman).toBe(1);
    expect(byFeature.trend!.spearman).toBe(1);
    // a constant feature (momentum = 50 everywhere) is non-discriminating → 0
    expect(byFeature.momentum!.spearman).toBe(0);
  });
});

describe('metricsByRegime', () => {
  test('groups trades by signal-time regime, sorted by count', () => {
    const pairs = [pair(60, 1, 'BULL'), pair(61, -1, 'BULL'), pair(62, 2, 'SIDEWAYS')];
    const rows = metricsByRegime(pairs);
    expect(rows[0]!.regime).toBe('BULL');
    expect(rows[0]!.n).toBe(2);
    expect(rows[1]!.regime).toBe('SIDEWAYS');
    expect(rows[1]!.n).toBe(1);
  });
});
