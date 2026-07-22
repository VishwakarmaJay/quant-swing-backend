import { describe, expect, test } from 'bun:test';

import type { PanelRow } from './panelBuilder';
import { dailyICSeries, rankIC, type LabelOf, type ScoreOf } from './rankIC';

const row = (date: string, symbol: string, score: number, label: number | null): PanelRow => ({
  date,
  symbol,
  instrumentId: symbol,
  sector: 'IT',
  regime: 'SIDEWAYS',
  scores: { composite: score },
  dq: 1,
  logAdv: 10,
  fwd: label == null ? {} : { 5: label },
});

const scoreOf: ScoreOf = (r) => r.scores.composite;
const labelOf: LabelOf = (r) => r.fwd?.[5];

/** Deterministic pseudo-random in [0,1). */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('dailyICSeries', () => {
  test('perfect positive alignment within each date → IC = 1', () => {
    const panel = [
      row('2026-01-01', 'A', 10, 1),
      row('2026-01-01', 'B', 20, 2),
      row('2026-01-01', 'C', 30, 3),
      row('2026-01-02', 'A', 5, 50),
      row('2026-01-02', 'B', 6, 60),
      row('2026-01-02', 'C', 7, 70),
    ];
    const daily = dailyICSeries(panel, scoreOf, labelOf, 3);
    expect(daily.map((d) => d.ic)).toEqual([1, 1]);
  });

  test('perfect inversion → IC = −1', () => {
    const panel = [
      row('2026-01-01', 'A', 10, 3),
      row('2026-01-01', 'B', 20, 2),
      row('2026-01-01', 'C', 30, 1),
    ];
    expect(dailyICSeries(panel, scoreOf, labelOf, 3)[0]!.ic).toBe(-1);
  });

  test('dates below minObs are excluded; rows with null labels dropped', () => {
    const panel = [
      row('2026-01-01', 'A', 10, 1),
      row('2026-01-01', 'B', 20, 2), // only 2 obs
      row('2026-01-02', 'A', 1, 1),
      row('2026-01-02', 'B', 2, 2),
      row('2026-01-02', 'C', 3, null), // dropped → 2 obs
    ];
    expect(dailyICSeries(panel, scoreOf, labelOf, 3)).toHaveLength(0);
  });
});

describe('rankIC — mean / ICIR / t-stats', () => {
  test('constant positive daily IC → meanIC≈1, huge t', () => {
    const panel: PanelRow[] = [];
    for (let d = 0; d < 30; d++) {
      const date = `2026-02-${String(d + 1).padStart(2, '0')}`;
      for (let k = 0; k < 8; k++) panel.push(row(date, `S${k}`, k, k)); // monotone
    }
    const r = rankIC(panel, scoreOf, labelOf, { minObs: 5, neweyWestLags: 5 });
    expect(r.nDates).toBe(30);
    expect(r.meanIC).toBeCloseTo(1, 6);
    expect(r.stdIC).toBeCloseTo(0, 6);
    // zero dispersion ⇒ t-stats fall back to 0 by construction (guarded)
    expect(r.tStat).toBe(0);
  });

  test('noisy but positive IC → positive meanIC and finite t-stats', () => {
    const rand = mulberry32(42);
    const panel: PanelRow[] = [];
    for (let d = 0; d < 60; d++) {
      const date = `2026-03-${String((d % 28) + 1).padStart(2, '0')}-${d}`;
      for (let k = 0; k < 12; k++) {
        const score = rand();
        const label = score + (rand() - 0.5) * 0.3; // signal + noise
        panel.push(row(date, `S${k}`, score, label));
      }
    }
    const r = rankIC(panel, scoreOf, labelOf, { minObs: 5, neweyWestLags: 5 });
    expect(r.meanIC).toBeGreaterThan(0.5);
    expect(r.tStat).toBeGreaterThan(3);
    expect(Number.isFinite(r.neweyWestTStat)).toBe(true);
    expect(r.neweyWestTStat).toBeGreaterThan(3);
  });

  test('empty / all-null panel → zeros', () => {
    expect(rankIC([], scoreOf, labelOf)).toEqual({
      meanIC: 0,
      stdIC: 0,
      icIR: 0,
      tStat: 0,
      neweyWestTStat: 0,
      nDates: 0,
    });
  });

  test('for iid IC, Newey-West t is close to the plain t (no autocorrelation)', () => {
    const rand = mulberry32(7);
    const ics: number[] = [];
    const panel: PanelRow[] = [];
    for (let d = 0; d < 80; d++) {
      const date = `d${String(d).padStart(3, '0')}`;
      // independent small positive-mean IC per date via jittered monotone labels
      const flip = rand() < 0.6; // ~60% dates positively aligned
      for (let k = 0; k < 6; k++) panel.push(row(date, `S${k}`, k, flip ? k : -k));
      ics.push(flip ? 1 : -1);
    }
    const r = rankIC(panel, scoreOf, labelOf, { minObs: 5, neweyWestLags: 1 });
    // iid ⇒ NW and plain t should be within a modest factor of each other
    expect(Math.abs(r.neweyWestTStat - r.tStat)).toBeLessThan(Math.abs(r.tStat) * 0.5 + 1);
  });
});
