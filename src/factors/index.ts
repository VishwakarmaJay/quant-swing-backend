export {
  FactorCategory,
  type Factor,
  type FactorOutput,
  type FactorResult,
  type FeatureBundle,
  type MetricValue,
  type StockContext,
  type StockFundamentals,
  type StockSentiment,
  type SentimentArticleInput,
} from './types';
export {
  ema,
  emaLatest,
  smaLatest,
  rsiLatest,
  macdLatest,
  atr,
  round,
  lookbackReturnPct,
  type Macd,
} from './indicators';
export { TrendFactor, DEFAULT_TREND_CONFIG, type TrendFactorConfig } from './trendFactor';
export {
  MomentumFactor,
  DEFAULT_MOMENTUM_CONFIG,
  type MomentumFactorConfig,
} from './momentumFactor';
export {
  VolatilityFactor,
  DEFAULT_VOLATILITY_CONFIG,
  type VolatilityFactorConfig,
} from './volatilityFactor';
export { VolumeFactor, DEFAULT_VOLUME_CONFIG, type VolumeFactorConfig } from './volumeFactor';
export {
  RelativeStrengthFactor,
  DEFAULT_RS_CONFIG,
  type RelativeStrengthFactorConfig,
} from './relativeStrengthFactor';
export {
  SectorRelativeStrengthFactor,
  DEFAULT_SECTOR_RS_CONFIG,
  type SectorRelativeStrengthFactorConfig,
} from './sectorRelativeStrengthFactor';
export {
  FundamentalFactor,
  DEFAULT_FUNDAMENTAL_CONFIG,
  type FundamentalFactorConfig,
} from './fundamentalFactor';
export {
  SentimentFactor,
  DEFAULT_SENTIMENT_CONFIG,
  type SentimentFactorConfig,
} from './sentimentFactor';
export { buildFeatureBundle } from './featureBundle';
export {
  buildStockContext,
  loadBenchmarkCandles,
  loadSectorPeerReturns,
  loadFundamentalInputs,
  loadSentimentInputs,
  BENCHMARK_ID,
  BENCHMARK_SYMBOL,
  type SectorPeerReturns,
  type FundamentalInputs,
  type SentimentInputs,
  type SentimentInputsOptions,
} from './context';
export { factors } from './registry';
