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
export {
  loadCandleStore,
  loadNewsBySymbol,
  SENTIMENT_ORIGIN_TIERS,
  benchmarkReturn,
  type CandleStore,
  type UniverseInstrument,
  type NewsBySymbol,
} from './candleStore';
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
  makeAnchoredFolds,
  pickBest,
  runWalkForward,
  type Fold,
  type WFCandidate,
  type FoldResult,
  type WalkForwardResult,
} from './walkForward';
export {
  simulatePortfolio,
  DEFAULT_PORTFOLIO_SIM_CONFIG,
  type PortfolioSimConfig,
  type PortfolioResult,
  type PortfolioMetrics,
  type PortfolioTrade,
  type EquityPoint,
  type SizingMode,
  type SkipReason,
  type RankKey,
} from './portfolioSimulator';
export { runSweep, DEFAULT_SWEEP_GRID, type SweepCombo, type SweepResult } from './sweep';
