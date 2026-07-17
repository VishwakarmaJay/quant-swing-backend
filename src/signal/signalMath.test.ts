import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';
import { computeSignalLevels } from './signalMath';

/** Flat candles at `close` with a ±halfRangePct intrabar range. */
const flat = (n: number, close: number, halfRangePct: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    tradeDate: `d${i}`,
    open: close,
    high: close * (1 + halfRangePct / 100),
    low: close * (1 - halfRangePct / 100),
    close,
    volume: 0,
  }));

/** Steadily rising candles where each close clears the prior high (breakout). */
const rising = (n: number, start: number, incr: number, halfRangePct: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = start + incr * i;
    return {
      tradeDate: `d${i}`,
      open: close,
      high: close * (1 + halfRangePct / 100),
      low: close * (1 - halfRangePct / 100),
      close,
      volume: 0,
    };
  });

describe('computeSignalLevels', () => {
  test('rejects when history is shorter than the resistance lookback', () => {
    const r = computeSignalLevels(flat(30, 100, 0.3));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('insufficient-history');
  });

  test('breakout with clear overhead → valid signal with sane levels', () => {
    const r = computeSignalLevels(rising(70, 100, 1, 0.3));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stopLoss).toBeLessThan(r.entry);
      expect(r.slPct).toBeGreaterThanOrEqual(0.5);
      expect(r.slPct).toBeLessThanOrEqual(3.0);
      // targets are 2R / 3R above entry.
      expect(r.target1).toBeCloseTo(r.entry + 2 * r.riskPerShare, 1);
      expect(r.target2).toBeCloseTo(r.entry + 3 * r.riskPerShare, 1);
      expect(r.resistance).toBeNull(); // fresh high → clear overhead
    }
  });

  test('ATR% ≥ reject threshold → atr-too-high', () => {
    const r = computeSignalLevels(flat(70, 100, 3.1)); // ~6.2% ATR
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('atr-too-high');
  });

  test('nearby resistance (range-bound) → rr-resistance', () => {
    const r = computeSignalLevels(flat(70, 100, 0.3));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('rr-resistance');
  });

  test('stop wider than the max band → sl-band', () => {
    // ~4% ATR (both stops wide) plus a deep recent swing low.
    const candles = flat(70, 100, 2);
    candles[62] = { ...candles[62]!, low: 95 };
    const r = computeSignalLevels(candles);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sl-band');
  });

  test('is deterministic', () => {
    const candles = rising(70, 100, 1, 0.3);
    expect(computeSignalLevels(candles)).toEqual(computeSignalLevels(candles));
  });
});
