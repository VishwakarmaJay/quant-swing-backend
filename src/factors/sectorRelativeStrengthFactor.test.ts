import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';
import { SectorRelativeStrengthFactor } from './sectorRelativeStrengthFactor';
import type { StockContext } from './types';

/** Candles from a close series (only close matters here). */
const toCandles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    tradeDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));

/** 61 points so a 60-day lookback return is defined; linear start→end. */
const series = (start: number, end: number): number[] => {
  const step = (end - start) / 60;
  return Array.from({ length: 61 }, (_, i) => start + step * i);
};

const ctx = (stock: number[], peerReturnsPct: number[] | null): StockContext => ({
  symbol: 'TEST',
  asOf: '2026-07-16',
  candles: toCandles(stock),
  dataQualityScore: 1,
  sector: 'IT',
  benchmark: null,
  sectorPeers: peerReturnsPct ? { peerReturnsPct, lookback: 60 } : null,
});

const factor = new SectorRelativeStrengthFactor(); // lookback 60, minPeers 3

describe('SectorRelativeStrengthFactor', () => {
  test('top of its sector → high percentile score', () => {
    // stock +30%; peers include it plus laggards → it ranks at/near the top.
    const r = factor.evaluate(ctx(series(100, 130), [30, 5, -2, 1, 10]));
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.agreementContribution).toBeGreaterThan(0);
    expect(r.metrics.rankFromTop).toBe(1);
  });

  test('bottom of its sector → low percentile score', () => {
    // stock −10%; peers are all higher → it ranks last.
    const r = factor.evaluate(ctx(series(100, 90), [-10, 5, 20, 8, 15]));
    expect(r.score).toBeLessThanOrEqual(20);
    expect(r.agreementContribution).toBeLessThan(0);
  });

  test('middle of the pack → ~50', () => {
    // stock +5%, peers straddle it evenly → mid percentile.
    const r = factor.evaluate(ctx(series(100, 105), [5, -5, 15, -15, 25]));
    expect(r.score).toBeGreaterThan(30);
    expect(r.score).toBeLessThan(70);
  });

  test('ties use the mid-rank convention (tie-safe)', () => {
    // stock +5%; two peers equal (+5), two below → percentile = (2 + 0.5*3)/5 (incl self).
    const r = factor.evaluate(ctx(series(100, 105), [5, 5, 5, 1, 2]));
    // below=2 (1,2), equal=3 (three 5s incl self) → (2 + 1.5)/5 = 0.7 → 70
    expect(r.score).toBe(70);
  });

  test('no sector peer data → neutral 50, no lean', () => {
    const r = factor.evaluate(ctx(series(100, 130), null));
    expect(r.score).toBe(50);
    expect(r.agreementContribution).toBe(0);
  });

  test('too few peers (< minPeers) → neutral 50', () => {
    const r = factor.evaluate(ctx(series(100, 130), [30, 5])); // only 2 peers
    expect(r.score).toBe(50);
    expect(r.agreementContribution).toBe(0);
    expect(r.metrics.peerCount).toBe(2);
  });

  test('insufficient own history → neutral 50', () => {
    const r = factor.evaluate(ctx(series(100, 130).slice(0, 10), [30, 5, -2, 1]));
    expect(r.score).toBe(50);
    expect(r.agreementContribution).toBe(0);
  });

  test('deterministic — same input, byte-identical output', () => {
    const a = factor.evaluate(ctx(series(100, 120), [20, 3, -1, 8]));
    const b = factor.evaluate(ctx(series(100, 120), [20, 3, -1, 8]));
    expect(a).toEqual(b);
  });
});
