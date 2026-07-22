import { describe, expect, test } from 'bun:test';

import type { CandleStore } from '@/backtest';
import type { Candle } from '@/ohlcv';

import { buildForwardLabels, forwardReturn, HORIZONS, type Horizon } from './forwardLabels';

const series = (closes: number[], startDay = 1): Candle[] =>
  closes.map((c, i) => {
    const d = `2026-03-${String(startDay + i).padStart(2, '0')}`;
    return { tradeDate: d, open: c, high: c, low: c, close: c, volume: 100 };
  });

const datesOf = (s: Candle[]) => s.map((c) => c.tradeDate);
const closesOf = (s: Candle[]) => new Map(s.map((c) => [c.tradeDate, c.close]));

describe('forwardReturn — next-bar entry, trading-day horizons', () => {
  // index 0..4 = 03-01 … 03-05, closes 100,110,121,133.1,146.41 (+10%/bar)
  const s = series([100, 110, 121, 133.1, 146.41]);
  const dates = datesOf(s);
  const closes = closesOf(s);

  test('entry is the NEXT bar after the score date, exit is h bars later', () => {
    // score at 03-01 (i=0): entry=03-02 (110), h=1 exit=03-03 (121) → +10%
    const r = forwardReturn(dates, closes, null, '2026-03-01', 1);
    expect(r.fwd).toBeCloseTo(10, 6);
  });

  test('h counts trading bars from the entry bar', () => {
    // score 03-01: entry 110 (03-02), h=3 exit 146.41 (03-05) → +33.1%
    const r = forwardReturn(dates, closes, null, '2026-03-01', 3);
    expect(r.fwd).toBeCloseTo(33.1, 4);
  });

  test('null (never imputed) when the forward bar does not exist', () => {
    // score at 03-04 (i=3): entry 03-05, h=1 needs i+1+h=5 → out of range
    expect(forwardReturn(dates, closes, null, '2026-03-04', 1).fwd).toBeNull();
    // score on the last bar → no entry bar at all
    expect(forwardReturn(dates, closes, null, '2026-03-05', 1).fwd).toBeNull();
  });

  test('unknown date → null', () => {
    expect(forwardReturn(dates, closes, null, '2099-01-01', 1).fwd).toBeNull();
  });

  test('excess subtracts the benchmark over the SAME window', () => {
    // benchmark flat at first, then +5% between entry and exit bars.
    const bench = new Map([
      ['2026-03-02', 200],
      ['2026-03-03', 210], // +5% over the h=1 window
    ]);
    const r = forwardReturn(dates, closes, bench, '2026-03-01', 1);
    expect(r.fwd).toBeCloseTo(10, 6);
    expect(r.xs).toBeCloseTo(10 - 5, 6); // stock +10% − bench +5% = +5%
  });

  test('xs is null when a benchmark endpoint is missing, but fwd survives', () => {
    const bench = new Map([['2026-03-02', 200]]); // missing 03-03 endpoint
    const r = forwardReturn(dates, closes, bench, '2026-03-01', 1);
    expect(r.fwd).toBeCloseTo(10, 6);
    expect(r.xs).toBeNull();
  });

  test('guards a non-positive base price', () => {
    const badCloses = new Map([
      ['2026-03-02', 0],
      ['2026-03-03', 121],
    ]);
    expect(forwardReturn(['2026-03-01', '2026-03-02', '2026-03-03'], badCloses, null, '2026-03-01', 1).fwd).toBeNull();
  });
});

describe('buildForwardLabels — over a CandleStore', () => {
  const equity = series([100, 110, 121, 133.1, 146.41, 161.051]); // 6 bars
  const benchmark = series([100, 100, 100, 100, 100, 100]); // flat → xs == fwd

  const store = {
    instruments: [{ id: 'eq1', symbol: 'ACME-EQ', name: 'Acme', sector: 'IT' }],
    seriesById: new Map([['eq1', equity]]),
    benchmark,
    tradingDates: datesOf(benchmark),
    fundamentalsBySymbol: new Map(),
    vixByDate: new Map(),
    newsBySymbol: new Map(),
  } as unknown as CandleStore;

  const labels = buildForwardLabels(store);

  test('canonicalises the symbol (drops -EQ)', () => {
    expect(labels.every((l) => l.symbol === 'ACME')).toBe(true);
  });

  test('emits a label only when ≥1 horizon is computable, never imputes', () => {
    // 6 bars: score dates that can produce at least fwd1 are those with
    // i+1+1 < 6 → i ≤ 3 → the first 4 dates (03-01 … 03-04).
    const byDate = new Map(labels.map((l) => [l.date, l]));
    expect(byDate.has('2026-03-01')).toBe(true);
    expect(byDate.has('2026-03-04')).toBe(true);
    expect(byDate.has('2026-03-05')).toBe(false); // only an entry bar, no exit
    expect(byDate.has('2026-03-06')).toBe(false); // last bar, no entry
  });

  test('longer horizons drop out first as the series runs out', () => {
    const first = labels.find((l) => l.date === '2026-03-01')!;
    // from i=0: entry i+1=1. h computable when i+1+h ≤ 5 → h ≤ 4 → only h∈{1,3}
    const present = HORIZONS.filter((h) => first.fwd[h] !== undefined);
    expect(present).toEqual([1, 3] as Horizon[]);
  });

  test('flat benchmark ⇒ xs equals fwd', () => {
    const first = labels.find((l) => l.date === '2026-03-01')!;
    for (const h of [1, 3] as Horizon[]) {
      expect(first.xs[h]).toBeCloseTo(first.fwd[h]!, 6);
    }
  });
});
