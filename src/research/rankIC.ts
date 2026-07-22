import { spearman } from '@/backtest/attribution';

import type { PanelRow } from './panelBuilder';

/**
 * Cross-sectional rank IC (research layer, Task 4/5) — the estimand the project
 * never computed. For each DATE, the Spearman rank correlation between a
 * subject's factor scores and a forward-return label across the day's
 * cross-section; then the time-series mean, its dispersion (ICIR), and t-stats.
 *
 * WHY THIS FILE EXISTS (Task 3 duplication justification): the rank-correlation
 * primitive is REUSED as-is — `spearman` from `src/backtest/attribution.ts`
 * (verified tie-averaged mid-ranks). This module does NOT re-implement ranking.
 * What is new — and absent everywhere in the repo — is the per-DATE averaging,
 * the ICIR, and the Newey-West t-stat that corrects for the serial correlation
 * induced by OVERLAPPING forward-return windows.
 *
 * DAY CONVENTION — inherited from the labels: scores as-of the close of `t`,
 * labels are next-bar-entry, TRADING-day forward returns. Overlapping horizons
 * (h>1) make the daily IC series autocorrelated, which is exactly why the plain
 * t-stat overstates significance and the Newey-West t-stat is reported.
 *
 * NEWEY-WEST LAGS — for overlapping horizon-`h` labels the IC series is
 * autocorrelated out to ~`h` lags, so the CALLER should pass
 * `neweyWestLags ≈ horizon`. When omitted, the automatic Bartlett rule
 * `floor(4·(T/100)^(2/9))` is used (adequate for h=1, too short for long h).
 */

export type RankICResult = {
  /** Time-series mean of the daily cross-sectional rank IC. */
  meanIC: number;
  /** Sample standard deviation of the daily IC series. */
  stdIC: number;
  /** Information ratio of the IC: meanIC / stdIC. */
  icIR: number;
  /** Plain t-stat: meanIC / (stdIC / √nDates) — ignores autocorrelation. */
  tStat: number;
  /** Newey-West t-stat: meanIC / NW-stderr(mean), Bartlett kernel. */
  neweyWestTStat: number;
  /** Number of dates that met `minObs` and contributed an IC. */
  nDates: number;
};

/** A subject score accessor + a label accessor, both nullable per row. */
export type ScoreOf = (r: PanelRow) => number | null | undefined;
export type LabelOf = (r: PanelRow) => number | null | undefined;

export type RankICOptions = {
  /** Minimum cross-section size for a date to contribute an IC. */
  minObs?: number;
  /** Newey-West Bartlett lags; pass ≈ horizon for overlapping labels. */
  neweyWestLags?: number;
};

const DEFAULT_MIN_OBS = 5;

/** Sample std (ddof=1); 0 for n<2. */
const sampleStd = (xs: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
};

/** Automatic Bartlett lag rule when the caller doesn't pass one. */
const autoLags = (T: number): number => Math.max(1, Math.floor(4 * (T / 100) ** (2 / 9)));

/**
 * Newey-West long-run variance of the MEAN of `xs` (Bartlett kernel, `L` lags),
 * returned as the standard error of the mean (√(S/T)). Autocorrelation-robust.
 */
const neweyWestStdErrOfMean = (xs: number[], L: number): number => {
  const T = xs.length;
  if (T < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / T;
  const dev = xs.map((x) => x - mean);
  const gamma = (k: number): number => {
    let s = 0;
    for (let t = k; t < T; t++) s += dev[t]! * dev[t - k]!;
    return s / T;
  };
  let S = gamma(0);
  for (let k = 1; k <= L; k++) S += 2 * (1 - k / (L + 1)) * gamma(k);
  if (S <= 0) return 0; // NW variance can go non-positive; treat as undefined
  return Math.sqrt(S / T);
};

/** The daily cross-sectional IC series for one subject × label (dates ascending). */
export const dailyICSeries = (
  panel: readonly PanelRow[],
  scoreOf: ScoreOf,
  labelOf: LabelOf,
  minObs = DEFAULT_MIN_OBS,
): { date: string; ic: number; n: number }[] => {
  const byDate = new Map<string, { s: number[]; l: number[] }>();
  for (const r of panel) {
    const s = scoreOf(r);
    const l = labelOf(r);
    if (s == null || l == null || !Number.isFinite(s) || !Number.isFinite(l)) continue;
    const g = byDate.get(r.date) ?? { s: [], l: [] };
    g.s.push(s);
    g.l.push(l);
    byDate.set(r.date, g);
  }
  const out: { date: string; ic: number; n: number }[] = [];
  for (const [date, g] of byDate) {
    if (g.s.length < minObs) continue;
    out.push({ date, ic: spearman(g.s, g.l), n: g.s.length });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
};

/**
 * Full rank-IC report for one subject × label accessor. Reuses `spearman`
 * per date; adds mean/ICIR/t/Newey-West over the daily IC time series.
 */
export const rankIC = (
  panel: readonly PanelRow[],
  scoreOf: ScoreOf,
  labelOf: LabelOf,
  opts: RankICOptions = {},
): RankICResult => {
  const minObs = opts.minObs ?? DEFAULT_MIN_OBS;
  const daily = dailyICSeries(panel, scoreOf, labelOf, minObs);
  const ics = daily.map((d) => d.ic);
  const nDates = ics.length;
  if (nDates === 0) {
    return { meanIC: 0, stdIC: 0, icIR: 0, tStat: 0, neweyWestTStat: 0, nDates: 0 };
  }
  const meanIC = ics.reduce((a, b) => a + b, 0) / nDates;
  const stdIC = sampleStd(ics);
  const icIR = stdIC > 0 ? meanIC / stdIC : 0;
  const tStat = stdIC > 0 ? meanIC / (stdIC / Math.sqrt(nDates)) : 0;
  const L = opts.neweyWestLags ?? autoLags(nDates);
  const nwSE = neweyWestStdErrOfMean(ics, L);
  const neweyWestTStat = nwSE > 0 ? meanIC / nwSE : 0;
  return { meanIC, stdIC, icIR, tStat, neweyWestTStat, nDates };
};
