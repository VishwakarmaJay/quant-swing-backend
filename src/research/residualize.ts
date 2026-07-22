import type { CandleStore } from '@/backtest';
import { canonicalSymbol } from '@/universe/symbols';

import type { Horizon } from './forwardLabels';
import type { PanelRow } from './panelBuilder';

/**
 * Cross-sectional residualisation (research layer, Task 4/5). Per DATE, regress
 * the forward return on market beta + sector dummies + a size proxy, and replace
 * the label with the OLS residual. A factor whose raw/excess deciles are flat
 * can still carry signal in RESIDUAL space if beta/size dispersion swamps it
 * (audit H-5) — this makes that testable.
 *
 * WHY THIS FILE EXISTS (Task 3 duplication justification): nothing in the repo
 * does cross-sectional residualisation or OLS; this is genuinely new. It reuses
 * the injected `CandleStore` for prices and `canonicalSymbol` for keys — no
 * ranking/label/candle logic is re-implemented.
 *
 * DAY CONVENTION — trading days throughout. β is a TRAILING as-of estimate over
 * `betaWindow` daily returns ending at the score date (no lookahead: only
 * candles ≤ date feed β). SIZE PROXY — `logAdv` from the panel (log rolling
 * median close×volume), a documented approximation of market cap.
 *
 * BASE LABEL — residualisation is applied to the RAW forward return (`fwd`);
 * regressing out market β already removes the market component, so residualising
 * the market-excess `xs` would double-remove it. Output goes to `row.resid[h]`.
 */

export type ResidualizeOptions = {
  betaWindow?: number;
  /** Minimum cross-section size for a date to be residualised. */
  minObs?: number;
};

const DEFAULT_BETA_WINDOW = 252;

/** Solve A x = b (A is p×p) by Gaussian elimination with partial pivoting; null if singular. */
const solveLinear = (A: number[][], b: number[]): number[] | null => {
  const p = b.length;
  const M = A.map((row, i) => [...row, b[i]!]); // augmented p×(p+1)
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const pivVal = M[col]![col]!;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / pivVal;
      if (f === 0) continue;
      for (let c = col; c <= p; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[p]! / row[i]!);
};

/** OLS residuals of y on X (X includes its own intercept column); null if singular/underdetermined. */
const olsResiduals = (X: number[][], y: number[]): number[] | null => {
  const n = y.length;
  const p = X[0]?.length ?? 0;
  if (n <= p) return null;
  const XtX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i]!;
    for (let a = 0; a < p; a++) {
      Xty[a]! += xi[a]! * y[i]!;
      for (let b2 = a; b2 < p; b2++) XtX[a]![b2]! += xi[a]! * xi[b2]!;
    }
  }
  for (let a = 0; a < p; a++) for (let b2 = 0; b2 < a; b2++) XtX[a]![b2]! = XtX[b2]![a]!;
  const beta = solveLinear(XtX, Xty);
  if (!beta) return null;
  return y.map((yi, i) => {
    let fit = 0;
    for (let a = 0; a < p; a++) fit += beta[a]! * X[i]![a]!;
    return yi - fit;
  });
};

/** Precomputed as-of trailing-beta lookup for one instrument. */
type BetaSeries = { dateIndex: Map<string, number>; stockRet: number[]; benchRet: number[] };

const buildBetaSeries = (store: CandleStore): Map<string, BetaSeries> => {
  const benchClose = new Map((store.benchmark ?? []).map((c) => [c.tradeDate, c.close]));
  const out = new Map<string, BetaSeries>();
  for (const inst of store.instruments) {
    const series = store.seriesById.get(inst.id) ?? [];
    const dateIndex = new Map<string, number>();
    const stockRet: number[] = [];
    const benchRet: number[] = [];
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1]!;
      const cur = series[i]!;
      const b1 = benchClose.get(cur.tradeDate);
      const b0 = benchClose.get(prev.tradeDate);
      if (prev.close <= 0 || b0 == null || b1 == null || b0 <= 0) continue;
      dateIndex.set(cur.tradeDate, stockRet.length);
      stockRet.push(cur.close / prev.close - 1);
      benchRet.push(b1 / b0 - 1);
    }
    out.set(inst.id, { dateIndex, stockRet, benchRet });
  }
  return out;
};

/** Trailing β of a stock as of `date` over `window` daily returns; null if too short/degenerate. */
const betaAsOf = (bs: BetaSeries | undefined, date: string, window: number): number | null => {
  if (!bs) return null;
  const idx = bs.dateIndex.get(date);
  if (idx == null) return null;
  const start = Math.max(0, idx - window + 1);
  const rs = bs.stockRet.slice(start, idx + 1);
  const rb = bs.benchRet.slice(start, idx + 1);
  if (rs.length < 20) return null; // too few points for a meaningful β
  const mb = rb.reduce((a, b) => a + b, 0) / rb.length;
  const ms = rs.reduce((a, b) => a + b, 0) / rs.length;
  let cov = 0;
  let varb = 0;
  for (let i = 0; i < rs.length; i++) {
    cov += (rs[i]! - ms) * (rb[i]! - mb);
    varb += (rb[i]! - mb) ** 2;
  }
  return varb > 0 ? cov / varb : null;
};

/**
 * Residualise the raw forward return at `horizon` per date and write it to
 * `row.resid[horizon]`. Returns the same panel (mutated). A row is residualised
 * only if its label, β, and size proxy are all available and its date's
 * cross-section is large enough; otherwise `resid[horizon]` is left unset.
 */
export const residualizeLabels = (
  panel: PanelRow[],
  store: CandleStore,
  horizon: Horizon,
  opts: ResidualizeOptions = {},
): PanelRow[] => {
  const betaWindow = opts.betaWindow ?? DEFAULT_BETA_WINDOW;
  const minObs = opts.minObs ?? 20;
  const betaByInst = buildBetaSeries(store);

  const byDate = new Map<string, PanelRow[]>();
  for (const r of panel) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);

  for (const [, rows] of byDate) {
    // Assemble regressors for rows with everything present.
    const usable: { row: PanelRow; y: number; beta: number; sector: string; logAdv: number }[] = [];
    for (const row of rows) {
      const y = row.fwd?.[horizon];
      if (y == null || !Number.isFinite(y)) continue;
      if (row.logAdv == null) continue;
      const beta = betaAsOf(betaByInst.get(row.instrumentId), row.date, betaWindow);
      if (beta == null) continue;
      usable.push({ row, y, beta, sector: canonicalSymbol(row.sector ?? '') || '__NONE__', logAdv: row.logAdv });
    }
    if (usable.length < minObs) continue;

    // Sector dummies: one-hot with the first sector as the dropped reference.
    const sectors = [...new Set(usable.map((u) => u.sector))];
    const ref = sectors[0]!;
    const dummySectors = sectors.filter((s) => s !== ref);

    const X = usable.map((u) => {
      const cols = [1, u.beta, u.logAdv]; // intercept, β, size
      for (const s of dummySectors) cols.push(u.sector === s ? 1 : 0);
      return cols;
    });
    const y = usable.map((u) => u.y);
    const resid = olsResiduals(X, y);
    if (!resid) continue;
    usable.forEach((u, i) => {
      (u.row.resid ??= {})[horizon] = resid[i]!;
    });
  }
  return panel;
};
