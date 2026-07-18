import type { Strategy } from '@/strategy';

import { generateRawSignals, simulateSignalsPaired, type SignalTrade } from './backtestEngine';
import type { CandleStore } from './candleStore';
import { computeMetrics, type BacktestMetrics } from './metrics';

/**
 * Walk-forward evaluation (Phase 6). The project's single-window, grid-picked
 * numbers repeatedly flattered themselves (Step 3 SRS, Step 4b-v2 pullback both
 * looked positive in-sample and faded out-of-sample). Walk-forward is the honest
 * antidote: on each fold, SELECT the config using only the train window, then
 * MEASURE it on the unseen test window; report the concatenated test-only
 * (out-of-sample) result. A config that only wins in-sample cannot hide here.
 *
 * Reusable: give it candidate strategies + a fold scheme; it selects per fold
 * and returns OOS metrics. The specific candidate grid lives in the caller.
 */

export type Fold = { trainFrom: number; trainTo: number; testFrom: number; testTo: number };

/**
 * Expanding-window folds over the tradeable range [warmup, total). Reserves the
 * first block as initial train; each subsequent block is a test window preceded
 * by all prior data as train. Test windows are contiguous and cover
 * [warmup + testSize, total), so their concatenation is a clean OOS stretch.
 *
 * `embargoDays` (B8.3, trading days) ends each TRAIN window that many days
 * before its test window starts. Why: a signal fired near train-end produces a
 * trade whose exits (time-stop 7 calendar days, thesis-break) resolve INSIDE
 * the test window — selecting on train metrics that depend on test-window price
 * action is leakage. An embargo ≥ the max trade horizon (~10 trading days)
 * purges it. Test windows are unchanged, so OOS concatenation stays clean.
 */
export const makeExpandingFolds = (
  warmup: number,
  total: number,
  nFolds: number,
  embargoDays = 0,
): Fold[] => {
  const span = total - warmup;
  const testSize = Math.floor(span / (nFolds + 1));
  if (testSize <= 0 || nFolds < 1) return [];
  const folds: Fold[] = [];
  for (let i = 0; i < nFolds; i++) {
    const testFrom = warmup + testSize * (i + 1);
    const testTo = i === nFolds - 1 ? total : warmup + testSize * (i + 2);
    const trainTo = Math.max(warmup, testFrom - embargoDays);
    folds.push({ trainFrom: warmup, trainTo, testFrom, testTo });
  }
  return folds;
};

/** Pick the label with the highest metric value (first wins ties). */
export const pickBest = (scored: { label: string; value: number }[]): string => {
  let best = scored[0];
  for (const s of scored) if (best === undefined || s.value > best.value) best = s;
  return best?.label ?? '';
};

export type WFCandidate = { label: string; strategy: Strategy };

export type FoldResult = {
  fold: Fold;
  selected: string;
  trainExpectancy: Record<string, number>;
  testMetrics: BacktestMetrics;
};

export type WalkForwardResult = {
  folds: FoldResult[];
  /** Concatenated test trades of the per-fold selected strategy (out-of-sample). */
  oosPairs: SignalTrade[];
  oosMetrics: BacktestMetrics;
};

const windowMetrics = (store: CandleStore, strategy: Strategy, from: number, to: number): SignalTrade[] =>
  simulateSignalsPaired(store, generateRawSignals(store, { strategy, fromIndex: from, toIndex: to }));

/**
 * For each fold: score every candidate on the train window, select the best by
 * `selectBy` (default net expectancy — finite and robust, unlike PF which can be
 * Infinity), then measure that candidate on the test window. Accumulate test
 * trades across folds for the true OOS result.
 */
export const runWalkForward = (
  store: CandleStore,
  candidates: WFCandidate[],
  folds: Fold[],
  selectBy: (m: BacktestMetrics) => number = (m) => m.expectancyPct,
  onFold?: (i: number, total: number) => void,
): WalkForwardResult => {
  const foldResults: FoldResult[] = [];
  const oosPairs: SignalTrade[] = [];

  folds.forEach((fold, i) => {
    onFold?.(i, folds.length);
    const trainExpectancy: Record<string, number> = {};
    const scored = candidates.map((c) => {
      const trainPairs = windowMetrics(store, c.strategy, fold.trainFrom, fold.trainTo);
      const m = computeMetrics(trainPairs.map((p) => p.trade));
      trainExpectancy[c.label] = m.expectancyPct;
      return { label: c.label, value: selectBy(m) };
    });

    const selected = pickBest(scored);
    const chosen = candidates.find((c) => c.label === selected)!;
    const testPairs = windowMetrics(store, chosen.strategy, fold.testFrom, fold.testTo);
    oosPairs.push(...testPairs);

    foldResults.push({
      fold,
      selected,
      trainExpectancy,
      testMetrics: computeMetrics(testPairs.map((p) => p.trade)),
    });
  });

  return { folds: foldResults, oosPairs, oosMetrics: computeMetrics(oosPairs.map((p) => p.trade)) };
};
