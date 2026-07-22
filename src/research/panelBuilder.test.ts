import { describe, expect, test } from 'bun:test';

import type { CandleStore } from '@/backtest';
import type { Candle } from '@/ohlcv';

import { buildForwardLabels } from './forwardLabels';
import { buildFactorPanel, joinLabels, COMPOSITE_KEY } from './panelBuilder';

/** A rising/falling candle series over consecutive March 2026 dates. */
const series = (closes: number[], startDay = 1): Candle[] =>
  closes.map((c, i) => {
    const d = `2026-03-${String(startDay + i).padStart(2, '0')}`;
    return { tradeDate: d, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 };
  });

const N = 12;
const up = series(Array.from({ length: N }, (_, i) => 100 + i * 2)); // uptrend
const down = series(Array.from({ length: N }, (_, i) => 200 - i * 3)); // downtrend
const bench = series(Array.from({ length: N }, (_, i) => 1000 + i)); // mild up

const store = {
  instruments: [
    { id: 'up1', symbol: 'UPCO-EQ', name: 'UpCo', sector: 'IT' },
    { id: 'dn1', symbol: 'DNCO-EQ', name: 'DownCo', sector: 'IT' },
  ],
  seriesById: new Map([
    ['up1', up],
    ['dn1', down],
  ]),
  benchmark: bench,
  tradingDates: bench.map((c) => c.tradeDate),
  fundamentalsBySymbol: new Map(),
  vixByDate: new Map(),
  newsBySymbol: new Map(),
} as unknown as CandleStore;

describe('buildFactorPanel — ungated cross-sectional panel', () => {
  const panel = buildFactorPanel(store, { warmupIndex: 3, advWindow: 5 });

  test('emits a row for EVERY member on EVERY date ≥ warmup (ungated)', () => {
    // dates index 3..11 = 9 dates × 2 members = 18 rows.
    expect(panel.length).toBe(9 * 2);
    // The downtrending name — which the production gates would reject — is present.
    expect(panel.some((r) => r.symbol === 'DNCO')).toBe(true);
    expect(panel.some((r) => r.symbol === 'UPCO')).toBe(true);
  });

  test('each row carries all 8 factor scores + the composite', () => {
    const r = panel[0]!;
    for (const name of [
      'trend',
      'momentum',
      'relativeStrength',
      'sectorRelativeStrength',
      'volume',
      'volatility',
      'fundamental',
      'sentiment',
      COMPOSITE_KEY,
    ]) {
      expect(typeof r.scores[name]).toBe('number');
    }
  });

  test('records dq and a size proxy (logAdv), and a regime label', () => {
    const r = panel[0]!;
    expect(r.dq).toBeGreaterThanOrEqual(0);
    expect(r.dq).toBeLessThanOrEqual(1);
    expect(r.logAdv).not.toBeNull();
    expect(typeof r.regime).toBe('string');
  });

  test('canonicalises symbols (drops -EQ)', () => {
    expect(new Set(panel.map((r) => r.symbol))).toEqual(new Set(['UPCO', 'DNCO']));
  });

  test('scores are as-of: no lookahead — a name with no candle at a date is skipped', () => {
    // Give a third instrument that stops trading early.
    const shortSeries = series([100, 101, 102, 103], 1); // only 03-01..03-04
    const store2 = {
      ...store,
      instruments: [...store.instruments, { id: 'sh1', symbol: 'SHORT-EQ', name: 'Short', sector: 'IT' }],
      seriesById: new Map([...store.seriesById, ['sh1', shortSeries]]),
    } as unknown as CandleStore;
    const p2 = buildFactorPanel(store2, { warmupIndex: 3, advWindow: 5 });
    // SHORT has no candle on/after index 4 → appears only on date index 3 (03-04).
    const shortRows = p2.filter((r) => r.symbol === 'SHORT');
    expect(shortRows.map((r) => r.date)).toEqual(['2026-03-04']);
  });

  test('logAdv is null when volume is absent', () => {
    const noVol = series([100, 101, 102, 103, 104, 105], 1).map((c) => ({ ...c, volume: 0 }));
    const store3 = {
      ...store,
      instruments: [{ id: 'nv1', symbol: 'NOVOL-EQ', name: 'NoVol', sector: 'IT' }],
      seriesById: new Map([['nv1', noVol]]),
    } as unknown as CandleStore;
    const p3 = buildFactorPanel(store3, { warmupIndex: 2, advWindow: 5 });
    expect(p3.every((r) => r.logAdv === null)).toBe(true);
  });

  test('is deterministic — identical output across runs', () => {
    const a = buildFactorPanel(store, { warmupIndex: 3, advWindow: 5 });
    const b = buildFactorPanel(store, { warmupIndex: 3, advWindow: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('joinLabels — join scores(t) to labels(t+h)', () => {
  test('attaches fwd/xs by (date, symbol); unmatched rows keep undefined', () => {
    const panel = buildFactorPanel(store, { warmupIndex: 3, advWindow: 5 });
    const labels = buildForwardLabels(store);
    const joined = joinLabels(panel, labels);

    const early = joined.find((r) => r.symbol === 'UPCO' && r.date === '2026-03-04')!;
    expect(early.fwd).toBeDefined();
    // UPCO close[i]=100+2i: score 03-04(i=3,=106) → entry 03-05(108) → h1 exit 03-06(110)
    expect(early.fwd![1]).toBeCloseTo(((110 - 108) / 108) * 100, 6);

    // The last scored date (03-12) has no forward bar → no label joined.
    const last = joined.find((r) => r.symbol === 'UPCO' && r.date === '2026-03-12');
    expect(last?.fwd).toBeUndefined();
  });
});
