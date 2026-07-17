import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';
import { RelativeStrengthFactor } from './relativeStrengthFactor';
import type { StockContext } from './types';

/** Candles from a close series (only close matters for RS). */
const toCandles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    tradeDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));

/** Context with a stock series and a benchmark series (both length 61+). */
const ctx = (stock: number[], bench: number[] | null): StockContext => ({
  symbol: 'TEST',
  asOf: '2026-07-16',
  candles: toCandles(stock),
  dataQualityScore: 1,
  sector: 'IT',
  benchmark: bench ? { symbol: 'NIFTY', candles: toCandles(bench) } : null,
});

const factor = new RelativeStrengthFactor(); // lookback 60, excessCapPct 20

// 61 points: value at index 0 is the lookback anchor, index 60 is "now".
const series = (start: number, end: number): number[] => {
  const step = (end - start) / 60;
  return Array.from({ length: 61 }, (_, i) => start + step * i);
};

describe('RelativeStrengthFactor', () => {
  test('outperforming the benchmark by the cap → 100', () => {
    // stock +30% (100→130), benchmark +10% (100→110): excess +20% = cap.
    const result = factor.evaluate(ctx(series(100, 130), series(100, 110)));
    expect(result.score).toBe(100);
    expect(result.agreementContribution).toBe(1);
    expect(result.explanations[0]).toContain('Outperformed NIFTY');
  });

  test('underperforming by the cap → 0', () => {
    // stock -10%, benchmark +10%: excess −20% = −cap.
    const result = factor.evaluate(ctx(series(100, 90), series(100, 110)));
    expect(result.score).toBe(0);
    expect(result.agreementContribution).toBe(-1);
    expect(result.explanations[0]).toContain('Underperformed NIFTY');
  });

  test('matching the benchmark → neutral 50', () => {
    const result = factor.evaluate(ctx(series(100, 115), series(100, 115)));
    expect(result.score).toBe(50);
  });

  test('scores 0 with a clear reason when the benchmark is missing', () => {
    const result = factor.evaluate(ctx(series(100, 130), null));
    expect(result.score).toBe(0);
    expect(result.explanations[0]).toContain('benchmark');
  });

  test('scores 0 when history is too short for the lookback', () => {
    const result = factor.evaluate(ctx([100, 101, 102], [100, 101, 102]));
    expect(result.score).toBe(0);
    expect(result.explanations[0]).toContain('insufficient history');
  });

  test('is deterministic — same context yields identical output', () => {
    const c = ctx(series(100, 125), series(100, 110));
    expect(factor.evaluate(c)).toEqual(factor.evaluate(c));
  });
});
