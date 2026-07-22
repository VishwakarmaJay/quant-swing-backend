import { describe, expect, test } from 'bun:test';

import type { CandleStore } from '@/backtest';
import type { Candle } from '@/ohlcv';

import type { PanelRow } from './panelBuilder';
import { residualizeLabels } from './residualize';

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const T = 60;
const M = 30;
const DATES = Array.from({ length: T }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}#${i}`);
const SCORE_DATE = DATES[T - 1]!;

/** A random-walk candle series (seeded). */
const walk = (rand: () => number, start = 100): Candle[] => {
  let px = start;
  return DATES.map((d) => {
    px *= 1 + (rand() - 0.5) * 0.04;
    return { tradeDate: d, open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 1000 };
  });
};

const buildStore = (seed: number): { store: CandleStore; sectors: Map<string, string> } => {
  const rand = mulberry32(seed);
  const benchmark = walk(rand, 1000);
  const seriesById = new Map<string, Candle[]>();
  const instruments = [];
  const sectors = new Map<string, string>();
  const SEC = ['IT', 'BANK', 'PHARM'];
  for (let i = 0; i < M; i++) {
    const id = `i${i}`;
    seriesById.set(id, walk(rand, 50 + i));
    const sector = SEC[i % SEC.length]!;
    instruments.push({ id, symbol: `S${i}-EQ`, name: `S${i}`, sector });
    sectors.set(id, sector);
  }
  const store = {
    instruments,
    seriesById,
    benchmark,
    tradingDates: DATES,
    fundamentalsBySymbol: new Map(),
    vixByDate: new Map(),
    newsBySymbol: new Map(),
  } as unknown as CandleStore;
  return { store, sectors };
};

const pearson = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
};

describe('residualizeLabels', () => {
  test('label = a pure regressor (logAdv) ⇒ residual ≈ 0', () => {
    const { store } = buildStore(1);
    const panel: PanelRow[] = store.instruments.map((inst, i) => ({
      date: SCORE_DATE,
      symbol: `S${i}`,
      instrumentId: inst.id,
      sector: inst.sector,
      regime: 'SIDEWAYS',
      scores: { composite: 50 },
      dq: 1,
      logAdv: 8 + i * 0.1,
      fwd: { 5: 3 * (8 + i * 0.1) }, // label is exactly 3×logAdv → fully explained
    }));
    residualizeLabels(panel, store, 5, { minObs: 20 });
    for (const r of panel) expect(Math.abs(r.resid![5]!)).toBeLessThan(1e-6);
  });

  test('residuals are orthogonal to the size regressor and have ~zero mean', () => {
    const { store } = buildStore(2);
    const rand = mulberry32(77);
    const panel: PanelRow[] = store.instruments.map((inst, i) => {
      const logAdv = 8 + i * 0.13;
      const noise = (rand() - 0.5) * 4;
      return {
        date: SCORE_DATE,
        symbol: `S${i}`,
        instrumentId: inst.id,
        sector: inst.sector,
        regime: 'SIDEWAYS',
        scores: { composite: 50 },
        dq: 1,
        logAdv,
        fwd: { 5: 2 * logAdv + noise }, // size effect + orthogonal noise
      } as PanelRow;
    });
    residualizeLabels(panel, store, 5, { minObs: 20 });
    const resid = panel.map((r) => r.resid![5]!);
    const logAdv = panel.map((r) => r.logAdv!);
    const meanResid = resid.reduce((a, b) => a + b, 0) / resid.length;
    expect(Math.abs(meanResid)).toBeLessThan(1e-6); // orthogonal to intercept
    expect(Math.abs(pearson(resid, logAdv))).toBeLessThan(1e-6); // orthogonal to size col
  });

  test('leaves resid unset when the cross-section is below minObs', () => {
    const { store } = buildStore(3);
    const panel: PanelRow[] = store.instruments.slice(0, 5).map((inst, i) => ({
      date: SCORE_DATE,
      symbol: `S${i}`,
      instrumentId: inst.id,
      sector: inst.sector,
      regime: 'SIDEWAYS',
      scores: { composite: 50 },
      dq: 1,
      logAdv: 8 + i,
      fwd: { 5: i },
    }));
    residualizeLabels(panel, store, 5, { minObs: 20 });
    expect(panel.every((r) => r.resid?.[5] === undefined)).toBe(true);
  });

  test('leaves resid unset for rows missing the label or size proxy', () => {
    const { store } = buildStore(4);
    const panel: PanelRow[] = store.instruments.map((inst, i) => ({
      date: SCORE_DATE,
      symbol: `S${i}`,
      instrumentId: inst.id,
      sector: inst.sector,
      regime: 'SIDEWAYS',
      scores: { composite: 50 },
      dq: 1,
      logAdv: i === 0 ? null : 8 + i * 0.1, // first row has no size proxy
      fwd: i === 1 ? {} : { 5: i }, // second row has no label
    }));
    residualizeLabels(panel, store, 5, { minObs: 20 });
    expect(panel[0]!.resid?.[5]).toBeUndefined(); // dropped: no size proxy
    expect(panel[1]!.resid?.[5]).toBeUndefined(); // dropped: no label
    expect(panel[2]!.resid?.[5]).toBeDefined();
  });
});
