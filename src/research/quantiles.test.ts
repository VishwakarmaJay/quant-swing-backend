import { describe, expect, test } from 'bun:test';

import type { PanelRow } from './panelBuilder';
import { decileSpread, monotonicity, quantileSpread } from './quantiles';
import type { LabelOf, ScoreOf } from './rankIC';

const row = (date: string, symbol: string, score: number, ret: number, logAdv: number | null = 10): PanelRow => ({
  date,
  symbol,
  instrumentId: symbol,
  sector: 'IT',
  regime: 'SIDEWAYS',
  scores: { composite: score },
  dq: 1,
  logAdv,
  fwd: { 5: ret },
});

const scoreOf: ScoreOf = (r) => r.scores.composite;
const labelOf: LabelOf = (r) => r.fwd?.[5];

describe('quantileSpread', () => {
  test('score perfectly predicts return → monotone deciles, positive spread', () => {
    const panel: PanelRow[] = [];
    for (let d = 0; d < 20; d++) {
      const date = `d${d}`;
      for (let k = 0; k < 20; k++) panel.push(row(date, `S${k}`, k, k)); // ret == score
    }
    const cells = quantileSpread(panel, scoreOf, labelOf, 'EW', { nDeciles: 10, minObs: 10 });
    expect(cells).toHaveLength(10);
    expect(cells[0]!.decile).toBe(1);
    expect(cells[9]!.decile).toBe(10);
    expect(cells[9]!.meanRet).toBeGreaterThan(cells[0]!.meanRet);
    expect(monotonicity(cells)).toBe(1);
    expect(decileSpread(cells)!).toBeGreaterThan(0);
  });

  test('inverse relationship → negative spread', () => {
    const panel: PanelRow[] = [];
    for (let d = 0; d < 20; d++) {
      for (let k = 0; k < 20; k++) panel.push(row(`d${d}`, `S${k}`, k, -k));
    }
    const cells = quantileSpread(panel, scoreOf, labelOf, 'EW', { nDeciles: 10, minObs: 10 });
    expect(decileSpread(cells)!).toBeLessThan(0);
  });

  test('VW differs from EW when weights are skewed within a decile', () => {
    // One date, 10 names, deciles of size 1. Put 2 names in the SAME decile by
    // using 10 deciles over 20 names so each decile has 2, with different weights.
    const panel: PanelRow[] = [];
    for (let d = 0; d < 5; d++) {
      const date = `d${d}`;
      for (let k = 0; k < 20; k++) {
        // pair (2k, 2k+1) share a decile; give the odd one a huge weight & different return
        const score = k;
        const ret = k % 2 === 0 ? 0 : 100;
        const logAdv = k % 2 === 0 ? Math.log(1) : Math.log(1000); // heavy weight on the ret=100 leg
        panel.push(row(date, `S${k}`, score, ret, logAdv));
      }
    }
    const ew = quantileSpread(panel, scoreOf, labelOf, 'EW', { nDeciles: 10, minObs: 10 });
    const vw = quantileSpread(panel, scoreOf, labelOf, 'VW', { nDeciles: 10, minObs: 10 });
    // In a decile holding {ret 0 weight 1, ret 100 weight 1000}, EW≈50 but VW≈100.
    const ewMid = ew.find((c) => c.decile === 5)!;
    const vwMid = vw.find((c) => c.decile === 5)!;
    expect(vwMid.meanRet).toBeGreaterThan(ewMid.meanRet);
  });

  test('VW excludes rows with null logAdv; EW keeps them', () => {
    const panel: PanelRow[] = [];
    for (let d = 0; d < 3; d++) {
      for (let k = 0; k < 12; k++) panel.push(row(`d${d}`, `S${k}`, k, k, k === 0 ? null : 10));
    }
    const ewObs = quantileSpread(panel, scoreOf, labelOf, 'EW', { nDeciles: 10, minObs: 10 }).reduce((a, c) => a + c.nObs, 0);
    const vwObs = quantileSpread(panel, scoreOf, labelOf, 'VW', { nDeciles: 10, minObs: 10 }).reduce((a, c) => a + c.nObs, 0);
    expect(ewObs).toBeGreaterThan(vwObs); // the null-logAdv rows are dropped only in VW
  });

  test('dates below minObs contribute nothing', () => {
    const panel = [row('thin', 'A', 1, 1), row('thin', 'B', 2, 2)];
    expect(quantileSpread(panel, scoreOf, labelOf, 'EW', { nDeciles: 10, minObs: 10 })).toHaveLength(0);
  });
});
