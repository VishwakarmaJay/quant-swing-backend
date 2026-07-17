import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';
import { MomentumFactor } from './momentumFactor';
import type { StockContext } from './types';

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

const factor = new MomentumFactor();

describe('MomentumFactor', () => {
  test('scores 0 with an explanation when history is too short', () => {
    const result = factor.evaluate(ctxFromCloses([100, 101, 102, 103]));
    expect(result.score).toBe(0);
    expect(result.explanations[0]).toContain('insufficient history');
  });

  test('strong accelerating uptrend → score 100 (MACD bullish + RSI 100)', () => {
    // Accelerating so the MACD histogram stays positive (a linear ramp plateaus
    // MACD → histogram ≈ 0 → only the above-zero half of the MACD sub-score).
    const closes = Array.from({ length: 60 }, (_, i) => 100 * Math.pow(1.03, i));
    const result = factor.evaluate(ctxFromCloses(closes));
    expect(result.score).toBe(100);
    expect(result.agreementContribution).toBe(1);
    expect(result.explanations[0]).toContain('bullish');
  });

  test('strong downtrend → score 0 (MACD bearish + RSI 0)', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 400 - i);
    const result = factor.evaluate(ctxFromCloses(closes));
    expect(result.score).toBe(0);
    expect(result.agreementContribution).toBe(-1);
    expect(result.explanations[0]).toContain('bearish');
  });

  test('is deterministic — same context yields identical output', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 8 + i * 0.3);
    const ctx = ctxFromCloses(closes);
    expect(factor.evaluate(ctx)).toEqual(factor.evaluate(ctx));
  });

  test('exposes rsi + macd internals in metrics', () => {
    const result = factor.evaluate(
      ctxFromCloses(Array.from({ length: 60 }, (_, i) => 100 * Math.pow(1.03, i))),
    );
    expect(result.metrics.rsi).toBe(100);
    expect(result.metrics.histogram as number).toBeGreaterThan(0);
  });
});
