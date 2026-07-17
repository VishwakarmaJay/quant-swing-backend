import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';
import type { StockContext } from './types';
import { VolatilityFactor } from './volatilityFactor';

/** N flat-close candles with a fixed half-range → controllable ATR%. */
const makeCtx = (n: number, close: number, halfRange: number): StockContext => ({
  symbol: 'TEST',
  asOf: '2026-07-16',
  candles: Array.from({ length: n }, (_, i): Candle => ({
    tradeDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close,
    high: close + halfRange,
    low: close - halfRange,
    close,
    volume: 0,
  })),
  dataQualityScore: 1,
});

const factor = new VolatilityFactor();

describe('VolatilityFactor', () => {
  test('neutral 50 with an explanation when history is too short for ATR', () => {
    const result = factor.evaluate(makeCtx(10, 100, 1));
    expect(result.score).toBe(50);
    expect(result.explanations[0]).toContain('insufficient history');
  });

  test('calm (low ATR%) → score 100', () => {
    // half-range 0.4 → ATR 0.8 → 0.8% of 100, below idealAtrPct 1.5.
    const result = factor.evaluate(makeCtx(60, 100, 0.4));
    expect(result.score).toBe(100);
    expect(result.metrics.atrPct as number).toBeLessThan(1.5);
    expect(result.explanations.join()).toContain('calm');
  });

  test('very volatile (ATR% ≥ reject) → score 0', () => {
    // half-range 8 → ATR 16 → 16% of 100, above rejectAtrPct 6.
    const result = factor.evaluate(makeCtx(60, 100, 8));
    expect(result.score).toBe(0);
    expect(result.explanations.join()).toContain('too volatile');
  });

  test('is non-directional — agreementContribution is always 0', () => {
    expect(factor.evaluate(makeCtx(60, 100, 0.4)).agreementContribution).toBe(0);
    expect(factor.evaluate(makeCtx(60, 100, 8)).agreementContribution).toBe(0);
  });

  test('is deterministic — same context yields identical output', () => {
    const ctx = makeCtx(60, 100, 1.2);
    expect(factor.evaluate(ctx)).toEqual(factor.evaluate(ctx));
  });

  test('exposes atr / atrPct / atrPercentile in metrics', () => {
    const result = factor.evaluate(makeCtx(60, 100, 0.4));
    expect(result.metrics.atr).toBe(0.8);
    expect(result.metrics).toHaveProperty('atrPercentile');
  });
});
