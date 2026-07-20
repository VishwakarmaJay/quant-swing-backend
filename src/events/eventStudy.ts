import type { Candle } from '@/ohlcv';

/**
 * Event study math (B12). PURE — the deterministic outcome measurement the
 * architecture review specified: for each typed event, forward EXCESS return
 * over the benchmark at fixed horizons.
 *
 * The whole point is the RIGHT tail. Everything the research program has found
 * so far (both factor floors, all eight B11 rank keys) trims losers or does
 * nothing; nothing identifies large winners. Mean excess alone can't answer
 * that, so each cell also reports the upside tail (p90) and hit rate.
 *
 * POINT-IN-TIME: the window anchors at the first close STRICTLY AFTER
 * `availableAt` — the same next-open discipline the trade simulator uses. An
 * event disseminated intraday is only tradeable from the following close, so
 * measuring from the same day's close would be lookahead.
 */

export const HORIZONS = [1, 3, 5, 10] as const;
export type Horizon = (typeof HORIZONS)[number];

export type EventOutcome = {
  /** Excess return vs the benchmark, per horizon (%). */
  excessByHorizon: Partial<Record<Horizon, number>>;
};

/** Index of the first candle strictly after the as-of moment (no lookahead). */
export const anchorIndex = (candles: Candle[], availableAt: Date): number => {
  const cutoff = availableAt.toISOString().slice(0, 10);
  const i = candles.findIndex((c) => c.tradeDate > cutoff);
  return i; // -1 when the event is at/after the end of the series
};

/**
 * Forward excess return of one event: (stock % change) − (benchmark % change)
 * over the same calendar window, measured close-to-close from the anchor.
 */
export const measureEvent = (
  candles: Candle[],
  benchmarkByDate: Map<string, number>,
  availableAt: Date,
): EventOutcome | null => {
  const a = anchorIndex(candles, availableAt);
  if (a < 0) return null;
  const base = candles[a];
  if (!base || base.close <= 0) return null;
  const benchBase = benchmarkByDate.get(base.tradeDate);
  if (benchBase == null || benchBase <= 0) return null;

  const excessByHorizon: Partial<Record<Horizon, number>> = {};
  for (const h of HORIZONS) {
    const end = candles[a + h];
    if (!end || end.close <= 0) continue;
    const benchEnd = benchmarkByDate.get(end.tradeDate);
    if (benchEnd == null || benchEnd <= 0) continue;
    const stockPct = (end.close / base.close - 1) * 100;
    const benchPct = (benchEnd / benchBase - 1) * 100;
    excessByHorizon[h] = stockPct - benchPct;
  }
  return Object.keys(excessByHorizon).length ? { excessByHorizon } : null;
};

export type CellStats = {
  n: number;
  meanExcess: number;
  /** Standard error of the mean — the honest read on whether n supports the mean. */
  stdError: number;
  /** 95% CI (normal approximation). A cell only says something if it excludes 0. */
  ci95: [number, number];
  /** % of events with positive excess. */
  hitRatePct: number;
  /** Upside tail: 90th percentile excess. THE right-tail statistic. */
  p90: number;
  /** Downside tail: 10th percentile excess. */
  p10: number;
};

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

/** Summary statistics for one (type × horizon) cell. */
export const cellStats = (excesses: number[]): CellStats => {
  const n = excesses.length;
  if (n === 0) return { n: 0, meanExcess: 0, stdError: 0, ci95: [0, 0], hitRatePct: 0, p90: 0, p10: 0 };
  const mean = excesses.reduce((s, x) => s + x, 0) / n;
  const variance = n > 1 ? excesses.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const se = n > 0 ? Math.sqrt(variance / n) : 0;
  const sorted = [...excesses].sort((a, b) => a - b);
  return {
    n,
    meanExcess: mean,
    stdError: se,
    ci95: [mean - 1.96 * se, mean + 1.96 * se],
    hitRatePct: (excesses.filter((x) => x > 0).length / n) * 100,
    p90: quantile(sorted, 0.9),
    p10: quantile(sorted, 0.1),
  };
};
