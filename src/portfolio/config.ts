import { env } from '@config/env';

import { DEFAULT_PORTFOLIO_CONFIG, type PortfolioConfig } from './types';

/**
 * Builds the PortfolioConfig from runtime env vars, so the per-trade capital and
 * position limits are set without code changes:
 *   PORTFOLIO_BASE_CAPITAL · PORTFOLIO_MAX_OPEN_POSITIONS · PORTFOLIO_MAX_PER_SECTOR
 * Anything unset falls back to DEFAULT_PORTFOLIO_CONFIG.
 */
export const portfolioConfigFromEnv = (): PortfolioConfig => ({
  ...DEFAULT_PORTFOLIO_CONFIG,
  baseCapitalPerTrade: env.PORTFOLIO_BASE_CAPITAL,
  maxOpenPositions: env.PORTFOLIO_MAX_OPEN_POSITIONS,
  maxPerSector: env.PORTFOLIO_MAX_PER_SECTOR,
});
