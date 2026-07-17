import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';
import { TrendFactor } from './trendFactor';
import type { StockContext } from './types';

/** Builds a StockContext from a close-price series (OHLC flattened to close). */
const ctxFromCloses = (closes: number[]): StockContext => ({
  symbol: 'TEST',
  asOf: '2026-07-16',
  candles: closes.map((close, i): Candle => ({
    tradeDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  })),
  dataQualityScore: 1,
});

const factor = new TrendFactor();

describe('TrendFactor', () => {
  test('scores 0 with an explanation when history is too short for EMA200', () => {
    const result = factor.evaluate(ctxFromCloses([100, 101, 102]));
    expect(result.score).toBe(0);
    expect(result.explanations[0]).toContain('insufficient history');
  });

  test('full bullish stack scores 100', () => {
    // Strictly rising series: price > EMA20 > EMA50 > EMA200.
    const closes = Array.from({ length: 220 }, (_, i) => 100 + i);
    const result = factor.evaluate(ctxFromCloses(closes));
    expect(result.score).toBe(100);
    expect(result.agreementContribution).toBe(1);
    expect(result.explanations[0]).toContain('Bullish EMA stack');
  });

  test('full bearish stack scores 0', () => {
    // Strictly falling series: price < EMA20 < EMA50 < EMA200.
    const closes = Array.from({ length: 220 }, (_, i) => 400 - i);
    const result = factor.evaluate(ctxFromCloses(closes));
    expect(result.score).toBe(0);
    expect(result.agreementContribution).toBe(-1);
    expect(result.explanations[0]).toContain('Bearish EMA stack');
  });

  test('is deterministic — same context yields identical output', () => {
    const closes = Array.from({ length: 220 }, (_, i) => 100 + Math.sin(i) * 10 + i * 0.5);
    const ctx = ctxFromCloses(closes);
    expect(factor.evaluate(ctx)).toEqual(factor.evaluate(ctx));
  });

  test('exposes raw EMAs in metrics for attribution', () => {
    const result = factor.evaluate(ctxFromCloses(Array.from({ length: 220 }, (_, i) => 100 + i)));
    expect(result.metrics.emaFast).toBeGreaterThan(result.metrics.emaMid as number);
    expect(result.metrics.emaMid).toBeGreaterThan(result.metrics.emaSlow as number);
  });
});
