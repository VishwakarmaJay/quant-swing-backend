import { describe, expect, test } from 'bun:test';

import type { Candle } from '@/ohlcv';

import type { RawSignal } from './backtestEngine';
import type { CandleStore } from './candleStore';
import { DEFAULT_PORTFOLIO_SIM_CONFIG, simulatePortfolio, type PortfolioSimConfig } from './portfolioSimulator';

/**
 * Synthetic-store tests: tiny universes with hand-built price paths so cash
 * accounting, caps, and sizing are checkable by arithmetic.
 */

const dates = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);

/** Flat-price candle series (open=high=low=close) over the shared calendar. */
const flatSeries = (price: number): Candle[] =>
  dates.map((d) => ({ tradeDate: d, open: price, high: price, low: price, close: price, volume: 1000 }));

/** Series that rises hard from a given index so T1+T2 hit the same day. */
const risingAfter = (price: number, fromIdx: number, jumpPct: number): Candle[] =>
  dates.map((d, i) => {
    const p = i >= fromIdx ? price * (1 + jumpPct / 100) : price;
    return { tradeDate: d, open: p, high: p * 1.001, low: p * 0.999, close: p, volume: 1000 };
  });

const makeStore = (series: Record<string, { candles: Candle[]; sector: string | null }>): CandleStore => ({
  instruments: Object.entries(series).map(([id, s]) => ({ id, symbol: id, name: id, sector: s.sector })),
  seriesById: new Map(Object.entries(series).map(([id, s]) => [id, s.candles])),
  benchmark: flatSeries(100),
  tradingDates: dates,
  fundamentalsBySymbol: new Map(),
  vixByDate: new Map(),
  newsBySymbol: new Map(),
});

const evaluation = (composite: number) =>
  ({
    symbol: 'X',
    asOf: dates[0]!,
    regime: 'SIDEWAYS',
    compositeScore: composite,
    technicalScore: composite,
    sentimentScore: null,
    fundamentalScore: null,
    agreementScore: 0.8,
    threshold: 65,
    passed: true,
    rejectionReason: null,
    gates: [],
    explanations: [],
  }) as unknown as RawSignal['evaluation'];

const signal = (
  instrumentId: string,
  sector: string | null,
  signalIndex: number,
  entry: number,
  stopLoss: number,
  composite = 80,
): RawSignal => ({
  symbol: instrumentId,
  sector,
  instrumentId,
  signalIndex,
  entry,
  stopLoss,
  evaluation: evaluation(composite),
  factorScores: {},
});

/** No-noise config: no costs/slippage, generous kill switch. */
const cfg = (over: Partial<PortfolioSimConfig> = {}): PortfolioSimConfig => ({
  ...DEFAULT_PORTFOLIO_SIM_CONFIG,
  costPctPerSide: 0,
  killSwitchDailyLossPct: 0,
  ...over,
});
const noSlip = { simulatorConfig: { slippageBps: 0, costPctPerSide: 0, timeStopDays: 7, emaPeriod: 20 } };

describe('simulatePortfolio', () => {
  test('flat sizing: takes a winning trade and books the arithmetic exactly', () => {
    // Entry day idx 6 at 100; price jumps +25% on idx 7 → T1 (2R=110) and T2 (3R=115)
    // both fill that day: sell 50 @110 + 50 @115 → proceeds 11,250 on 10,000 invested.
    const store = makeStore({ A: { candles: risingAfter(100, 7, 25), sector: 'IT' } });
    const r = simulatePortfolio(store, [signal('A', 'IT', 5, 100, 95)], cfg({ initialCapital: 20_000 }), noSlip);

    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t.qty).toBe(100); // slot budget 10,000 / entry 100
    expect(t.finalReason).toBe('target2');
    expect(t.pnl).toBeCloseTo(50 * 10 + 50 * 15, 0); // +1,250
    expect(r.metrics.finalEquity).toBeCloseTo(21_250, 0);
    expect(r.metrics.totalReturnPct).toBeCloseTo(6.25, 1);
  });

  test('position limit: third same-day candidate is skipped', () => {
    const store = makeStore({
      A: { candles: flatSeries(100), sector: 'IT' },
      B: { candles: flatSeries(50), sector: 'AUTO' },
      C: { candles: flatSeries(20), sector: 'PHARMA' },
    });
    const signals = [signal('A', 'IT', 5, 100, 95, 90), signal('B', 'AUTO', 5, 50, 47, 85), signal('C', 'PHARMA', 5, 20, 19, 80)];
    const r = simulatePortfolio(store, signals, cfg(), noSlip);
    expect(r.metrics.tradesTaken).toBe(2); // maxOpenPositions = 2
    expect(r.metrics.skipped['position-limit']).toBe(1);
    // Ranked by composite: A (90) and B (85) taken, C (80) skipped.
    expect(r.trades.map((t) => t.symbol).sort()).toEqual(['A', 'B']);
  });

  test('sector cap: second same-sector candidate is skipped', () => {
    const store = makeStore({
      A: { candles: flatSeries(100), sector: 'IT' },
      B: { candles: flatSeries(50), sector: 'IT' },
    });
    const r = simulatePortfolio(store, [signal('A', 'IT', 5, 100, 95, 90), signal('B', 'IT', 5, 50, 47, 85)], cfg(), noSlip);
    expect(r.metrics.tradesTaken).toBe(1);
    expect(r.metrics.skipped['sector-cap']).toBe(1);
  });

  test('conviction sizing scales qty by composite/100', () => {
    const store = makeStore({ A: { candles: flatSeries(100), sector: 'IT' } });
    const flat = simulatePortfolio(store, [signal('A', 'IT', 5, 100, 95, 80)], cfg({ sizingMode: 'flat' }), noSlip);
    const conv = simulatePortfolio(store, [signal('A', 'IT', 5, 100, 95, 80)], cfg({ sizingMode: 'conviction' }), noSlip);
    expect(flat.trades[0]!.qty).toBe(1000); // 100k slot / 100
    expect(conv.trades[0]!.qty).toBe(800); // × 0.80
  });

  test('risk sizing: qty = equity×risk% / stop distance, budget-capped', () => {
    const store = makeStore({ A: { candles: flatSeries(100), sector: 'IT' } });
    // equity 200k × 1% = 2,000 risk; stop distance 5 → 400 shares (≤ budget cap 1,000).
    const r = simulatePortfolio(store, [signal('A', 'IT', 5, 100, 95)], cfg({ sizingMode: 'risk' }), noSlip);
    expect(r.trades[0]!.qty).toBe(400);
  });

  test('tiny capital: unaffordable share is skipped as sizing', () => {
    const store = makeStore({ A: { candles: flatSeries(100_000), sector: 'IT' } });
    const r = simulatePortfolio(store, [signal('A', 'IT', 5, 100_000, 95_000)], cfg({ initialCapital: 50_000 }), noSlip);
    expect(r.metrics.tradesTaken).toBe(0);
    expect(r.metrics.skipped.sizing).toBe(1);
    expect(r.metrics.finalEquity).toBe(50_000); // untouched
  });

  test('equity curve marks open positions to market daily', () => {
    const store = makeStore({ A: { candles: risingAfter(100, 10, 10), sector: 'IT' } });
    // Time-stop exits before idx 10 would prevent the mark — use a signal entering at idx 6.
    const r = simulatePortfolio(store, [signal('A', 'IT', 5, 100, 90)], cfg({ initialCapital: 20_000 }), noSlip);
    const curve = r.equityCurve;
    // Before the jump: flat at initial. On/after entry, equity ≈ initial (flat price).
    expect(curve[0]!.equity).toBe(20_000);
    expect(Math.abs(curve[7]!.equity - 20_000)).toBeLessThan(50);
  });

  test('is deterministic', () => {
    const store = makeStore({
      A: { candles: risingAfter(100, 8, 12), sector: 'IT' },
      B: { candles: flatSeries(50), sector: 'AUTO' },
    });
    const signals = [signal('A', 'IT', 5, 100, 95, 90), signal('B', 'AUTO', 6, 50, 47, 70)];
    expect(simulatePortfolio(store, signals, cfg(), noSlip)).toEqual(simulatePortfolio(store, signals, cfg(), noSlip));
  });
});
