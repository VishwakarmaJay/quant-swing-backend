import { describe, expect, test } from 'bun:test';

import { computeMetrics } from './metrics';
import type { ClosedTrade } from './tradeSimulator';

const trade = (netReturnPct: number, reason: ClosedTrade['finalReason'] = 'target2'): ClosedTrade => ({
  symbol: 'T',
  sector: 'IT',
  signalDate: '2026-01-01',
  entryDate: '2026-01-02',
  entryPrice: 100,
  exits: [],
  exitDate: '2026-01-05',
  holdingDays: 3,
  grossReturnPct: netReturnPct,
  netReturnPct,
  maePct: -2,
  mfePct: 5,
  win: netReturnPct > 0,
  finalReason: reason,
});

describe('computeMetrics', () => {
  test('win rate, expectancy, and profit factor', () => {
    const m = computeMetrics([trade(4), trade(6), trade(-3, 'stop-loss'), trade(-1, 'time-stop')]);
    expect(m.totalTrades).toBe(4);
    expect(m.wins).toBe(2);
    expect(m.winRatePct).toBe(50);
    expect(m.expectancyPct).toBe(1.5); // (4+6-3-1)/4
    expect(m.profitFactor).toBe(2.5); // 10 / 4
    expect(m.cumulativeReturnPct).toBe(6);
  });

  test('max drawdown tracks the worst peak-to-trough of the equity curve', () => {
    // curve: +5 → +5, then −8 → −3, then +2 → −1. peak 5, trough −3 ⇒ DD −8.
    const m = computeMetrics([trade(5), trade(-8, 'stop-loss'), trade(2)]);
    expect(m.maxDrawdownPct).toBe(-8);
  });

  test('groups exit reasons', () => {
    const m = computeMetrics([trade(4), trade(-3, 'stop-loss'), trade(-1, 'stop-loss')]);
    expect(m.exitReasons).toEqual({ target2: 1, 'stop-loss': 2 });
  });

  test('empty input is safe', () => {
    const m = computeMetrics([]);
    expect(m.totalTrades).toBe(0);
    expect(m.winRatePct).toBe(0);
  });
});
