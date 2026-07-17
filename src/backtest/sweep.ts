import { DEFAULT_SIMULATOR_CONFIG } from './tradeSimulator';
import { simulateSignals, type RawSignal } from './backtestEngine';
import { computeMetrics, type BacktestMetrics } from './metrics';
import type { CandleStore } from './candleStore';

/**
 * Parameter sweep (docs SPRINT_05: weight/parameter sensitivity harness).
 * Signals are generated once; each combo cheaply re-simulates them under a
 * different target R-multiple and time-stop. This isolates the exit/target
 * hypotheses (the backtest showed targets rarely reached inside a 7-day stop).
 */
export type SweepCombo = { timeStopDays: number; targetRr: [number, number] };

export type SweepResult = { combo: SweepCombo; metrics: BacktestMetrics };

/** Default grid: time stop × target R-multiples. */
export const DEFAULT_SWEEP_GRID: SweepCombo[] = [7, 14, 21, 30].flatMap((timeStopDays) =>
  ([[1.5, 2.5], [2, 3], [2, 4], [3, 5]] as [number, number][]).map((targetRr) => ({ timeStopDays, targetRr })),
);

export const runSweep = (
  store: CandleStore,
  signals: RawSignal[],
  grid: SweepCombo[] = DEFAULT_SWEEP_GRID,
): SweepResult[] =>
  grid.map((combo) => ({
    combo,
    metrics: computeMetrics(
      simulateSignals(store, signals, {
        targetRr: combo.targetRr,
        simulatorConfig: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: combo.timeStopDays },
      }),
    ),
  }));
