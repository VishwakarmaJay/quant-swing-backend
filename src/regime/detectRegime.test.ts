import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';
import { detectRegime } from './detectRegime';
import { MarketRegime, type RegimeInput } from './types';

/** Candles from closes with a fixed half-range (% of price) → controls ATR. */
const candles = (closes: number[], halfRangePct = 0.4): Candle[] =>
  closes.map((close, i) => ({
    tradeDate: `d${i}`,
    open: close,
    high: close * (1 + halfRangePct / 100),
    low: close * (1 - halfRangePct / 100),
    close,
    volume: 0,
  }));

const linear = (start: number, end: number, n = 210): number[] =>
  Array.from({ length: n }, (_, i) => start + ((end - start) * i) / (n - 1));

const input = (niftyCandles: Candle[], breadthPct: number, vix: number | null = null): RegimeInput => ({
  asOf: '2026-07-16',
  niftyCandles,
  breadthPct,
  vix,
});

describe('detectRegime', () => {
  test('sharp Nifty drop → CRASH (overrides everything)', () => {
    const closes = linear(100, 130);
    closes[closes.length - 1] = closes[closes.length - 2]! * 0.95; // −5% day
    expect(detectRegime(input(candles(closes), 70)).regime).toBe(MarketRegime.CRASH);
  });

  test('extreme VIX → CRASH', () => {
    expect(detectRegime(input(candles(linear(100, 130)), 70, 35)).regime).toBe(MarketRegime.CRASH);
  });

  test('elevated VIX → HIGH_VOL', () => {
    expect(detectRegime(input(candles(linear(100, 130)), 70, 25)).regime).toBe(MarketRegime.HIGH_VOL);
  });

  test('no VIX but high Nifty ATR% → HIGH_VOL (proxy)', () => {
    const flat = Array.from({ length: 210 }, () => 100);
    expect(detectRegime(input(candles(flat, 1.5), 70)).regime).toBe(MarketRegime.HIGH_VOL);
  });

  test('uptrend + broad breadth → BULL', () => {
    expect(detectRegime(input(candles(linear(100, 130)), 70)).regime).toBe(MarketRegime.BULL);
  });

  test('downtrend + weak breadth → BEAR', () => {
    expect(detectRegime(input(candles(linear(130, 100)), 30)).regime).toBe(MarketRegime.BEAR);
  });

  test('uptrend but middling breadth → SIDEWAYS', () => {
    expect(detectRegime(input(candles(linear(100, 130)), 45)).regime).toBe(MarketRegime.SIDEWAYS);
  });

  test('insufficient Nifty history → SIDEWAYS with a note', () => {
    const result = detectRegime(input(candles(linear(100, 110, 50)), 50));
    expect(result.regime).toBe(MarketRegime.SIDEWAYS);
    expect(result.explanations[0]).toContain('insufficient');
  });

  test('is deterministic', () => {
    const i = input(candles(linear(100, 125)), 60, 18);
    expect(detectRegime(i)).toEqual(detectRegime(i));
  });
});
