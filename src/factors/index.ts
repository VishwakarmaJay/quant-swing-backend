export {
  FactorCategory,
  type Factor,
  type FactorOutput,
  type FactorResult,
  type FeatureBundle,
  type MetricValue,
  type StockContext,
} from './types';
export {
  ema,
  emaLatest,
  smaLatest,
  rsiLatest,
  macdLatest,
  atr,
  round,
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
export { buildFeatureBundle } from './featureBundle';
export { buildStockContext } from './context';
export { factors } from './registry';
