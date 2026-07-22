import type { CandleStore } from '@/backtest';
import { canonicalSymbol } from '@/universe/symbols';

import { buildForwardLabels } from './forwardLabels';
import { joinLabels, type PanelRow } from './panelBuilder';

/**
 * Gate B — data controls (research layer, Task 6). Two signals that share NO
 * logic with the eight production factors, computed straight from closes:
 *
 *  - `momentum_12_1 = close[t-21] / close[t-252] − 1` (skip the most recent
 *    month) — one of the most replicated anomalies in finance; expected to show
 *    POSITIVE mean rank IC with broadly monotone deciles.
 *  - `reversal_5d = close[t] / close[t-5] − 1` (prior one-week return) — expected
 *    to show NEGATIVE IC with the next-day forward return in retail-heavy markets
 *    (short-term reversal); the fallback control if momentum is weak in-sample.
 *
 * A Gate-B failure is DIAGNOSTIC, not a bug (contrast Gate A). Momentum has
 * genuine crash regimes; only if BOTH controls fail while Gate A passed is a
 * data/universe problem indicated.
 *
 * WHY THIS FILE EXISTS (Task 3 duplication justification): these are new signals
 * (not in the factor registry, by design). They reuse the label store
 * (`buildForwardLabels`) and the panel/label join (`joinLabels`) — no ranking,
 * candle, or label logic is re-implemented. Emits `PanelRow`s so the SAME
 * `rankIC`/`quantileSpread` harness scores them.
 *
 * DAY CONVENTION — trading days. Scores use only closes ≤ t (no lookahead);
 * labels are the next-bar-entry forward returns from `forwardLabels.ts`.
 */

/** 12-1 momentum at index `i` of a close series; null if <253 bars of history. */
export const momentum12_1 = (closes: readonly number[], i: number): number | null => {
  if (i < 252) return null;
  const num = closes[i - 21]!;
  const den = closes[i - 252]!;
  if (den <= 0) return null;
  return num / den - 1;
};

/** Prior 5-day (one-week) return at index `i`; null if <6 bars of history. */
export const reversal5d = (closes: readonly number[], i: number): number | null => {
  if (i < 5) return null;
  const den = closes[i - 5]!;
  if (den <= 0) return null;
  return closes[i]! / den - 1;
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Builds a control panel: one row per `(date, symbol)` carrying the control
 * `scores[key]`, a `logAdv` size proxy, and (after join) forward labels. Reuses
 * the label store and join so `rankIC`/`quantileSpread` apply unchanged.
 */
export const buildControlPanel = (
  store: CandleStore,
  scoreOf: (closes: readonly number[], i: number) => number | null,
  key: string,
  opts: { advWindow?: number } = {},
): PanelRow[] => {
  const advWindow = opts.advWindow ?? 20;
  const rows: PanelRow[] = [];
  for (const inst of store.instruments) {
    const series = store.seriesById.get(inst.id) ?? [];
    if (series.length === 0) continue;
    const symbol = canonicalSymbol(inst.symbol);
    const closes = series.map((c) => c.close);
    for (let i = 0; i < series.length; i++) {
      const s = scoreOf(closes, i);
      if (s == null || !Number.isFinite(s)) continue;
      const tail = series.slice(Math.max(0, i - advWindow + 1), i + 1);
      const turnovers = tail.map((c) => c.close * c.volume).filter((t) => t > 0);
      const med = turnovers.length ? median(turnovers) : NaN;
      rows.push({
        date: series[i]!.tradeDate,
        symbol,
        instrumentId: inst.id,
        sector: inst.sector,
        regime: 'ALL', // control panel is not regime-tagged
        scores: { [key]: s },
        dq: 1,
        logAdv: med > 0 ? Math.log(med) : null,
      });
    }
  }
  return joinLabels(rows, buildForwardLabels(store));
};
