export {
  simulateTrade,
  DEFAULT_SIMULATOR_CONFIG,
  type ClosedTrade,
  type ExitReason,
  type SimulatorConfig,
  type TradeExit,
  type TradeLevels,
} from './tradeSimulator';
export { computeMetrics, type BacktestMetrics } from './metrics';
export { loadCandleStore, benchmarkReturn, type CandleStore, type UniverseInstrument } from './candleStore';
export {
  runBacktest,
  generateRawSignals,
  simulateSignals,
  simulateSignalsPaired,
  type BacktestOptions,
  type BacktestRun,
  type RawSignal,
  type SignalTrade,
} from './backtestEngine';
export {
  spearman,
  bucketByScore,
  conditionFeatures,
  metricsByRegime,
  CONDITIONING_FEATURES,
  type Bucket,
  type Conditioning,
  type RegimeBreakdown,
} from './attribution';
export {
  makeExpandingFolds,
  pickBest,
  runWalkForward,
  type Fold,
  type WFCandidate,
  type FoldResult,
  type WalkForwardResult,
} from './walkForward';
export { runSweep, DEFAULT_SWEEP_GRID, type SweepCombo, type SweepResult } from './sweep';
