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
  type BacktestOptions,
  type BacktestRun,
  type RawSignal,
} from './backtestEngine';
export { runSweep, DEFAULT_SWEEP_GRID, type SweepCombo, type SweepResult } from './sweep';
