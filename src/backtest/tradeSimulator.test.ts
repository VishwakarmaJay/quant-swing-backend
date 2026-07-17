import { describe, expect, test } from 'bun:test';
import dayjs from 'dayjs';

import type { Candle } from '@/ohlcv';
import { simulateTrade } from './tradeSimulator';

/** Candle with explicit OHLC; index `i` = calendar day offset from 2026-01-01. */
const c = (i: number, o: number, h: number, l: number, cl: number): Candle => ({
  tradeDate: dayjs('2026-01-01').add(i, 'day').format('YYYY-MM-DD'),
  open: o,
  high: h,
  low: l,
  close: cl,
  volume: 0,
});

// A flat 205-candle warmup at 100 so EMA/MACD are defined, then event candles.
const warmup = (n = 205): Candle[] => Array.from({ length: n }, (_, i) => c(i, 100, 100.2, 99.8, 100));

const meta = { symbol: 'T', sector: 'IT' };
const levels = { stopLoss: 97, target1: 106, target2: 109 }; // entry ≈ 100

describe('simulateTrade', () => {
  test('returns null when the signal is on the last candle', () => {
    const candles = warmup(205);
    expect(simulateTrade(candles, candles.length - 1, levels, meta)).toBeNull();
  });

  test('stop-loss exit when a later low breaches SL', () => {
    const candles = [...warmup(), c(205, 100, 100.5, 96, 96.5)]; // next day dips to 96 < SL 97
    const t = simulateTrade(candles, 204, levels, meta)!;
    expect(t.finalReason).toBe('stop-loss');
    expect(t.win).toBe(false);
    expect(t.netReturnPct).toBeLessThan(0);
  });

  test('target1 then target2 realizes the full move', () => {
    // Entry ~100; day1 spikes through T1 and T2.
    const candles = [...warmup(), c(205, 100, 110, 99.9, 108)];
    const t = simulateTrade(candles, 204, levels, meta)!;
    expect(t.exits.map((e) => e.reason)).toEqual(['target1-partial', 'target2']);
    expect(t.win).toBe(true);
    expect(t.netReturnPct).toBeGreaterThan(0);
  });

  test('target1 moves the stop to breakeven (second half exits ~flat)', () => {
    // Day1 hits T1 (50% out, SL→100); day2 dips to 99 → stop the remainder at breakeven.
    const candles = [...warmup(), c(205, 100, 106.5, 99.9, 105), c(206, 104, 104.5, 99, 99.5)];
    const t = simulateTrade(candles, 204, levels, meta)!;
    expect(t.exits[0]!.reason).toBe('target1-partial');
    expect(t.exits[1]!.reason).toBe('stop-loss');
    expect(t.exits[1]!.price).toBeCloseTo(t.entryPrice, 1); // breakeven stop
  });

  test('time stop exits after the holding window', () => {
    // Never hits SL or targets; drifts sideways past 7 calendar days.
    const drift = Array.from({ length: 10 }, (_, i) => c(205 + i, 100, 101, 99.5, 100.2));
    const t = simulateTrade([...warmup(), ...drift], 204, levels, meta)!;
    expect(t.finalReason).toBe('time-stop');
    expect(t.holdingDays).toBeGreaterThanOrEqual(7);
  });

  test('is deterministic', () => {
    const candles = [...warmup(), c(205, 100, 110, 99.9, 108)];
    expect(simulateTrade(candles, 204, levels, meta)).toEqual(simulateTrade(candles, 204, levels, meta));
  });
});
