export {
  MarketRegime,
  DEFAULT_REGIME_CONFIG,
  type RegimeConfig,
  type RegimeInput,
  type RegimeResult,
} from './types';
export { detectRegime } from './detectRegime';
export { detectMarketRegime, loadVixAsOf, VIX_ID } from './regimeService';
