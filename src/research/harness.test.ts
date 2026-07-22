import { describe, expect, test } from 'bun:test';

import type { PanelRow } from './panelBuilder';
import { rankIC, type LabelOf, type ScoreOf } from './rankIC';

/**
 * GATE A — Harness validation (STOP GATE). These are DETERMINISTIC properties of
 * a correct rank-IC harness, not market facts: a harness that cannot recover a
 * signal it was handed cannot support any conclusion. A failure here is always a
 * bug. (Task 6, Gate A.)
 *
 * Run on a large SEEDED synthetic panel so the result is exact and reproducible;
 * the same three tests are re-run on the REAL composite panel during Task 8 and
 * recorded in research-output/harness_validation.md.
 */

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const N_DATES = 300;
const N_SYMBOLS = 50;
const H = 5;

/** A synthetic panel: independent composite scores and fwd5 labels per (date, symbol). */
const buildSyntheticPanel = (seed: number): PanelRow[] => {
  const rand = mulberry32(seed);
  const panel: PanelRow[] = [];
  for (let d = 0; d < N_DATES; d++) {
    const date = `2026-${String((d % 12) + 1).padStart(2, '0')}-${String((d % 28) + 1).padStart(2, '0')}#${d}`;
    for (let s = 0; s < N_SYMBOLS; s++) {
      const composite = rand() * 100;
      const fwd5 = rand() * 12 - 6; // random forward return in ~[-6, +6]%
      panel.push({
        date,
        symbol: `S${s}`,
        instrumentId: `S${s}`,
        sector: 'IT',
        regime: 'SIDEWAYS',
        scores: { composite },
        dq: 1,
        logAdv: 10,
        fwd: { [H]: fwd5 },
      });
    }
  }
  return panel;
};

/** Fisher–Yates shuffle of the fwd5 labels WITHIN each date (seeded). */
const shuffleLabelsWithinDate = (panel: PanelRow[], seed: number): PanelRow[] => {
  const rand = mulberry32(seed);
  const byDate = new Map<string, PanelRow[]>();
  for (const r of panel) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
  for (const rows of byDate.values()) {
    const labels = rows.map((r) => r.fwd![H]!);
    for (let i = labels.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [labels[i], labels[j]] = [labels[j]!, labels[i]!];
    }
    rows.forEach((r, i) => (r.fwd = { [H]: labels[i]! }));
  }
  return panel;
};

const label5: LabelOf = (r) => r.fwd?.[H];

describe('Gate A — harness validation (STOP GATE)', () => {
  const panel = buildSyntheticPanel(2026);

  test('T1 Synthetic: factor = fwd5 ⇒ meanIC ≥ 0.95', () => {
    const factorIsLabel: ScoreOf = (r) => r.fwd?.[H];
    const r = rankIC(panel, factorIsLabel, label5, { minObs: 5, neweyWestLags: H });
    expect(r.nDates).toBe(N_DATES);
    expect(r.meanIC).toBeGreaterThanOrEqual(0.95);
  });

  test('T2 Inverse: factor = −fwd5 ⇒ meanIC ≤ −0.95', () => {
    const negLabel: ScoreOf = (r) => -(r.fwd?.[H] ?? 0);
    const r = rankIC(panel, negLabel, label5, { minObs: 5, neweyWestLags: H });
    expect(r.meanIC).toBeLessThanOrEqual(-0.95);
  });

  test('T3 Shuffled: composite vs fwd5 shuffled within date ⇒ |meanIC| < 0.02', () => {
    const shuffled = shuffleLabelsWithinDate(buildSyntheticPanel(2026), 99);
    const composite: ScoreOf = (r) => r.scores.composite;
    const r = rankIC(shuffled, composite, label5, { minObs: 5, neweyWestLags: H });
    expect(Math.abs(r.meanIC)).toBeLessThan(0.02);
  });
});
