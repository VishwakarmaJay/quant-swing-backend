import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';
import type { StockContext } from './types';
import { VolumeFactor } from './volumeFactor';

/** Context from parallel close + volume arrays. */
const ctxFrom = (closes: number[], volumes: number[]): StockContext => ({
  symbol: 'TEST',
  asOf: '2026-07-16',
  candles: closes.map((close, i): Candle => ({
    tradeDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes[i] ?? 0,
  })),
  dataQualityScore: 1,
});

const factor = new VolumeFactor();

// 30 bars; last 5 volumes elevated (3000) vs prior (1000) → relVol 2× → full conviction.
const surgeVolumes = Array.from({ length: 30 }, (_, i) => (i >= 25 ? 3000 : 1000));
const flatVolumes = Array.from({ length: 30 }, () => 1000);
const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
const falling = Array.from({ length: 30 }, (_, i) => 200 - i);

describe('VolumeFactor', () => {
  test('scores 0 when history is too short', () => {
    const result = factor.evaluate(ctxFrom([1, 2, 3], [10, 10, 10]));
    expect(result.score).toBe(0);
    expect(result.explanations[0]).toContain('insufficient history');
  });

  test('up move on above-average volume → accumulation → 100', () => {
    const result = factor.evaluate(ctxFrom(rising, surgeVolumes));
    expect(result.score).toBe(100);
    expect(result.agreementContribution).toBe(1);
    expect(result.explanations.join()).toContain('accumulation');
  });

  test('down move on above-average volume → distribution → 0', () => {
    const result = factor.evaluate(ctxFrom(falling, surgeVolumes));
    expect(result.score).toBe(0);
    expect(result.agreementContribution).toBe(-1);
    expect(result.explanations.join()).toContain('distribution');
  });

  test('move on average volume is unconfirmed → neutral 50', () => {
    const result = factor.evaluate(ctxFrom(rising, flatVolumes));
    expect(result.score).toBe(50);
    expect(result.explanations.join()).toContain('unconfirmed');
  });

  test('no volume (index rows) → 0 with a clear reason', () => {
    const result = factor.evaluate(ctxFrom(rising, Array.from({ length: 30 }, () => 0)));
    expect(result.score).toBe(0);
    expect(result.explanations[0]).toContain('no volume data');
  });

  test('is deterministic — same context yields identical output', () => {
    const ctx = ctxFrom(rising, surgeVolumes);
    expect(factor.evaluate(ctx)).toEqual(factor.evaluate(ctx));
  });
});
