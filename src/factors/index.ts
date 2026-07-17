export {
  FactorCategory,
  type Factor,
  type FactorOutput,
  type FactorResult,
  type FeatureBundle,
  type MetricValue,
  type StockContext,
} from './types';
export { ema, emaLatest, smaLatest, round } from './indicators';
export { TrendFactor, DEFAULT_TREND_CONFIG, type TrendFactorConfig } from './trendFactor';
export { buildFeatureBundle } from './featureBundle';
export { buildStockContext } from './context';
export { factors } from './registry';
