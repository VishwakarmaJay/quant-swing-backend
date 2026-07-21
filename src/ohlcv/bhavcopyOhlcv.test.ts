import { describe, expect, test } from 'bun:test';

import { backAdjustSplits, parseBhavcopyOhlcv, type BhavOhlcvRow } from './bhavcopyOhlcv';

// Real bhavcopy shape: leading spaces on every field, canonical symbols, EQ
// series kept and others dropped.
const HEADER =
  'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER';
const row = (
  sym: string,
  series: string,
  date: string,
  prev: number,
  o: number,
  h: number,
  l: number,
  c: number,
  vol: number,
) =>
  ` ${sym}, ${series}, ${date}, ${prev}, ${o}, ${h}, ${l}, ${c}, ${c}, ${((h + l) / 2).toFixed(2)}, ${vol}, 100.00, 10, 5, 50.00`;

describe('parseBhavcopyOhlcv', () => {
  test('extracts EQ OHLC rows, drops non-EQ, honours the wanted filter', () => {
    const csv = [
      HEADER,
      row('DHFL', 'EQ', '25-Mar-2021', 20, 21, 22, 19, 20, 1000),
      row('DHFL', 'BE', '25-Mar-2021', 20, 21, 22, 19, 20, 1000), // non-EQ dropped
      row('RELCAPITAL', 'EQ', '25-Mar-2021', 15, 15, 16, 14, 15, 500),
      row('TCS', 'EQ', '25-Mar-2021', 3000, 3010, 3020, 2990, 3005, 200), // not wanted
    ].join('\n');
    const { rows, skipped } = parseBhavcopyOhlcv(csv, new Set(['DHFL', 'RELCAPITAL']));
    expect(rows.map((r) => r.symbol)).toEqual(['DHFL', 'RELCAPITAL']);
    expect(rows[0]).toMatchObject({ tradeDate: '2021-03-25', open: 21, high: 22, low: 19, close: 20, prevClose: 20, volume: 1000 });
    expect(skipped).toBe(0);
  });

  test('skips corrupt rows (non-positive / high<low / short) without throwing', () => {
    const csv = [
      HEADER,
      row('AAA', 'EQ', '01-Apr-2022', 10, 0, 12, 9, 11, 100), // open 0 → skip
      row('BBB', 'EQ', '01-Apr-2022', 10, 11, 9, 12, 11, 100), // high<low → skip
      ' CCC, EQ, 01-Apr-2022, 10, 11', // too few fields → skip
      row('DDD', 'EQ', '01-Apr-2022', 10, 11, 12, 9, 11, 100), // ok
    ].join('\n');
    const { rows, skipped } = parseBhavcopyOhlcv(csv);
    expect(rows.map((r) => r.symbol)).toEqual(['DDD']);
    expect(skipped).toBe(3);
  });
});

describe('backAdjustSplits — the corp-action wrinkle', () => {
  const mk = (date: string, prev: number, price: number, vol = 100): BhavOhlcvRow => ({
    symbol: 'X', tradeDate: date, open: price, high: price, low: price, close: price, prevClose: prev, volume: vol,
  });

  test('no action → series returned unchanged, no events', () => {
    const rows = [mk('2021-01-01', 100, 100), mk('2021-01-02', 100, 102), mk('2021-01-03', 102, 101)];
    const { rows: adj, events } = backAdjustSplits(rows);
    expect(events).toEqual([]);
    expect(adj.map((r) => r.close)).toEqual([100, 102, 101]);
  });

  test('2:1 split → pre-split prices halved, ex-date and later untouched, volume scaled up', () => {
    // Day 2 is the ex-date: prior close 100 but PREV_CLOSE stamped 50 (adjusted).
    const rows = [
      mk('2021-01-01', 98, 100, 1000), // pre-split (scale 100)
      mk('2021-01-02', 50, 50, 2000), // ex-date (scale 50), PREV_CLOSE adjusted
      mk('2021-01-03', 50, 52, 2200),
    ];
    const { rows: adj, events } = backAdjustSplits(rows);
    expect(events).toHaveLength(1);
    expect(events[0]!.exDate).toBe('2021-01-02');
    expect(events[0]!.ratio).toBeCloseTo(2, 5);
    // pre-split day halved onto the new scale; volume doubled
    expect(adj[0]!.close).toBeCloseTo(50, 5);
    expect(adj[0]!.volume).toBeCloseTo(2000, 5);
    // ex-date + later unchanged (already on new scale)
    expect(adj[1]!.close).toBeCloseTo(50, 5);
    expect(adj[2]!.close).toBeCloseTo(52, 5);
    // continuity restored: no artificial gap between day1 and day2
    expect(Math.abs(adj[0]!.close - adj[1]!.close)).toBeLessThan(1);
  });

  test('reverse split (consolidation) → pre-action prices scaled UP', () => {
    // Distressed penny stock 1→10 consolidation: price jumps 2 → 20.
    const rows = [mk('2021-06-01', 2.1, 2.0, 5000), mk('2021-06-02', 20, 20, 500)];
    const { rows: adj, events } = backAdjustSplits(rows);
    expect(events[0]!.ratio).toBeCloseTo(0.1, 5);
    expect(adj[0]!.close).toBeCloseTo(20, 5); // 2.0 × (1/0.1)
    expect(adj[1]!.close).toBeCloseTo(20, 5);
  });

  test('ordinary dividend gap below threshold is NOT adjusted (price, not total-return)', () => {
    // 3% dividend: PREV_CLOSE 97 vs prior close 100 → ratio 1.03, under threshold.
    const rows = [mk('2021-03-01', 99, 100), mk('2021-03-02', 97, 97)];
    const { rows: adj, events } = backAdjustSplits(rows);
    expect(events).toEqual([]);
    expect(adj[0]!.close).toBe(100);
  });

  test('two actions compound correctly', () => {
    // 2:1 split then another 2:1 split → earliest day scaled by 1/4.
    const rows = [
      mk('2021-01-01', 390, 400), // scale 400
      mk('2021-02-01', 200, 200), // ex1 (2:1)
      mk('2021-03-01', 100, 100), // ex2 (2:1)
    ];
    const { rows: adj, events } = backAdjustSplits(rows);
    expect(events).toHaveLength(2);
    expect(adj[0]!.close).toBeCloseTo(100, 5); // 400 / 4
    expect(adj[1]!.close).toBeCloseTo(100, 5); // 200 / 2
    expect(adj[2]!.close).toBeCloseTo(100, 5);
  });
});
