import { bucketByRank } from '@/delivery/metrics';

import type { PanelRow } from './panelBuilder';
import type { LabelOf, ScoreOf } from './rankIC';

/**
 * Cross-sectional decile portfolios (research layer, Task 4/5), equal- and
 * value-weighted.
 *
 * WHY THIS FILE EXISTS (Task 3 duplication justification): the decile ENGINE is
 * REUSED — `bucketByRank` from `src/delivery/metrics.ts` (the same per-day
 * cross-sectional bucketer `runDeliveryStudy` uses). This module does NOT
 * re-implement bucketing. What is new: value-weighting (delivery/event studies
 * are equal-weight only) and emitting structured rows instead of console output.
 *
 * DAY CONVENTION — inherited from the panel/labels: deciles are formed PER DATE
 * on scores as-of the close of `t`; the return is the next-bar-entry TRADING-day
 * forward return at the chosen horizon. Buckets are pooled across dates by
 * decile, so a spread cannot be a rising-tide artifact (audit-safe, per the
 * delivery study's design note).
 *
 * WEIGHTING — `EW` is a simple mean; `VW` uses `exp(logAdv)` (average daily
 * traded value) as the weight, a documented approximation of market-cap weight
 * (no shares-outstanding data exists). Rows with a null `logAdv` are excluded
 * from `VW` (and only VW). `medianRet` is always the UNWEIGHTED median.
 */

export type DecileCell = {
  decile: number; // 1..nDeciles, 1 = lowest score
  nObs: number;
  meanRet: number;
  medianRet: number;
};

export type Weighting = 'EW' | 'VW';

export type QuantileOptions = {
  nDeciles?: number;
  /** Minimum cross-section size for a date to contribute (needs ≥ nDeciles). */
  minObs?: number;
};

const DEFAULT_N_DECILES = 10;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

type Obs = { ret: number; w: number };

/**
 * Decile portfolios for one subject × label × weighting. Reuses `bucketByRank`
 * to assign per-date deciles; pools by decile across dates; reports EW/VW mean
 * and unweighted median per decile.
 */
export const quantileSpread = (
  panel: readonly PanelRow[],
  scoreOf: ScoreOf,
  labelOf: LabelOf,
  weighting: Weighting,
  opts: QuantileOptions = {},
): DecileCell[] => {
  const nDeciles = opts.nDeciles ?? DEFAULT_N_DECILES;
  const minObs = opts.minObs ?? nDeciles;

  // date → usable rows (score + label present; weight present for VW)
  const byDate = new Map<string, { row: PanelRow; score: number; ret: number; w: number }[]>();
  for (const r of panel) {
    const s = scoreOf(r);
    const l = labelOf(r);
    if (s == null || l == null || !Number.isFinite(s) || !Number.isFinite(l)) continue;
    const w = weighting === 'VW' ? (r.logAdv == null ? NaN : Math.exp(r.logAdv)) : 1;
    if (!Number.isFinite(w) || w <= 0) continue; // VW: drop rows with no size proxy
    (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push({ row: r, score: s, ret: l, w });
  }

  const pooled = new Map<number, Obs[]>(); // decile index (0-based) → observations
  for (const rows of byDate.values()) {
    if (rows.length < minObs) continue;
    const buckets = bucketByRank(rows, (x) => x.score, nDeciles);
    for (const x of rows) {
      const d = buckets.get(x)!;
      (pooled.get(d) ?? pooled.set(d, []).get(d)!).push({ ret: x.ret, w: x.w });
    }
  }

  const cells: DecileCell[] = [];
  for (let d = 0; d < nDeciles; d++) {
    const obs = pooled.get(d) ?? [];
    if (obs.length === 0) continue;
    const wSum = obs.reduce((a, o) => a + o.w, 0);
    const meanRet = weighting === 'VW' ? obs.reduce((a, o) => a + o.w * o.ret, 0) / wSum : obs.reduce((a, o) => a + o.ret, 0) / obs.length;
    cells.push({
      decile: d + 1,
      nObs: obs.length,
      meanRet,
      medianRet: median(obs.map((o) => o.ret)),
    });
  }
  return cells;
};

/** Top-minus-bottom decile spread (mean). Undefined if either end is empty. */
export const decileSpread = (cells: DecileCell[]): number | null => {
  if (cells.length < 2) return null;
  const lo = cells[0]!;
  const hi = cells[cells.length - 1]!;
  return hi.meanRet - lo.meanRet;
};

/**
 * Monotonicity check: does mean return increase (mostly) across deciles? Returns
 * the fraction of adjacent decile steps that are non-decreasing (1 = perfectly
 * monotone increasing). Used in the summary to flag clean vs noisy spreads.
 */
export const monotonicity = (cells: DecileCell[]): number => {
  if (cells.length < 2) return 0;
  let up = 0;
  for (let i = 1; i < cells.length; i++) if (cells[i]!.meanRet >= cells[i - 1]!.meanRet) up++;
  return up / (cells.length - 1);
};
